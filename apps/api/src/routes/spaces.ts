import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { userSelect } from "../lib/shapes.js";
import { authGuard } from "../plugins/auth.js";
import { emitToRoom, emitToUsers, joinUserSockets, leaveUserSockets } from "../realtime/bus.js";
import { falha, falhaDeValidacao } from "../lib/falha.js";

const inviteCode = () => crypto.randomBytes(5).toString("hex");

export async function spaceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/spaces", async (request) => {
    const memberships = await prisma.spaceMember.findMany({
      where: { userId: request.userId },
      include: {
        space: {
          include: {
            _count: { select: { members: true } },
            rooms: {
              orderBy: [{ position: "asc" }, { createdAt: "asc" }],
              select: { id: true, name: true, kind: true, topic: true, position: true }
            }
          }
        }
      }
    });

    return {
      spaces: memberships.map((m) => ({
        id: m.space.id,
        name: m.space.name,
        iconUrl: m.space.iconUrl,
        inviteCode: m.space.inviteCode,
        role: m.role,
        memberCount: m.space._count.members,
        channels: m.space.rooms
      }))
    };
  });

  /** A new space always opens with one text channel and one voice channel. */
  app.post("/spaces", async (request, reply) => {
    const body = z.object({ name: z.string().min(1).max(60) }).safeParse(request.body);
    if (!body.success) return falha(reply, 400, "spaces.needs_name", "Give the space a name.");

    const space = await prisma.space.create({
      data: {
        name: body.data.name,
        ownerId: request.userId,
        inviteCode: inviteCode(),
        members: { create: { userId: request.userId, role: "OWNER" } },
        rooms: {
          create: [
            { kind: "TEXT", name: "general", position: 0 },
            { kind: "VOICE", name: "Voice", position: 1 }
          ]
        }
      },
      include: { rooms: true }
    });

    await prisma.roomMember.createMany({
      data: space.rooms.map((r) => ({ roomId: r.id, userId: request.userId, role: "OWNER" as const }))
    });
    await Promise.all(space.rooms.map((r) => joinUserSockets(request.userId, r.id)));

    return reply.code(201).send({
      space: {
        id: space.id,
        name: space.name,
        inviteCode: space.inviteCode,
        channels: space.rooms.map((r) => ({ id: r.id, name: r.name, kind: r.kind }))
      }
    });
  });

  app.post("/spaces/:id/channels", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).max(60),
        kind: z.enum(["TEXT", "VOICE"]).default("TEXT"),
        topic: z.string().max(300).optional()
      })
      .safeParse(request.body);
    if (!body.success) return falhaDeValidacao(reply, body.error.issues[0].message);

    const membership = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId: request.userId } }
    });
    if (!membership) return falha(reply, 404, "spaces.not_member", "You are not in that space.");
    if (membership.role === "MEMBER") {
      return falha(reply, 403, "spaces.admin_only", "Only admins can add channels.");
    }

    const count = await prisma.room.count({ where: { spaceId: id } });
    const room = await prisma.room.create({
      data: {
        spaceId: id,
        kind: body.data.kind,
        name: body.data.name,
        topic: body.data.topic,
        position: count
      }
    });

    // Everyone in the space gets the new channel.
    const members = await prisma.spaceMember.findMany({
      where: { spaceId: id },
      select: { userId: true }
    });
    await prisma.roomMember.createMany({
      data: members.map((m) => ({ roomId: room.id, userId: m.userId })),
      skipDuplicates: true
    });
    const ids = members.map((m) => m.userId);
    await Promise.all(ids.map((u) => joinUserSockets(u, room.id)));
    emitToUsers(ids, "room:new", { roomId: room.id });

    return reply.code(201).send({ channel: { id: room.id, name: room.name, kind: room.kind } });
  });

  app.post("/spaces/join/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const space = await prisma.space.findUnique({
      where: { inviteCode: code },
      include: { rooms: true }
    });
    if (!space) return falha(reply, 404, "spaces.bad_invite", "That invite is not valid.");

    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: space.id, userId: request.userId } },
      create: { spaceId: space.id, userId: request.userId },
      update: {}
    });
    await prisma.roomMember.createMany({
      data: space.rooms.map((r) => ({ roomId: r.id, userId: request.userId })),
      skipDuplicates: true
    });
    await Promise.all(space.rooms.map((r) => joinUserSockets(request.userId, r.id)));

    emitToUsers([request.userId], "space:joined", { spaceId: space.id });

    /*
     * Everyone already in the space has to hear about it too. Telling only the
     * person who joined is why someone could accept an invite and simply not
     * appear on the inviter's screen until they reloaded the page.
     */
    const others = await prisma.spaceMember.findMany({
      where: { spaceId: space.id, userId: { not: request.userId } },
      select: { userId: true }
    });
    emitToUsers(
      others.map((o) => o.userId),
      "space:members",
      { spaceId: space.id }
    );
    for (const room of space.rooms) {
      emitToRoom(room.id, "room:members", { roomId: room.id });
    }

    return { space: { id: space.id, name: space.name } };
  });

  /**
   * Sair de um espaço.
   *
   * Entrar era possível desde sempre; sair, não — quem aceitava um convite
   * ficava lá para sempre, sem nenhuma saída pela API nem pela interface.
   *
   * Duas decisões que valem estar escritas:
   *
   * As MENSAGENS FICAM. Apagar o que a pessoa escreveu ao sair arrancaria
   * metade das conversas de todo mundo que continua, e ninguém espera isso ao
   * clicar em "sair".
   *
   * O DONO PODE SAIR. Prender quem criou o espaço dentro dele é pior do que
   * transferir: a posse passa para o membro mais antigo que restou. Se não
   * restou ninguém, o espaço é apagado — e aí sim as mensagens vão junto, por
   * cascata, porque não há mais quem as leia.
   */
  app.delete("/spaces/:id/members/me", async (request, reply) => {
    const { id } = request.params as { id: string };

    const space = await prisma.space.findUnique({
      where: { id },
      include: { rooms: { select: { id: true } } }
    });
    if (!space) return falha(reply, 404, "spaces.missing", "That space does not exist.");

    const membership = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId: request.userId } }
    });
    if (!membership) return falha(reply, 404, "spaces.not_member", "You are not in that space.");

    const roomIds = space.rooms.map((r) => r.id);

    await prisma.$transaction([
      prisma.spaceMember.delete({
        where: { spaceId_userId: { spaceId: id, userId: request.userId } }
      }),
      prisma.roomMember.deleteMany({
        where: { roomId: { in: roomIds }, userId: request.userId }
      })
    ]);

    /*
     * Tirar a linha do banco não basta: uma aba aberta continua inscrita nos
     * canais e recebendo mensagem até alguém recarregar a página.
     */
    await Promise.all(roomIds.map((roomId) => leaveUserSockets(request.userId, roomId)));

    const restantes = await prisma.spaceMember.findMany({
      where: { spaceId: id },
      orderBy: { joinedAt: "asc" },
      select: { userId: true }
    });

    if (restantes.length === 0) {
      // Ninguém restou: o espaço, seus canais e suas mensagens somem por cascata.
      await prisma.space.delete({ where: { id } });
      emitToUsers([request.userId], "space:left", { spaceId: id });
      return reply.send({ ok: true, spaceDeleted: true });
    }

    if (space.ownerId === request.userId) {
      const herdeiro = restantes[0].userId;
      await prisma.$transaction([
        prisma.space.update({ where: { id }, data: { ownerId: herdeiro } }),
        prisma.spaceMember.update({
          where: { spaceId_userId: { spaceId: id, userId: herdeiro } },
          data: { role: "OWNER" }
        })
      ]);
    }

    emitToUsers([request.userId], "space:left", { spaceId: id });
    emitToUsers(
      restantes.map((m) => m.userId),
      "space:members",
      { spaceId: id }
    );
    for (const roomId of roomIds) {
      emitToRoom(roomId, "room:members", { roomId });
    }

    return reply.send({ ok: true, spaceDeleted: false });
  });

  app.get("/spaces/:id/members", async (request, reply) => {
    const { id } = request.params as { id: string };
    const membership = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId: request.userId } }
    });
    if (!membership) return falha(reply, 404, "spaces.not_member", "You are not in that space.");

    const members = await prisma.spaceMember.findMany({
      where: { spaceId: id },
      include: { user: { select: userSelect } }
    });
    return { members: members.map((m) => ({ ...m.user, role: m.role })) };
  });
}
