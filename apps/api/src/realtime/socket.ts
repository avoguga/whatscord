import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { prisma } from "../lib/prisma.js";
import { verifyAccessToken } from "../lib/auth.js";
import { markOffline, markOnline, redisPub, redisSub } from "../lib/redis.js";
import { emitToUsers, roomChannel, setIO, userChannel } from "./bus.js";

/**
 * Every socket event that names a room is checked against membership.
 *
 * Without this, `room:subscribe` with an arbitrary id was enough to start
 * receiving another person's direct messages — the room channel is where the
 * message payloads go, so joining it is equivalent to reading the room.
 */
async function isMember(roomId: string, userId: string) {
  const row = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { id: true }
  });
  return Boolean(row);
}

/**
 * Everyone who shares at least one room with this person.
 *
 * Presence used to go out as a global broadcast, which told every account on
 * the server who had just come online — people with nothing in common, and a
 * fan-out that grows with the whole user base instead of with your contacts.
 */
async function peersOf(userId: string): Promise<string[]> {
  const mine = await prisma.roomMember.findMany({
    where: { userId },
    select: { roomId: true }
  });
  if (mine.length === 0) return [];
  const peers = await prisma.roomMember.findMany({
    where: { roomId: { in: mine.map((m) => m.roomId) }, userId: { not: userId } },
    select: { userId: true },
    distinct: ["userId"]
  });
  return peers.map((p) => p.userId);
}

/**
 * Socket.IO invokes listeners through an EventEmitter, so a rejected promise in
 * an async handler is an unhandled rejection — which terminates the process on
 * Node 22. Every async handler goes through here.
 */
function safe(handler: () => Promise<void>) {
  handler().catch((err) => console.error("socket handler:", err?.message ?? err));
}

export async function attachSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    // Attachments are posted over HTTP; sockets only carry small events.
    maxHttpBufferSize: 1_000_000,
    pingInterval: 20_000,
    pingTimeout: 25_000
  });

  if (redisPub && redisSub) {
    io.adapter(createAdapter(redisPub, redisSub));
    console.log("realtime: using the Redis adapter");
  }

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      socket.handshake.headers.authorization?.replace("Bearer ", "");
    const claims = token ? verifyAccessToken(token) : null;
    if (!claims) return next(new Error("Your session expired. Sign in again."));
    socket.data.userId = claims.sub;
    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;

    safe(async () => {
      // A personal channel, plus one per conversation the user belongs to.
      socket.join(userChannel(userId));
      const memberships = await prisma.roomMember.findMany({
        where: { userId },
        select: { roomId: true }
      });
      for (const m of memberships) socket.join(roomChannel(m.roomId));

      await markOnline(userId, socket.id);
      await prisma.user
        .update({ where: { id: userId }, data: { presence: "ONLINE", lastSeenAt: new Date() } })
        .catch(() => undefined);
      emitToUsers(await peersOf(userId), "presence:online", { userId });
    });

    socket.on("typing:start", (payload: { roomId?: string }) =>
      safe(async () => {
        if (!payload?.roomId || !(await isMember(payload.roomId, userId))) return;
        socket
          .to(roomChannel(payload.roomId))
          .emit("typing:start", { roomId: payload.roomId, userId });
      })
    );

    socket.on("typing:stop", (payload: { roomId?: string }) =>
      safe(async () => {
        if (!payload?.roomId || !(await isMember(payload.roomId, userId))) return;
        socket
          .to(roomChannel(payload.roomId))
          .emit("typing:stop", { roomId: payload.roomId, userId });
      })
    );

    // Called when the client opens a room it just learned about.
    socket.on("room:subscribe", (payload: { roomId?: string }) =>
      safe(async () => {
        if (!payload?.roomId || !(await isMember(payload.roomId, userId))) return;
        socket.join(roomChannel(payload.roomId));
      })
    );

    socket.on("room:unsubscribe", (payload: { roomId?: string }) => {
      if (payload?.roomId) socket.leave(roomChannel(payload.roomId));
    });

    socket.on("call:leave", (payload: { roomId?: string }) =>
      safe(async () => {
        if (!payload?.roomId || !(await isMember(payload.roomId, userId))) return;
        socket.to(roomChannel(payload.roomId)).emit("call:left", { roomId: payload.roomId, userId });
      })
    );

    socket.on("disconnect", () =>
      safe(async () => {
        const wasLast = await markOffline(userId, socket.id);
        if (!wasLast) return;
        await prisma.user
          .update({ where: { id: userId }, data: { presence: "OFFLINE", lastSeenAt: new Date() } })
          .catch(() => undefined);
        emitToUsers(await peersOf(userId), "presence:offline", {
          userId,
          at: new Date().toISOString()
        });
      })
    );
  });

  setIO(io);
  return io;
}
