import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { prisma } from "../lib/prisma.js";
import { verifyAccessToken } from "../lib/auth.js";
import { markOffline, markOnline, redisPub, redisSub } from "../lib/redis.js";
import {
  entrarNaVoz,
  esquecerConexao,
  renovarConexao,
  RENOVACAO_DE_VOZ_MS,
  sairDaVoz
} from "../lib/presencaDeVoz.js";
import { anunciarPresencaDeVoz, anunciarEspectadores } from "./voz.js";
import { expulsarDaChamada } from "../lib/livekitSala.js";
import { chaveDeEspectadores, ehChaveDeEspectadores } from "../lib/transmissao.js";
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

    /*
     * Entrar na voz.
     *
     * O cliente que já existe entra pedindo o token em `POST
     * /rooms/:id/call/token`, e aquela rota também registra a presença — este
     * evento é o caminho para quem entra numa sala de voz sem chamar o
     * LiveKit (ouvindo apenas, ou com as chamadas desligadas no servidor).
     * `voice:join` e `call:join` são o mesmo evento com dois nomes porque o
     * resto do protocolo de chamada usa o prefixo `call:`.
     */
    const entrar = (payload: { roomId?: string }) =>
      safe(async () => {
        if (!payload?.roomId || !(await isMember(payload.roomId, userId))) return;
        await entrarNaVoz(payload.roomId, userId, socket.id);
        socket
          .to(roomChannel(payload.roomId))
          .emit("call:joined", { roomId: payload.roomId, userId });
        /*
         * Anuncia sempre, e nao so quando a lista mudou.
         *
         * "Mudou" aqui quer dizer "esta pessoa nao estava na sala". Uma segunda
         * aba da mesma pessoa, ou um reingresso depois de reconectar, nao muda
         * a lista — e ninguem seria avisado, deixando as telas que perderam o
         * evento anterior sem nada que as corrigisse. O evento carrega a lista
         * INTEIRA, entao repetir custa quase nada e calar custa uma tela errada.
         */
        await anunciarPresencaDeVoz(payload.roomId);
      });
    socket.on("voice:join", entrar);
    socket.on("call:join", entrar);

    const sair = (payload: { roomId?: string }) =>
      safe(async () => {
        if (!payload?.roomId || !(await isMember(payload.roomId, userId))) return;
        /*
         * A hora da saída, tomada ANTES de qualquer ida à rede: é com ela que se
         * decide, lá no LiveKit, se a sessão que está na sala é a que acabou de
         * sair ou uma que já voltou. Ver `expulsao.ts`.
         */
        const pedidoEm = Date.now();
        socket.to(roomChannel(payload.roomId)).emit("call:left", { roomId: payload.roomId, userId });
        /*
         * Sair é deliberado: derruba TODAS as conexões desta pessoa nesta sala,
         * não só a que mandou o evento. O LiveKit não deixa a mesma identidade
         * estar duas vezes na sala, então "a outra aba continua na chamada" não
         * é um estado que exista de verdade — deixá-la registrada só faria a
         * pessoa ficar na lista depois de ter saído.
         */
        if (await sairDaVoz(payload.roomId, userId, socket.id, true)) {
          await anunciarPresencaDeVoz(payload.roomId);
        }
        /*
         * E tira do LIVEKIT também.
         *
         * Sair da nossa lista de presença é o que a barra lateral lê; continuar
         * no LiveKit é o que os OUTROS continuam ouvindo. Os dois divergiam, e
         * foi medido: quatro minutos depois de a tela de chamada fechar, o
         * LiveKit ainda dava a pessoa como ativa, publicando áudio, porque o
         * aviso de saída do navegador dela nunca foi entregue — aba congelada
         * entrega o `sendLeave` nunca, e o soquete aberto impede o tempo limite
         * de agir. Quem sempre sabe que a pessoa saiu é este servidor.
         */
        await expulsarDaChamada(payload.roomId, userId, pedidoEm);
      });
    socket.on("call:leave", sair);
    socket.on("voice:leave", sair);

    /**
     * Entrar e sair de uma transmissão, para efeito de CONTAGEM.
     *
     * Quem autoriza é `POST /streams/:id/watch`, não isto: lá se confere a
     * visibilidade, o código e o teto, e só então a pessoa vira membro da sala
     * do chat. Aqui só se pergunta "já é membro?", que é a marca deixada por
     * aquela porta — por isso este par de eventos não repete a regra de acesso,
     * e não pode virar um segundo caminho de entrada.
     *
     * O `roomId` vem do BANCO e não do cliente: com ele vindo de fora, alguém
     * poderia se contar como espectador de uma transmissão qualquer passando o
     * id de uma sala em que de fato está.
     */
    const transmissaoEntrar = (payload: { streamId?: string }) =>
      safe(async () => {
        if (!payload?.streamId) return;
        const t = await prisma.stream.findUnique({
          where: { id: payload.streamId },
          select: { roomId: true }
        });
        if (!t || !(await isMember(t.roomId, userId))) return;
        await entrarNaVoz(chaveDeEspectadores(payload.streamId), userId, socket.id);
        await anunciarEspectadores(payload.streamId, t.roomId);
      });
    socket.on("stream:join", transmissaoEntrar);

    const transmissaoSair = (payload: { streamId?: string }) =>
      safe(async () => {
        if (!payload?.streamId) return;
        const t = await prisma.stream.findUnique({
          where: { id: payload.streamId },
          select: { roomId: true }
        });
        if (!t) return;
        await sairDaVoz(chaveDeEspectadores(payload.streamId), userId, socket.id, true);
        await anunciarEspectadores(payload.streamId, t.roomId);
      });
    socket.on("stream:leave", transmissaoSair);

    // Renovação vinda do cliente. O servidor renova sozinho de qualquer forma;
    // esta é só uma segunda rede, para o caso de um relógio dormindo.
    socket.on("voice:heartbeat", () => safe(() => renovarConexao(socket.id)));

    socket.on("disconnect", () =>
      safe(async () => {
        /*
         * Fechar a aba tem que tirar a pessoa da sala de voz na hora. O TTL
         * daria conta em 90 s, mas 90 s olhando para alguém que já foi embora é
         * exatamente o defeito que a presença no servidor veio consertar.
         */
        const caiuEm = Date.now();
        for (const roomId of await esquecerConexao(socket.id, userId)) {
          /*
           * A mesma máquina de presença conta duas coisas diferentes, separadas
           * pelo prefixo da chave. Uma transmissão não tem "call:left", não tem
           * lista de quem está na voz, e a sala dela no LiveKit não se chama
           * `room_<id>` — tratá-la como chamada mandaria três avisos errados e
           * uma expulsão para uma sala que não existe.
           *
           * A contagem de espectadores se corrige sozinha: a linha já saiu da
           * presença aqui em cima, e a tela relê ao abrir e a cada atualização.
           */
          if (ehChaveDeEspectadores(roomId)) continue;
          io.to(roomChannel(roomId)).emit("call:left", { roomId, userId });
          await anunciarPresencaDeVoz(roomId);
          /*
           * `esquecerConexao` só devolve as salas em que a pessoa sumiu de vez —
           * era a última conexão dela. Nas outras ela continua em outra aba, e
           * expulsar do LiveKit derrubaria essa aba.
           */
          await expulsarDaChamada(roomId, userId, caiuEm);
        }

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

  /*
   * O heartbeat da presença de voz é do servidor, sobre os sockets que ESTA
   * instância segura. Assim o TTL no Redis vira o que ele deve ser: o que
   * limpa a bagunça de uma instância que morreu sem despedida, e não o relógio
   * do qual a presença depende para existir.
   */
  const batida = setInterval(() => {
    for (const socketId of io.sockets.sockets.keys()) {
      renovarConexao(socketId).catch(() => undefined);
    }
  }, RENOVACAO_DE_VOZ_MS);
  // Um timer pendurado não pode ser o que segura o processo de pé.
  batida.unref();

  setIO(io);
  return io;
}
