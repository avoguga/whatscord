import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { prisma } from "../lib/prisma.js";
import { env, callsEnabled } from "../env.js";
import { authGuard } from "../plugins/auth.js";
import { verifyAccessToken } from "../lib/auth.js";
import { falha } from "../lib/falha.js";
import {
  encerrarReuniao,
  pessoasNaReuniao,
  prepararReuniao,
  removerDaReuniao
} from "../lib/livekitSala.js";
import {
  TETO_DA_REUNIAO,
  VALIDADE_DA_REUNIAO_MS,
  cabeNaReuniao,
  criarLimite,
  ehCodigoDeReuniao,
  gerarCodigo,
  identidadeDeConvidado,
  nomeDeConvidado,
  reuniaoAtiva,
  salaDaReuniao
} from "../lib/reuniao.js";

/**
 * Reuniões por link, no jeito do Google Meet.
 *
 * É o ÚNICO lugar da API em que alguém sem conta faz alguma coisa. Por isso
 * este plugin não põe o `authGuard` em tudo, como os outros: cada rota diz o que
 * exige. Criar, encerrar e remover gente pedem conta (e ser o anfitrião);
 * espiar a reunião e entrar nela, não.
 *
 * O que segura um link aberto:
 * - o teto de gente, que vai para dentro da sala do LiveKit (não só na API);
 * - o teto de tentativas por endereço de rede, na rota pública;
 * - a etiqueta "convidado", que impede quem não tem conta de se passar por
 *   alguém que tem;
 * - e o anfitrião, que remove quem precisar e encerra para todos.
 */

function teto(): number {
  const bruto = Number(process.env.MEETING_MAX_PARTICIPANTS ?? "");
  return Number.isFinite(bruto) && bruto > 0 ? Math.floor(bruto) : TETO_DA_REUNIAO;
}

const linkDaReuniao = (code: string) => `${env.WEB_URL.replace(/\/+$/, "")}/?call=${code}`;

// Entrar: 40 por hora por endereço. Folga para quem entra e sai várias vezes da
// mesma reunião; aperto para quem testa códigos em sequência.
const podeEntrar = criarLimite(40, 60 * 60 * 1000);
// Espiar a reunião (a tela de espera): mais solto, mas com teto pelo mesmo motivo.
const podeEspiar = criarLimite(120, 60 * 60 * 1000);

/**
 * Quem está pedindo — SE alguém está.
 *
 * Diferente do `authGuard`, que recusa quem não tem token: aqui não ter token é
 * um caso válido (o convidado). O que NÃO é válido é um token inválido — esse
 * volta 401, para o app renovar a sessão e tentar de novo, em vez de cair
 * silenciosamente no modo convidado com o nome de outra pessoa.
 */
function quemPede(request: FastifyRequest): { userId: string } | "invalido" | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const claims = verifyAccessToken(header.slice(7));
  return claims ? { userId: claims.sub } : "invalido";
}

const hostSelect = { id: true, displayName: true, avatarUrl: true } as const;

