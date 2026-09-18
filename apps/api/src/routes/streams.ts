import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { prisma } from "../lib/prisma.js";
import { vozUserSelect } from "../lib/shapes.js";
import { env, callsEnabled } from "../env.js";
import { authGuard } from "../plugins/auth.js";
import { falha, falhaDeValidacao } from "../lib/falha.js";
import { emitToRoom, emitToUsers, joinUserSockets, leaveUserSockets } from "../realtime/bus.js";
import { usuariosNaVoz } from "../lib/presencaDeVoz.js";
import { encerrarTransmissao } from "../lib/livekitSala.js";
import {
  TETO_DE_ESPECTADORES,
  apareceNoInicio,
  cabeMaisUm,
  chaveDeEspectadores,
  estaNoAr,
  podeAssistir,
  salaDaTransmissao,
  type Transmissao
} from "../lib/transmissao.js";

/**
 * Transmissões: uma pessoa apresenta, muitas assistem.
 *
 * O TRUQUE INTEIRO está nos crachás. Transmitir é a chamada que já existia com
 * as permissões trocadas: quem transmite recebe um token que publica, e quem
 * assiste recebe um que só escuta — `canPublish: false`, `canPublishData: false`
 * e, o mais importante, `hidden: true`.
 *
 * `hidden` não é detalhe de privacidade. A tela de chamada monta um quadradinho
 * por participante remoto, sem teto nenhum; se os espectadores fossem
 * participantes visíveis, a tela de quem transmite tentaria desenhar um por
 * pessoa que está assistindo. Escondidos, eles não existem para o cliente, e a
 * contagem vem da NOSSA presença.
 *
 * O CHAT saiu de graça: a transmissão é dona de uma `Room`, e quem entra para
 * assistir vira `RoomMember`. Com isso mensagens, anexos, respostas, reações e
 * o socket funcionam sem uma linha nova, e `requireMembership` — o portão de
 * toda rota de sala — continua intocado.
 */

const codigoNovo = () => crypto.randomBytes(5).toString("hex");

/** O teto pode ser apertado sem redeploy do cliente. Ver `transmissao.ts`. */
function teto(): number {
  const bruto = Number(process.env.STREAM_MAX_VIEWERS ?? "");
  return Number.isFinite(bruto) && bruto > 0 ? Math.floor(bruto) : TETO_DE_ESPECTADORES;
}

const visibilidade = z.enum(["PUBLIC", "SPACE", "LINK"]);

/**
 * Título curto de propósito: ele é lido de relance numa grade de cartões, e um
 * título longo estica o cartão e desalinha a grade inteira.
 */
const dados = z.object({
  title: z.string().trim().min(1).max(80),
  visibility: visibilidade,
  spaceId: z.string().optional()
});

type LinhaDaTransmissao = {
  id: string;
  title: string;
  ownerId: string;
  spaceId: string | null;
  visibility: "PUBLIC" | "SPACE" | "LINK";
  inviteCode: string;
  roomId: string;
  startedAt: Date | null;
  endedAt: Date | null;
  owner?: { id: string; username: string; displayName: string; avatarUrl: string | null };
};

const paraRegra = (t: LinhaDaTransmissao): Transmissao => ({
  ownerId: t.ownerId,
  visibility: t.visibility,
  spaceId: t.spaceId,
  inviteCode: t.inviteCode
});

/**
 * O que o cliente recebe.
 *
 * `inviteCode` só sai para o DONO. Numa transmissão por link, o código é a
 * fechadura: devolvê-lo a quem já entrou transformaria cada espectador num
 * porteiro capaz de convidar meio mundo.
 */
function paraFora(t: LinhaDaTransmissao, souDono: boolean, assistindo: number) {
  return {
    id: t.id,
    title: t.title,
    visibility: t.visibility,
    spaceId: t.spaceId,
    roomId: t.roomId,
    owner: t.owner,
    souDono,
    aoVivo: estaNoAr(t),
    startedAt: t.startedAt,
    assistindo,
    inviteCode: souDono ? t.inviteCode : null
  };
}

