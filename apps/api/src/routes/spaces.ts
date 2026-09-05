import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { userSelect } from "../lib/shapes.js";
import { authGuard } from "../plugins/auth.js";
import { emitToRoom, emitToUsers, joinUserSockets } from "../realtime/bus.js";

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
    if (!body.success) return reply.code(400).send({ error: "Give the space a name." });

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
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0].message });

    const membership = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId: request.userId } }
    });
    if (!membership) return reply.code(404).send({ error: "You are not in that space." });
    if (membership.role === "MEMBER") {
      return reply.code(403).send({ error: "Only admins can add channels." });
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
    if (!space) return reply.code(404).send({ error: "That invite is not valid." });

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

  app.get("/spaces/:id/members", async (request, reply) => {
    const { id } = request.params as { id: string };
    const membership = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId: request.userId } }
    });
    if (!membership) return reply.code(404).send({ error: "You are not in that space." });

    const members = await prisma.spaceMember.findMany({
      where: { spaceId: id },
      include: { user: { select: userSelect } }
    });
    return { members: members.map((m) => ({ ...m.user, role: m.role })) };
  });
}