export async function meetingRoutes(app: FastifyInstance) {
  /**
   * Criar uma reunião. Precisa de conta: o link sai com o nome de quem criou, e
   * é essa pessoa que poderá remover gente e encerrar.
   */
  app.post("/meetings", { preHandler: authGuard }, async (request, reply) => {
    if (!callsEnabled) {
      return falha(reply, 503, "calls.disabled", "Calls are not set up on this server.");
    }
    const corpo = z.object({ title: z.string().trim().max(80).optional() }).safeParse(request.body ?? {});
    const titulo = corpo.success && corpo.data.title ? corpo.data.title : null;

    // Teto de criação por conta: um link por minuto e meio, em média, é folga
    // para qualquer uso humano e trava quem quer encher o banco de reuniões.
    const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000);
    const criadas = await prisma.meeting.count({
      where: { ownerId: request.userId, createdAt: { gt: umaHoraAtras } }
    });
    if (criadas >= 40) {
      return falha(reply, 429, "meetings.too_many", "You have created too many meetings. Try again later.");
    }

    // Colisão em ~47 bits é improvável, mas "improvável" vira um 500 na cara de
    // alguém no dia em que acontece. Tentar de novo custa uma consulta.
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const code = gerarCodigo((max) => crypto.randomInt(max));
      const ja = await prisma.meeting.findUnique({ where: { code }, select: { id: true } });
      if (ja) continue;
      const m = await prisma.meeting.create({
        data: {
          code,
          title: titulo,
          ownerId: request.userId,
          expiresAt: new Date(Date.now() + VALIDADE_DA_REUNIAO_MS)
        },
        include: { owner: { select: hostSelect } }
      });
      return reply.code(201).send({
        reuniao: { code: m.code, title: m.title, host: m.owner, ativa: true, pessoas: 0 },
        link: linkDaReuniao(m.code)
      });
    }
    return falha(reply, 500, "server.broke", "Something broke on our side. Try again.");
  });

  /**
   * Espiar a reunião: o que a tela de espera mostra antes de entrar.
   *
   * Público — é a primeira coisa que quem recebeu o link vê, tenha conta ou
   * não. Mostra o título, quem criou e quantos já estão lá, que é o que o Meet
   * mostra e o que faz a pessoa saber que clicou no lugar certo.
   */
  app.get("/meetings/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    if (!podeEspiar(request.ip)) {
      return falha(reply, 429, "auth.slow_down", "Too many requests. Try again in a while.");
    }
    if (!ehCodigoDeReuniao(code)) {
      return falha(reply, 404, "meetings.missing", "That meeting does not exist.");
    }
    const m = await prisma.meeting.findUnique({
      where: { code },
      include: { owner: { select: hostSelect } }
    });
    if (!m) return falha(reply, 404, "meetings.missing", "That meeting does not exist.");

    const ativa = reuniaoAtiva(m, new Date());
    return {
      reuniao: {
        code: m.code,
        title: m.title,
        host: m.owner,
        ativa,
        pessoas: ativa ? await pessoasNaReuniao(m.id) : 0,
        teto: teto()
      }
    };
  });

  /**
   * Entrar. Com conta ou sem.
   *
   * Com conta, a pessoa entra com o nome e a foto do perfil, e a identidade no
   * LiveKit é o id dela. Sem conta, entra com o nome que digitou e uma
   * identidade `g_…` que existe só nesta reunião — e a tela de todo mundo a
   * marca como convidado.
   */
  app.post("/meetings/:code/join", async (request, reply) => {
    if (!callsEnabled) {
      return falha(reply, 503, "calls.disabled", "Calls are not set up on this server.");
    }
    const { code } = request.params as { code: string };
    if (!podeEntrar(request.ip)) {
      return falha(reply, 429, "auth.slow_down", "Too many requests. Try again in a while.");
    }
    if (!ehCodigoDeReuniao(code)) {
      return falha(reply, 404, "meetings.missing", "That meeting does not exist.");
    }

    const quem = quemPede(request);
    if (quem === "invalido") {
      return falha(reply, 401, "auth.expired", "Your session expired. Sign in again.");
    }

    const m = await prisma.meeting.findUnique({
      where: { code },
      include: { owner: { select: hostSelect } }
    });
    if (!m) return falha(reply, 404, "meetings.missing", "That meeting does not exist.");
    if (!reuniaoAtiva(m, new Date())) {
      return falha(reply, 410, "meetings.ended", "This meeting has ended.");
    }

    let identidade: string;
    let nome: string;
    let avatarUrl: string | null = null;
    if (quem) {
      const user = await prisma.user.findUnique({
        where: { id: quem.userId },
        select: { id: true, displayName: true, avatarUrl: true }
      });
      if (!user) return falha(reply, 404, "auth.account_missing", "Account not found.");
      identidade = user.id;
      nome = user.displayName;
      avatarUrl = user.avatarUrl;
    } else {
      const corpo = z.object({ nome: z.unknown() }).safeParse(request.body ?? {});
      const limpo = corpo.success ? nomeDeConvidado(corpo.data.nome) : null;
      if (!limpo) {
        return falha(reply, 400, "meetings.needs_name", "Type your name to join.");
      }
      identidade = identidadeDeConvidado(crypto.randomBytes(8).toString("hex"));
      nome = limpo;
    }

    const souAnfitriao = quem?.userId === m.ownerId;
    const max = teto();
    await prepararReuniao(m.id, max);
    if (!cabeNaReuniao(await pessoasNaReuniao(m.id), max, souAnfitriao)) {
      return falha(reply, 409, "meetings.full", "This meeting is full right now.", { teto: max });
    }

    const token = new AccessToken(env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!, {
      identity: identidade,
      name: nome,
      // O que a tela de todo mundo precisa para desenhar a pessoa: a foto, e se
      // é convidado. Vai no token, e não numa consulta à API, porque quem
      // assiste pode ser outro convidado — sem conta para perguntar nada.
      metadata: JSON.stringify({ avatarUrl, convidado: !quem }),
      // Um token de convidado não precisa durar mais que uma reunião longa.
      ttl: "6h"
    });
    token.addGrant({
      room: salaDaReuniao(m.id),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      // Dados: é por onde passa o bate-papo da reunião, que precisa funcionar
      // para quem não tem conta — o chat das conversas exige conta.
      canPublishData: true,
      canPublishSources: [
        TrackSource.CAMERA,
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO
      ]
    });

    return {
      url: env.LIVEKIT_URL,
      token: await token.toJwt(),
      identidade,
      nome,
      convidado: !quem,
      souAnfitriao,
      reuniao: { code: m.code, title: m.title, host: m.owner, link: linkDaReuniao(m.code) }
    };
  });

  /** Carrega a reunião e confere que quem pede é o anfitrião. */
  async function minha(code: string, userId: string) {
    if (!ehCodigoDeReuniao(code)) return { erro: "missing" as const };
    const m = await prisma.meeting.findUnique({ where: { code } });
    if (!m) return { erro: "missing" as const };
    if (m.ownerId !== userId) return { erro: "alheia" as const };
    return { m };
  }

  /** Encerrar para todos. Derruba a sala e o link deixa de abrir. */
  app.post("/meetings/:code/end", { preHandler: authGuard }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const { m, erro } = await minha(code, request.userId);
    if (erro === "missing") return falha(reply, 404, "meetings.missing", "That meeting does not exist.");
    if (erro === "alheia") {
      return falha(reply, 403, "meetings.not_host", "Only the person who created the meeting can do that.");
    }
    await prisma.meeting.update({ where: { id: m.id }, data: { endedAt: new Date() } });
    await encerrarReuniao(m.id);
    return reply.code(204).send();
  });

  /**
   * Remover alguém. É a porta de saída de um link aberto: quem entrou sem ser
   * chamado sai pela mão do anfitrião.
   */
  app.post("/meetings/:code/remove", { preHandler: authGuard }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const corpo = z.object({ identidade: z.string().min(1).max(100) }).safeParse(request.body);
    if (!corpo.success) {
      return falha(reply, 400, "meetings.pick_who", "Say who to remove.");
    }
    const { m, erro } = await minha(code, request.userId);
    if (erro === "missing") return falha(reply, 404, "meetings.missing", "That meeting does not exist.");
    if (erro === "alheia") {
      return falha(reply, 403, "meetings.not_host", "Only the person who created the meeting can do that.");
    }
    if (corpo.data.identidade === request.userId) {
      return falha(reply, 400, "meetings.pick_who", "Say who to remove.");
    }
    await removerDaReuniao(m.id, corpo.data.identidade);
    return reply.code(204).send();
  });
}