/** Quantos estão assistindo. A presença mora na chave da sala do chat. */
const quantosAssistem = async (streamId: string) =>
  (await usuariosNaVoz(chaveDeEspectadores(streamId))).length;

export async function streamRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  /** Os espaços de que a pessoa é membro — uma consulta, não uma por transmissão. */
  async function meusEspacos(userId: string): Promise<Set<string>> {
    const linhas = await prisma.spaceMember.findMany({
      where: { userId },
      select: { spaceId: true }
    });
    return new Set(linhas.map((l) => l.spaceId));
  }

  /**
   * A tela de início: o que está no ar e que a pessoa pode ver.
   *
   * `apareceNoInicio` e não `podeAssistir`, e a diferença é o recurso inteiro:
   * quem tem o código PODE assistir a uma transmissão por link, mas ela nunca
   * aparece numa vitrine — senão o código deixa de ser segredo no instante em
   * que alguém abre o app.
   */
  app.get("/streams/live", async (request) => {
    const noAr = await prisma.stream.findMany({
      where: { startedAt: { not: null }, endedAt: null },
      orderBy: { startedAt: "desc" },
      take: 100,
      include: { owner: { select: vozUserSelect } }
    });

    const espacos = await meusEspacos(request.userId);
    const visiveis = noAr.filter((t) =>
      apareceNoInicio(paraRegra(t), {
        userId: request.userId,
        ehMembroDoEspaco: t.spaceId !== null && espacos.has(t.spaceId)
      })
    );

    const comPublico = await Promise.all(
      visiveis.map(async (t) => paraFora(t, t.ownerId === request.userId, await quantosAssistem(t.id)))
    );
    return { streams: comPublico, teto: teto() };
  });

  /** As minhas, no ar ou não — é por aqui que o dono reencontra a dele. */
  app.get("/streams/mine", async (request) => {
    const minhas = await prisma.stream.findMany({
      where: { ownerId: request.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { owner: { select: vozUserSelect } }
    });
    const saida = await Promise.all(
      minhas.map(async (t) => paraFora(t, true, await quantosAssistem(t.id)))
    );
    return { streams: saida };
  });

  /**
   * Abrir uma transmissão pelo código, sem entrar nela.
   *
   * É o que a tela de "você foi convidado" precisa: o título e quem transmite,
   * para a pessoa saber onde está clicando. Responde 404 — e não 403 — para
   * código inválido: dizer "existe, mas não é para você" já conta que existe.
   */
  app.get("/streams/code/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const t = await prisma.stream.findUnique({
      where: { inviteCode: code },
      include: { owner: { select: vozUserSelect } }
    });
    if (!t) return falha(reply, 404, "streams.missing", "That broadcast does not exist.");

    const espacos = await meusEspacos(request.userId);
    const pode = podeAssistir(paraRegra(t), {
      userId: request.userId,
      ehMembroDoEspaco: t.spaceId !== null && espacos.has(t.spaceId),
      codigo: code
    });
    if (!pode) return falha(reply, 404, "streams.missing", "That broadcast does not exist.");

    return { stream: paraFora(t, t.ownerId === request.userId, await quantosAssistem(t.id)) };
  });

  /**
   * Criar uma transmissão.
   *
   * Nasce com a sala de chat dela, na mesma transação: uma transmissão sem sala
   * seria uma tela sem bate-papo que nenhuma rota saberia consertar depois.
   */
  app.post("/streams", async (request, reply) => {
    const corpo = dados.safeParse(request.body);
    if (!corpo.success) {
      const problema = corpo.error.issues[0];
      if (problema.path[0] === "visibility") {
        return falha(reply, 400, "streams.pick_visibility", "Say who can watch this.");
      }
      return falha(reply, 400, "streams.needs_title", "Give the broadcast a title.");
    }

    const { title, visibility } = corpo.data;
    const spaceId = corpo.data.spaceId ?? null;

    if (visibility === "SPACE") {
      if (!spaceId) {
        return falha(reply, 400, "streams.pick_space", "Pick the space this broadcast belongs to.");
      }
      // Transmitir PARA um espaço exige estar nele. Sem isto, qualquer pessoa
      // poria uma transmissão na tela de início de um servidor alheio.
      const eu = await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId, userId: request.userId } }
      });
      if (!eu) return falha(reply, 403, "spaces.not_member", "You are not in that space.");
    }

    const criada = await prisma.$transaction(async (tx) => {
      const room = await tx.room.create({
        data: { kind: "STREAM", name: title, spaceId: null }
      });
      await tx.roomMember.create({
        data: { roomId: room.id, userId: request.userId, role: "OWNER" }
      });
      return tx.stream.create({
        data: {
          title,
          visibility,
          // Guardado mesmo numa pública: é o que vai permitir, depois,
          // avisar o espaço quando alguém de lá entra ao vivo.
          spaceId,
          ownerId: request.userId,
          inviteCode: codigoNovo(),
          roomId: room.id
        },
        include: { owner: { select: vozUserSelect } }
      });
    });

    await joinUserSockets(request.userId, criada.roomId);
    return reply.code(201).send({ stream: paraFora(criada, true, 0) });
  });

  /** Carrega a transmissão e confere que quem pede é o dono. */
  async function minha(id: string, userId: string) {
    const t = await prisma.stream.findUnique({
      where: { id },
      include: { owner: { select: vozUserSelect } }
    });
    if (!t) return { erro: "missing" as const };
    if (t.ownerId !== userId) return { erro: "alheia" as const };
    return { t };
  }

  app.patch("/streams/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const corpo = z
      .object({
        title: z.string().trim().min(1).max(80).optional(),
        visibility: visibilidade.optional(),
        spaceId: z.string().nullable().optional()
      })
      .safeParse(request.body ?? {});
    if (!corpo.success) return falhaDeValidacao(reply, corpo.error.issues[0].message);

    const { t, erro } = await minha(id, request.userId);
    if (erro === "missing") return falha(reply, 404, "streams.missing", "That broadcast does not exist.");
    if (erro === "alheia") {
      return falha(reply, 403, "streams.not_yours", "Only the person broadcasting can do that.");
    }

    const visibilidadeNova = corpo.data.visibility ?? t.visibility;
    const espacoNovo = corpo.data.spaceId === undefined ? t.spaceId : corpo.data.spaceId;

    if (visibilidadeNova === "SPACE") {
      if (!espacoNovo) {
        return falha(reply, 400, "streams.pick_space", "Pick the space this broadcast belongs to.");
      }
      const eu = await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: espacoNovo, userId: request.userId } }
      });
      if (!eu) return falha(reply, 403, "spaces.not_member", "You are not in that space.");
    }

    const apertou = visibilidadeNova !== t.visibility;

    const atualizada = await prisma.stream.update({
      where: { id },
      data: {
        title: corpo.data.title ?? t.title,
        visibility: visibilidadeNova,
        spaceId: espacoNovo
      },
      include: { owner: { select: vozUserSelect } }
    });

    /*
     * Mudou quem pode ver: quem já estava dentro é posto para fora.
     *
     * Ser membro da sala é o que dá acesso ao chat, e essa associação foi criada
     * quando a regra era outra. Deixá-la de pé faria uma transmissão que acabou
     * de virar privada continuar aberta para exatamente as pessoas de quem se
     * quis fechá-la. Todo mundo volta pela porta da frente, que confere de novo.
     */
    if (apertou) {
      const antigos = await prisma.roomMember.findMany({
        where: { roomId: t.roomId, userId: { not: request.userId } },
        select: { userId: true }
      });
      const ids = antigos.map((m) => m.userId);
      if (ids.length > 0) {
        await prisma.roomMember.deleteMany({
          where: { roomId: t.roomId, userId: { in: ids } }
        });
        emitToUsers(ids, "stream:closed", { streamId: id, roomId: t.roomId });
        await Promise.all(ids.map((u) => leaveUserSockets(u, t.roomId)));
      }
    }

    return { stream: paraFora(atualizada, true, await quantosAssistem(atualizada.id)) };
  });

  /**
   * Entrar no ar. Devolve o crachá de quem PUBLICA.
   *
   * Uma transmissão que já terminou pode recomeçar — `endedAt` volta a nulo. É o
   * caso de quem caiu e voltou, e obrigá-lo a criar outra perderia o chat e o
   * link que ele já tinha mandado para as pessoas.
   */
  app.post("/streams/:id/go-live", async (request, reply) => {
    if (!callsEnabled) {
      return falha(reply, 503, "calls.disabled", "Calls are not set up on this server.");
    }
    const { id } = request.params as { id: string };
    const { t, erro } = await minha(id, request.userId);
    if (erro === "missing") return falha(reply, 404, "streams.missing", "That broadcast does not exist.");
    if (erro === "alheia") {
      return falha(reply, 403, "streams.not_yours", "Only the person broadcasting can do that.");
    }

    const noAr = await prisma.stream.update({
      where: { id },
      data: { startedAt: new Date(), endedAt: null },
      include: { owner: { select: vozUserSelect } }
    });

    const token = new AccessToken(env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!, {
      identity: request.userId,
      name: noAr.owner.displayName,
      metadata: JSON.stringify({ username: noAr.owner.username, avatarUrl: noAr.owner.avatarUrl }),
      ttl: "4h"
    });
    token.addGrant({
      room: salaDaTransmissao(id),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: [
        TrackSource.CAMERA,
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO
      ]
    });

    return {
      modo: "webrtc" as const,
      url: env.LIVEKIT_URL,
      token: await token.toJwt(),
      stream: paraFora(noAr, true, await quantosAssistem(noAr.id))
    };
  });

  /** Sair do ar. Esvazia a sala do LiveKit para ninguém ficar falando sozinho. */
  app.post("/streams/:id/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { t, erro } = await minha(id, request.userId);
    if (erro === "missing") return falha(reply, 404, "streams.missing", "That broadcast does not exist.");
    if (erro === "alheia") {
      return falha(reply, 403, "streams.not_yours", "Only the person broadcasting can do that.");
    }

    await prisma.stream.update({ where: { id }, data: { endedAt: new Date() } });
    /*
     * Derrubar a sala no LiveKit é o que garante que acabou. Sem isso, quem
     * estava assistindo continuaria conectado a uma sala que a nossa lista já
     * não mostra — o mesmo fantasma que já custou caro nas chamadas.
     */
    await encerrarTransmissao(id);
    emitToRoom(t.roomId, "stream:ended", { streamId: id, roomId: t.roomId });
    return reply.code(204).send();
  });

  /**
   * Assistir. Devolve o crachá de quem SÓ ESCUTA.
   *
   * A resposta é uma união marcada por `modo`, e isso é de propósito: hoje cada
   * espectador recebe a própria cópia do vídeo pelo LiveKit, o que não passa de
   * algumas dezenas de pessoas. Quando passar, o servidor vai responder
   * `{ modo: "hls", url }` para quem chegar depois do limite, e o cliente já
   * sabe olhar para o `modo` antes de decidir como tocar. A troca da entrega de
   * mídia deixa de ser uma reescrita e vira um `if`.
   */
  app.post("/streams/:id/watch", async (request, reply) => {
    if (!callsEnabled) {
      return falha(reply, 503, "calls.disabled", "Calls are not set up on this server.");
    }
    const { id } = request.params as { id: string };
    const corpo = z.object({ codigo: z.string().max(64).optional() }).safeParse(request.body ?? {});
    const codigo = corpo.success ? corpo.data.codigo : undefined;

    const t = await prisma.stream.findUnique({
      where: { id },
      include: { owner: { select: vozUserSelect } }
    });
    if (!t) return falha(reply, 404, "streams.missing", "That broadcast does not exist.");

    const souDono = t.ownerId === request.userId;
    const ehMembroDoEspaco = t.spaceId
      ? Boolean(
          await prisma.spaceMember.findUnique({
            where: { spaceId_userId: { spaceId: t.spaceId, userId: request.userId } }
          })
        )
      : false;

    if (!podeAssistir(paraRegra(t), { userId: request.userId, ehMembroDoEspaco, codigo })) {
      return falha(reply, 403, "streams.private", "This broadcast is private.");
    }
    if (!estaNoAr(t)) {
      return falha(reply, 409, "streams.offline", "This broadcast is not live right now.");
    }

    const assistindo = await quantosAssistem(t.id);
    if (!cabeMaisUm(assistindo, teto(), souDono)) {
      return falha(reply, 409, "streams.full", "This broadcast is full right now.", {
        teto: teto()
      });
    }

    /*
     * Vira membro da sala do chat. `upsert` porque entrar duas vezes é o caso
     * comum — recarregar a página é entrar de novo — e porque é assim que
     * `POST /spaces/join/:code` já faz.
     */
    await prisma.roomMember.upsert({
      where: { roomId_userId: { roomId: t.roomId, userId: request.userId } },
      create: { roomId: t.roomId, userId: request.userId },
      update: {}
    });
    await joinUserSockets(request.userId, t.roomId);

    const eu = await prisma.user.findUniqueOrThrow({
      where: { id: request.userId },
      select: vozUserSelect
    });

    const token = new AccessToken(env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!, {
      identity: request.userId,
      name: eu.displayName,
      metadata: JSON.stringify({ username: eu.username, avatarUrl: eu.avatarUrl }),
      ttl: "4h"
    });
    /*
     * QUEM DECIDE O CRACHÁ É O SERVIDOR, e não a tela.
     *
     * A primeira versão deixava o cliente escolher a porta — `/go-live` para
     * quem transmite, `/watch` para quem assiste — e a tela do dono entrava
     * pela segunda. Resultado, medido na API de administração do LiveKit: o
     * dono aparecia na própria sala com `canPublish: false` e `hidden: true`,
     * ou seja, incapaz de transmitir a própria transmissão.
     *
     * Aqui não há o que o cliente possa errar: a rota olha quem está pedindo.
     */
    if (souDono) {
      token.addGrant({
        room: salaDaTransmissao(id),
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canPublishSources: [
          TrackSource.CAMERA,
          TrackSource.MICROPHONE,
          TrackSource.SCREEN_SHARE,
          TrackSource.SCREEN_SHARE_AUDIO
        ]
      });
    } else {
      token.addGrant({
        room: salaDaTransmissao(id),
        roomJoin: true,
        /*
         * Os três "não" que fazem de alguém um espectador. O `hidden` é o que
         * impede a tela de quem transmite de tentar desenhar um quadradinho por
         * pessoa que está assistindo — ela monta um tile por participante
         * remoto, sem teto nenhum.
         */
        canPublish: false,
        canPublishData: false,
        canSubscribe: true,
        hidden: true
      });
    }

    return {
      modo: "webrtc" as const,
      url: env.LIVEKIT_URL,
      token: await token.toJwt(),
      stream: paraFora(t, souDono, assistindo)
    };
  });

  /** Apagar. Some a sala, some o chat por cascata, some a transmissão. */
  app.delete("/streams/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { t, erro } = await minha(id, request.userId);
    if (erro === "missing") return falha(reply, 404, "streams.missing", "That broadcast does not exist.");
    if (erro === "alheia") {
      return falha(reply, 403, "streams.not_yours", "Only the person broadcasting can do that.");
    }

    const membros = await prisma.roomMember.findMany({
      where: { roomId: t.roomId },
      select: { userId: true }
    });
    const ids = membros.map((m) => m.userId);

    await encerrarTransmissao(id);
    await prisma.room.delete({ where: { id: t.roomId } });

    emitToUsers(ids, "stream:closed", { streamId: id, roomId: t.roomId });
    await Promise.all(ids.map((u) => leaveUserSockets(u, t.roomId)));
    return reply.code(204).send();
  });
}
