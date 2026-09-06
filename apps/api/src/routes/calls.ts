import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { prisma } from "../lib/prisma.js";
import { env, callsEnabled } from "../env.js";
import { authGuard } from "../plugins/auth.js";
import { HttpError, memberIdsOf, requireMembership } from "../lib/rooms.js";
import { entrarNaVoz } from "../lib/presencaDeVoz.js";
import { emitToRoom, socketIdsOfUser } from "../realtime/bus.js";
import { anunciarPresencaDeVoz, usuariosDaSala } from "../realtime/voz.js";
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

  /**
   * Quem está em cada sala de voz agora.
   *
   * É o que faz a presença sobreviver ao F5: a lista deixa de nascer dos
   * eventos que a aba viu desde que abriu, e passa a ser lida do servidor.
   *
   * Sala de que quem pergunta não é membro simplesmente NÃO VEM na resposta —
   * não vem como erro. Responder 403 para um id qualquer contaria a estranhos
   * que a sala existe, e uma barra lateral que pergunta por trinta salas de uma
   * vez não pode falhar inteira porque uma delas já não é sua.
   */
  app.get("/calls/presence", { preHandler: authGuard }, async (request) => {
    const query = z.object({ roomIds: z.string().max(4000).optional() }).safeParse(request.query);
    const pedidas = [
      ...new Set(
        (query.success ? (query.data.roomIds ?? "") : "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      )
    ].slice(0, 100);
    if (pedidas.length === 0) return { presence: {} };

    const minhas = await prisma.roomMember.findMany({
      where: { userId: request.userId, roomId: { in: pedidas } },
      select: { roomId: true }
    });

    const presence: Record<string, Awaited<ReturnType<typeof usuariosDaSala>>> = {};
    await Promise.all(
      minhas.map(async (m) => {
        presence[m.roomId] = await usuariosDaSala(m.roomId);
      })
    );
    return { presence };
  });

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

    /*
     * Pegar o token É entrar na sala de voz — é o único passo que o cliente dá
     * antes de aparecer no LiveKit, e prender a presença aqui é o que faz ela
     * existir para quem chegar depois.
     *
     * A presença se prende às CONEXÕES da pessoa, não ao pedido HTTP, porque é
     * o `disconnect` de cada conexão que vai desfazê-la.
     *
     * Sem nenhuma conexão aberta, não se registra nada — e isso é deliberado.
     * A versão anterior inventava uma conexão `http:<userId>` para esse caso,
     * e ela virava órfã: nenhum `disconnect` a desfazia, então a pessoa ficava
     * na sala por 90 segundos depois de ter ido embora, e a entrada seguinte
     * "não mudava a lista" e deixava de avisar a sala. Um fantasma na barra
     * lateral é exatamente o defeito que esta funcionalidade existe para
     * resolver. Quem conecta o socket depois entra pelo evento `voice:join`.
     */
    const conexoes = await socketIdsOfUser(user.id);
    for (const socketId of conexoes) {
      await entrarNaVoz(id, user.id, socketId);
    }
    /*
     * Anuncia sempre que houve conexao para prender, e nao so quando a lista
     * mudou. O evento leva a lista INTEIRA, entao repetir e barato; ja o
     * contrario e caro: quem pede o token de novo depois de reconectar nao
     * mudaria a lista, ninguem seria avisado, e as telas ficariam com uma
     * versao antiga sem nada que as corrigisse.
     */
    if (conexoes.length > 0) await anunciarPresencaDeVoz(id);

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
