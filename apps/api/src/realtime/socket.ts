import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { prisma } from "../lib/prisma.js";
import { verifyAccessToken } from "../lib/auth.js";
import { markOffline, markOnline, redisPub, redisSub } from "../lib/redis.js";
import { roomChannel, setIO, userChannel } from "./bus.js";

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

  io.on("connection", async (socket) => {
    const userId = socket.data.userId as string;

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
    socket.broadcast.emit("presence:online", { userId });

    socket.on("typing:start", async (payload: { roomId?: string }) => {
      if (!payload?.roomId) return;
      socket.to(roomChannel(payload.roomId)).emit("typing:start", { roomId: payload.roomId, userId });
    });

    socket.on("typing:stop", async (payload: { roomId?: string }) => {
      if (!payload?.roomId) return;
      socket.to(roomChannel(payload.roomId)).emit("typing:stop", { roomId: payload.roomId, userId });
    });

    // Called when the client opens a room it just learned about.
    socket.on("room:subscribe", (payload: { roomId?: string }) => {
      if (payload?.roomId) socket.join(roomChannel(payload.roomId));
    });

    socket.on("call:leave", (payload: { roomId?: string }) => {
      if (!payload?.roomId) return;
      socket.to(roomChannel(payload.roomId)).emit("call:left", { roomId: payload.roomId, userId });
    });

    socket.on("disconnect", async () => {
      const wasLast = await markOffline(userId, socket.id);
      if (!wasLast) return;
      await prisma.user
        .update({ where: { id: userId }, data: { presence: "OFFLINE", lastSeenAt: new Date() } })
        .catch(() => undefined);
      socket.broadcast.emit("presence:offline", { userId, at: new Date().toISOString() });
    });
  });

  setIO(io);
  return io;
}
