import type { FastifyInstance } from "fastify";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { prisma } from "../lib/prisma.js";
import { env, callsEnabled } from "../env.js";
import { authGuard } from "../plugins/auth.js";
import { HttpError, memberIdsOf, requireMembership } from "../lib/rooms.js";
import { emitToRoom } from "../realtime/bus.js";
import { falha } from "../lib/falha.js";

/**
 * The API only mints tokens — media never touches it. The client takes the
 * token straight to LiveKit over wss, which is what keeps a screen share off
 * this server's bandwidth.
 */
export async function callRoutes(app: FastifyInstance) {
  app.get("/calls/config", async () => ({
    enabled: callsEnabled,
    url: callsEnabled ? env.LIVEKIT_URL : null
  }));

  app.post("/rooms/:id/call/token", { preHandler: authGuard }, async (request, reply) => {
    if (!callsEnabled) {
      return falha(reply, 503, "calls.disabled", "Calls are not set up on this server.");
    }

    const { id } = request.params as { id: string };
    try {
      await requireMembership(id, request.userId);
    } catch (err) {
      if (err instanceof HttpError) return falha(reply, err.status, err.code, err.message);
      throw err;
    }

    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      select: { id: true, displayName: true, username: true, avatarUrl: true }
    });
    if (!user) return falha(reply, 404, "auth.account_missing", "Account not found.");

    const token = new AccessToken(env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!, {
      identity: user.id,
      name: user.displayName,
      metadata: JSON.stringify({ username: user.username, avatarUrl: user.avatarUrl }),
      ttl: "4h"
    });

    token.addGrant({
      room: `room_${id}`,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // SCREEN_SHARE_AUDIO is what carries the sound of what is on screen.
      // Without it the shared screen goes out silent.
      canPublishSources: [
        TrackSource.CAMERA,
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO
      ]
    });

    emitToRoom(id, "call:joined", { roomId: id, userId: user.id, displayName: user.displayName });

    return {
      url: env.LIVEKIT_URL,
      token: await token.toJwt(),
      room: `room_${id}`,
      participants: await memberIdsOf(id)
    };
  });

  /** Rings everyone else in the room. LiveKit has no concept of an invite. */
  app.post("/rooms/:id/call/ring", { preHandler: authGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await requireMembership(id, request.userId);
    } catch (err) {
      if (err instanceof HttpError) return falha(reply, err.status, err.code, err.message);
      throw err;
    }

    const caller = await prisma.user.findUnique({
      where: { id: request.userId },
      select: { id: true, displayName: true, avatarUrl: true }
    });
    emitToRoom(id, "call:ring", { roomId: id, from: caller });
    return { ok: true };
  });
}
