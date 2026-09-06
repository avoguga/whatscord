import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { userSelect } from "../lib/shapes.js";
import { authGuard } from "../plugins/auth.js";
import { dmKeyFor, HttpError, requireMembership, memberIdsOf } from "../lib/rooms.js";
import { emitToUsers, joinUserSockets, leaveUserSockets } from "../realtime/bus.js";
import { falha, falhaDeValidacao } from "../lib/falha.js";

export async function roomRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  /**
   * The sidebar. DMs, groups and channels come back in one list, newest
   * activity first — that is what lets the WhatsApp layout show them together.
   */
  app.get("/rooms", async (request) => {
    const userId = request.userId;

    const memberships = await prisma.roomMember.findMany({
      where: { userId },
      include: {
        room: {
          include: {
            space: { select: { id: true, name: true, iconUrl: true } },
            members: {
              take: 12,
              include: { user: { select: userSelect } }
            },
            _count: { select: { members: true } },
            messages: {
              where: { deletedAt: null },
              orderBy: { createdAt: "desc" },
              take: 1,
              include: {
                author: { select: { id: true, displayName: true, username: true } },
                attachments: { select: { id: true, mime: true, name: true } }
              }
            }
          }
        }
      }
    });

    const unreadCounts = await Promise.all(
      memberships.map((m) =>
        prisma.message.count({
          where: {
            roomId: m.roomId,
            deletedAt: null,
            authorId: { not: userId },
            // Falling back to joinedAt, not to "no filter": someone who just
            // joined a channel with 5,000 messages of history has not missed
            // 5,000 messages, and a badge saying so reads as the app being broken.
            createdAt: { gt: m.lastReadAt ?? m.joinedAt }
          }
        })
      )
    );

    const rooms = memberships.map((m, i) => {
      const room = m.room;
      const last = room.messages[0];
      const others = room.members.filter((rm) => rm.userId !== userId).map((rm) => rm.user);

      return {
        id: room.id,
        kind: room.kind,
        // A DM has no stored name — it is named after the other person.
        name: room.kind === "DM" ? (others[0]?.displayName ?? "Empty chat") : room.name,
        iconUrl: room.kind === "DM" ? (others[0]?.avatarUrl ?? null) : room.iconUrl,
        topic: room.topic,
        space: room.space,
        counterpart: room.kind === "DM" ? (others[0] ?? null) : null,
        members: others,
        memberCount: room._count.members,
        muted: m.muted,
        unread: unreadCounts[i],
        lastMessage: last
          ? {
              id: last.id,
              content: last.content,
              authorId: last.authorId,
              authorName: last.author.displayName,
              attachmentCount: last.attachments.length,
              attachmentMime: last.attachments[0]?.mime ?? null,
              createdAt: last.createdAt
            }
          : null,
        activityAt: last?.createdAt ?? room.createdAt
      };
    });

    rooms.sort((a, b) => new Date(b.activityAt).getTime() - new Date(a.activityAt).getTime());
    return { rooms };
  });

  app.get("/rooms/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await requireMembership(id, request.userId);
    } catch (err) {
      if (err instanceof HttpError) return falha(reply, err.status, err.code, err.message);
      throw err;
    }

    const room = await prisma.room.findUnique({
      where: { id },
      include: {
        space: { select: { id: true, name: true, iconUrl: true } },
        members: { include: { user: { select: userSelect } } }
      }
    });
    if (!room) return falha(reply, 404, "rooms.gone", "That conversation no longer exists.");

    return {
      room: {
        id: room.id,
        kind: room.kind,
        name: room.name,
        topic: room.topic,
        iconUrl: room.iconUrl,
        space: room.space,
        members: room.members.map((m) => ({ ...m.user, role: m.role }))
      }
    };
  });

  /** Opens the DM with someone, or returns the one that already exists. */
  app.post("/rooms/dm", async (request, reply) => {
    const body = z.object({ userId: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return falha(reply, 400, "rooms.pick_someone", "Pick someone to message.");

    const otherId = body.data.userId;
    if (otherId === request.userId) {
      return falha(reply, 400, "rooms.self_dm", "You cannot message yourself.");
    }

    const other = await prisma.user.findUnique({ where: { id: otherId }, select: userSelect });
    if (!other) return falha(reply, 404, "rooms.person_missing", "That person is not on WhatsCord.");

    const key = dmKeyFor(request.userId, otherId);
    const existing = await prisma.room.findUnique({ where: { dmKey: key } });
    if (existing) return { room: { id: existing.id, kind: existing.kind }, created: false };

    const room = await prisma.room.create({
      data: {
        kind: "DM",
        dmKey: key,
        members: {
          create: [{ userId: request.userId }, { userId: otherId }]
        }
      }
    });

    await joinUserSockets(request.userId, room.id);
    await joinUserSockets(otherId, room.id);
    emitToUsers([request.userId, otherId], "room:new", { roomId: room.id });

    return reply.code(201).send({ room: { id: room.id, kind: room.kind }, created: true });
  });

  app.post("/rooms/group", async (request, reply) => {
    const body = z
      .object({
        name: z.string().min(1, "Give the group a name.").max(60),
        memberIds: z.array(z.string()).max(200).default([])
      })
      .safeParse(request.body);
    if (!body.success) return falhaDeValidacao(reply, body.error.issues[0].message);

    const ids = [...new Set([request.userId, ...body.data.memberIds])];
    const room = await prisma.room.create({
      data: {
        kind: "GROUP",
        name: body.data.name,
        members: {
          create: ids.map((userId) => ({
            userId,
            role: userId === request.userId ? "OWNER" : "MEMBER"
          }))
        }
      }
    });

    await Promise.all(ids.map((id) => joinUserSockets(id, room.id)));
    emitToUsers(ids, "room:new", { roomId: room.id });
    return reply.code(201).send({ room: { id: room.id, kind: room.kind, name: room.name } });
  });

  app.post("/rooms/:id/members", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ userIds: z.array(z.string()).min(1) }).safeParse(request.body);
    if (!body.success) return falha(reply, 400, "rooms.pick_who", "Pick who to add.");

    try {
      const membership = await requireMembership(id, request.userId);
      if (membership.room.kind === "DM") {
        return falha(reply, 400, "rooms.dm_is_full", "A direct message cannot take more people.");
      }
      /*
       * Channels take their members from the space, and only from the space.
       * Allowing a direct add here let any member of a channel walk someone
       * past the invite code — that person would read the whole history while
       * never appearing in the space's member list, with no way to remove them.
       */
      if (membership.room.spaceId) {
        return falha(
          reply,
          400,
          "rooms.channel_via_space",
          "People join a channel by joining its space. Share the space invite code instead."
        );
      }
    } catch (err) {
      if (err instanceof HttpError) return falha(reply, err.status, err.code, err.message);
      throw err;
    }

    // Unknown ids would violate the foreign key and surface as a 500.
    const known = await prisma.user.findMany({
      where: { id: { in: body.data.userIds } },
      select: { id: true }
    });
    if (known.length === 0) {
      return falha(reply, 400, "rooms.no_such_accounts", "None of those accounts exist.");
    }

    await prisma.roomMember.createMany({
      data: known.map((u) => ({ roomId: id, userId: u.id })),
      skipDuplicates: true
    });
    await Promise.all(known.map((u) => joinUserSockets(u.id, id)));
    emitToUsers(await memberIdsOf(id), "room:members", { roomId: id });
    return { ok: true, added: known.length };
  });

  app.delete("/rooms/:id/members/me", async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = await prisma.roomMember.deleteMany({
      where: { roomId: id, userId: request.userId }
    });
    // Saying "ok" to someone who was never in the room tells them the room
    // exists, and hides a genuine client bug behind a success.
    if (removed.count === 0) {
      return falha(reply, 404, "rooms.not_member", "You are not in that conversation.");
    }

    // Dropping the row is not enough — an open tab stays subscribed to the room
    // channel and keeps receiving messages until the page is reloaded.
    await leaveUserSockets(request.userId, id);

    emitToUsers([request.userId], "room:left", { roomId: id });
    emitToUsers(await memberIdsOf(id), "room:members", { roomId: id });
    return reply.send({ ok: true });
  });

  /** Marks everything up to now as read. Drives the WhatsApp unread badge. */
  app.post("/rooms/:id/read", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ messageId: z.string().optional() }).safeParse(request.body ?? {});

    try {
      await requireMembership(id, request.userId);
    } catch (err) {
      if (err instanceof HttpError) return falha(reply, err.status, err.code, err.message);
      throw err;
    }

    await prisma.roomMember.update({
      where: { roomId_userId: { roomId: id, userId: request.userId } },
      data: {
        lastReadAt: new Date(),
        lastReadMessageId: body.success ? (body.data.messageId ?? undefined) : undefined
      }
    });

    emitToUsers(await memberIdsOf(id), "room:read", {
      roomId: id,
      userId: request.userId,
      at: new Date().toISOString()
    });
    return { ok: true };
  });

  app.patch("/rooms/:id/mute", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ muted: z.boolean() }).safeParse(request.body);
    if (!body.success) return falha(reply, 400, "rooms.mute_or_unmute", "Say whether to mute or unmute.");

    try {
      await requireMembership(id, request.userId);
    } catch (err) {
      if (err instanceof HttpError) return falha(reply, err.status, err.code, err.message);
      throw err;
    }

    await prisma.roomMember.update({
      where: { roomId_userId: { roomId: id, userId: request.userId } },
      data: { muted: body.data.muted }
    });
    return { ok: true };
  });
}
