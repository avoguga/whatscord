import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { prisma } from "../lib/prisma.js";
import { env, callsEnabled } from "../env.js";
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
 * exige. Nenhuma exige conta — dá para criar uma reunião instantânea direto da
 * tela de login, como no Meet. Encerrar e remover gente exigem ser o
 * anfitrião: a conta que criou, ou, se quem criou não tinha conta, quem guarda
 * a chave que saiu na criação.
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
// Criar sem conta: bem mais apertado que com conta (40 por hora por conta),
// porque aqui o único freio é o endereço de rede.
const podeCriarSemConta = criarLimite(10, 60 * 60 * 1000);

/**
 * A chave do anfitrião sem conta. Sai uma vez, na criação, e fica só no
 * navegador de quem criou; o banco guarda o hash, como os links de senha.
 */
const hashDaChave = (chave: string) => crypto.createHash("sha256").update(chave).digest("hex");

function temAChave(m: { hostKeyHash: string | null }, chave: unknown): boolean {
  if (!m.hostKeyHash || typeof chave !== "string" || chave.length === 0 || chave.length > 200) {
    return false;
  }
  const a = Buffer.from(hashDaChave(chave), "hex");
  const b = Buffer.from(m.hostKeyHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** A chave pode vir no corpo de qualquer rota de reunião. */
function chaveNoCorpo(request: FastifyRequest): unknown {
  const corpo = request.body;
  return corpo && typeof corpo === "object" ? (corpo as { chave?: unknown }).chave : undefined;
}

/**
 * Quem criou, do jeito que a tela mostra. Sem conta não há id nem foto — só o
 * nome que a pessoa digitou.
 */
function anfitriaoDe(m: {
  owner: { id: string; displayName: string; avatarUrl: string | null } | null;
  hostName: string | null;
}) {
  return m.owner ?? { id: null, displayName: m.hostName ?? "?", avatarUrl: null };
}

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
   * Criar uma reunião. Com conta, o link sai com o nome do perfil e a conta é a
   * anfitriã. Sem conta (a "reunião instantânea" da tela de login), a pessoa
   * diz o nome e recebe uma chave de anfitrião — é ela que permite remover
   * gente e encerrar, e só existe no navegador de quem criou.
   */
  app.post("/meetings", async (request, reply) => {
    if (!callsEnabled) {
      return falha(reply, 503, "calls.disabled", "Calls are not set up on this server.");
    }
    const quem = quemPede(request);
    if (quem === "invalido") {
      return falha(reply, 401, "auth.expired", "Your session expired. Sign in again.");
    }
    const corpo = z
      .object({ title: z.string().trim().max(80).optional(), nome: z.unknown().optional() })
      .safeParse(request.body ?? {});
    const titulo = corpo.success && corpo.data.title ? corpo.data.title : null;

    let nomeDoAnfitriao: string | null = null;
    let chave: string | null = null;
    if (quem) {
      // Teto de criação por conta: um link por minuto e meio, em média, é folga
      // para qualquer uso humano e trava quem quer encher o banco de reuniões.
      const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000);
      const criadas = await prisma.meeting.count({
        where: { ownerId: quem.userId, createdAt: { gt: umaHoraAtras } }
      });
      if (criadas >= 40) {
        return falha(reply, 429, "meetings.too_many", "You have created too many meetings. Try again later.");
      }
    } else {
      nomeDoAnfitriao = corpo.success ? nomeDeConvidado(corpo.data.nome) : null;
      if (!nomeDoAnfitriao) {
        return falha(reply, 400, "meetings.needs_name", "Type your name to join.");
      }
      if (!podeCriarSemConta(request.ip)) {
        return falha(reply, 429, "meetings.too_many", "You have created too many meetings. Try again later.");
      }
      chave = crypto.randomBytes(24).toString("base64url");
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
          ownerId: quem ? quem.userId : null,
          hostName: nomeDoAnfitriao,
          hostKeyHash: chave ? hashDaChave(chave) : null,
          expiresAt: new Date(Date.now() + VALIDADE_DA_REUNIAO_MS)
        },
        include: { owner: { select: hostSelect } }
      });
      return reply.code(201).send({
        reuniao: { code: m.code, title: m.title, host: anfitriaoDe(m), ativa: true, pessoas: 0 },
        link: linkDaReuniao(m.code),
        // Só sai para quem criou sem conta, e só desta vez.
        ...(chave ? { chave } : {})
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
        host: anfitriaoDe(m),
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

    const souAnfitriao =
      (quem !== null && m.ownerId !== null && quem.userId === m.ownerId) ||
      temAChave(m, chaveNoCorpo(request));
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
      // `anfitriao` vai aqui porque o anfitrião de uma reunião instantânea não
      // tem conta: a tela não tem um id para comparar.
      metadata: JSON.stringify({ avatarUrl, convidado: !quem, anfitriao: souAnfitriao }),
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
      reuniao: { code: m.code, title: m.title, host: anfitriaoDe(m), link: linkDaReuniao(m.code) }
    };
  });

  /**
   * Carrega a reunião e confere que quem pede é o anfitrião: a conta que criou,
   * ou quem tem a chave de uma reunião criada sem conta.
   */
  async function minha(request: FastifyRequest, code: string) {
    const quem = quemPede(request);
    if (quem === "invalido") return { erro: "sessao" as const };
    const chave = chaveNoCorpo(request);
    if (!quem && !chave) return { erro: "ninguem" as const };
    if (!ehCodigoDeReuniao(code)) return { erro: "missing" as const };
    const m = await prisma.meeting.findUnique({ where: { code } });
    if (!m) return { erro: "missing" as const };
    const dono = quem !== null && m.ownerId !== null && quem.userId === m.ownerId;
    if (!dono && !temAChave(m, chave)) return { erro: "alheia" as const };
    return { m, userId: quem?.userId ?? null };
  }

  function recusa(reply: FastifyReply, erro: "sessao" | "ninguem" | "missing" | "alheia") {
    if (erro === "sessao") return falha(reply, 401, "auth.expired", "Your session expired. Sign in again.");
    if (erro === "ninguem") return falha(reply, 401, "auth.required", "Sign in to continue.");
    if (erro === "missing") return falha(reply, 404, "meetings.missing", "That meeting does not exist.");
    return falha(reply, 403, "meetings.not_host", "Only the person who created the meeting can do that.");
  }

  /** Encerrar para todos. Derruba a sala e o link deixa de abrir. */
  app.post("/meetings/:code/end", async (request, reply) => {
    const { code } = request.params as { code: string };
    const r = await minha(request, code);
    if (!r.m) return recusa(reply, r.erro);
    const { m } = r;
    await prisma.meeting.update({ where: { id: m.id }, data: { endedAt: new Date() } });
    await encerrarReuniao(m.id);
    return reply.code(204).send();
  });

  /**
   * Remover alguém. É a porta de saída de um link aberto: quem entrou sem ser
   * chamado sai pela mão do anfitrião.
   */
  app.post("/meetings/:code/remove", async (request, reply) => {
    const { code } = request.params as { code: string };
    const corpo = z.object({ identidade: z.string().min(1).max(100) }).safeParse(request.body);
    if (!corpo.success) {
      return falha(reply, 400, "meetings.pick_who", "Say who to remove.");
    }
    const r = await minha(request, code);
    if (!r.m) return recusa(reply, r.erro);
    const { m } = r;
    if (corpo.data.identidade === r.userId) {
      return falha(reply, 400, "meetings.pick_who", "Say who to remove.");
    }
    await removerDaReuniao(m.id, corpo.data.identidade);
    return reply.code(204).send();
  });
}

