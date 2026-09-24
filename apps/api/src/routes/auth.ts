import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { env } from "../env.js";
import { emailConfigurado, enviarEmail } from "../lib/email.js";
import {
  VALIDADE_DO_LINK_MS,
  idiomaDoEmail,
  linkDeRedefinicao,
  montarEmailDeRedefinicao,
  podePedirOutro,
  redefinicaoValida,
  type Idioma
} from "../lib/redefinirSenha.js";
import { prisma } from "../lib/prisma.js";
import { userSelect } from "../lib/shapes.js";
import { authGuard } from "../plugins/auth.js";
import { falha, falhaDeValidacao } from "../lib/falha.js";
import {
  hashPassword,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  verifyPassword
} from "../lib/auth.js";

const registerBody = z.object({
  email: z.string().email("Enter a valid email address."),
  username: z
    .string()
    .min(3, "Usernames are at least 3 characters.")
    .max(24)
    .regex(/^[a-z0-9_.]+$/, "Use lowercase letters, numbers, dots and underscores."),
  displayName: z.string().min(1).max(48),
  password: z.string().min(8, "Use at least 8 characters.")
});

const loginBody = z.object({
  identifier: z.string().min(1, "Enter your email or username."),
  password: z.string().min(1, "Enter your password.")
});


const sha256 = (valor: string) => crypto.createHash("sha256").update(valor).digest("hex");

/**
 * Teto por endereço de rede para o "esqueci a senha".
 *
 * O teto por CONTA (`PEDIDOS_POR_HORA`) protege a caixa de entrada de uma
 * pessoa; este protege o nosso remetente. Sem ele, alguém digitaria mil e-mails
 * diferentes, cada um dentro do teto da própria conta, e o Gmail de onde saem as
 * mensagens seria marcado como spam para todo mundo.
 *
 * Na memória do processo, e não no Redis: um limite que zera quando a API
 * reinicia é um limite pior, mas não é um buraco — o teto por conta, que mora no
 * banco, continua valendo.
 */
const PEDIDOS_POR_IP_POR_HORA = 10;
const pedidosPorIp = new Map<string, number[]>();

function ipPodePedir(ip: string, agora = Date.now()): boolean {
  const umaHoraAtras = agora - 60 * 60 * 1000;
  const recentes = (pedidosPorIp.get(ip) ?? []).filter((t) => t > umaHoraAtras);
  if (recentes.length >= PEDIDOS_POR_IP_POR_HORA) {
    pedidosPorIp.set(ip, recentes);
    return false;
  }
  recentes.push(agora);
  pedidosPorIp.set(ip, recentes);
  // Faxina ocasional, para o mapa não crescer para sempre com IPs que sumiram.
  if (pedidosPorIp.size > 5000) {
    for (const [chave, tempos] of pedidosPorIp) {
      if (!tempos.some((t) => t > umaHoraAtras)) pedidosPorIp.delete(chave);
    }
  }
  return true;
}

/**
 * Cria o link e manda o e-mail. Roda DEPOIS de a resposta sair.
 *
 * Não é só para a rota responder rápido: é para a rota responder no MESMO
 * tempo exista ou não a conta. Se ela esperasse o Gmail, um e-mail cadastrado
 * demoraria um segundo e um inexistente, alguns milissegundos — e o relógio
 * contaria quem tem conta aqui, que é justamente o que a resposta igual para
 * todo mundo existe para esconder.
 */
async function mandarLink(
  user: { id: string; email: string; username: string; displayName: string },
  idioma: Idioma,
  log: FastifyBaseLogger
) {
  try {
    const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000);
    const pedidos = await prisma.passwordReset.count({
      where: { userId: user.id, createdAt: { gt: umaHoraAtras } }
    });
    if (!podePedirOutro(pedidos)) {
      log.warn({ userId: user.id }, "redefinicao de senha: teto por hora atingido");
      return;
    }

    // O token só existe aqui e no e-mail. No banco vai o hash.
    const token = crypto.randomBytes(32).toString("base64url");
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + VALIDADE_DO_LINK_MS)
      }
    });

    const email = montarEmailDeRedefinicao({
      nome: user.displayName,
      usuario: user.username,
      link: linkDeRedefinicao(env.WEB_URL, token),
      idioma
    });
    await enviarEmail({ para: user.email, ...email });
    log.info({ userId: user.id }, "redefinicao de senha: e-mail enviado");
  } catch (err) {
    log.error({ err, userId: user.id }, "redefinicao de senha: falhou ao enviar");
  }
}

/** Uma sessão nova, no mesmo formato do login. */
async function novaSessao(userId: string, userAgent?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: userSelect });
  const refresh = await issueRefreshToken(user.id, userAgent);
  return {
    user,
    accessToken: signAccessToken({ sub: user.id, username: user.username }),
    refreshToken: refresh.token
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", async (request, reply) => {
    const parsed = registerBody.safeParse(request.body);
    if (!parsed.success) {
      return falhaDeValidacao(reply, parsed.error.issues[0].message);
    }
    const { email, username, displayName, password } = parsed.data;

    const clash = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { username }] },
      select: { email: true, username: true }
    });
    if (clash) {
      return clash.username === username
        ? falha(reply, 409, "auth.username_taken", "That username is taken.")
        : falha(reply, 409, "auth.email_taken", "An account already uses that email.");
    }

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        username,
        displayName,
        passwordHash: await hashPassword(password)
      },
      select: userSelect
    });

    const refresh = await issueRefreshToken(user.id, request.headers["user-agent"]);
    return reply.code(201).send({
      user,
      accessToken: signAccessToken({ sub: user.id, username: user.username }),
      refreshToken: refresh.token
    });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) {
      return falhaDeValidacao(reply, parsed.error.issues[0].message);
    }
    const { identifier, password } = parsed.data;

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier.toLowerCase() }, { username: identifier.toLowerCase() }]
      }
    });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return falha(reply, 401, "auth.bad_credentials", "That email or password is not right.");
    }

    const refresh = await issueRefreshToken(user.id, request.headers["user-agent"]);
    return reply.send({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        presence: user.presence,
        lastSeenAt: user.lastSeenAt
      },
      accessToken: signAccessToken({ sub: user.id, username: user.username }),
      refreshToken: refresh.token
    });
  });

  app.post("/auth/refresh", async (request, reply) => {
    const body = z.object({ refreshToken: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return falha(reply, 400, "auth.missing_refresh", "Missing refresh token.");

    const rotated = await rotateRefreshToken(body.data.refreshToken, request.headers["user-agent"]);
    if (!rotated) return falha(reply, 401, "auth.sign_in_again", "Sign in again.");

    return reply.send({
      accessToken: signAccessToken({
        sub: rotated.user.id,
        username: rotated.user.username
      }),
      refreshToken: rotated.refresh.token
    });
  });

  app.post("/auth/logout", async (request, reply) => {
    const body = z.object({ refreshToken: z.string().optional() }).safeParse(request.body);
    if (body.success && body.data.refreshToken) {
      await revokeRefreshToken(body.data.refreshToken);
    }
    return reply.send({ ok: true });
  });


  /**
   * "Esqueci a senha": pede o link por e-mail.
   *
   * A resposta é a MESMA — 204 — exista ou não uma conta com esse e-mail. Dizer
   * "não achamos esse e-mail" transformaria o formulário num jeito de descobrir
   * quem tem conta aqui, um endereço por vez. A tela diz "se houver uma conta,
   * mandamos", que é verdade nos dois casos.
   *
   * A única resposta diferente é quando o envio não está ligado no servidor, e
   * ela é igual para todo mundo: não conta nada sobre conta nenhuma, e é melhor
   * do que a pessoa esperar para sempre por um e-mail que nunca vai sair.
   */
  app.post("/auth/forgot", async (request, reply) => {
    if (!emailConfigurado) {
      return falha(
        reply,
        503,
        "auth.email_disabled",
        "Password reset by email is not set up on this server yet."
      );
    }
    const body = z
      .object({
        email: z.string().email("Enter a valid email address."),
        idioma: z.string().optional()
      })
      .safeParse(request.body);
    if (!body.success) return falhaDeValidacao(reply, body.error.issues[0].message);

    if (!ipPodePedir(request.ip)) {
      return falha(reply, 429, "auth.slow_down", "Too many requests. Try again in a while.");
    }

    const user = await prisma.user.findUnique({
      where: { email: body.data.email.toLowerCase() },
      select: { id: true, email: true, username: true, displayName: true }
    });
    // Sem `await`, de propósito. Ver `mandarLink`.
    if (user) void mandarLink(user, idiomaDoEmail(body.data.idioma), request.log);

    return reply.code(204).send();
  });

  /**
   * Usar o link: troca a senha e já entra.
   *
   * Entrar direto, em vez de mandar para a tela de login, porque a pessoa acabou
   * de provar que é dona do e-mail — pedir a senha que ela acabou de digitar
   * seria só mais um passo para errar.
   *
   * Todas as sessões antigas caem junto. Quem esquece a senha às vezes está
   * trocando justamente porque desconfia de alguém; deixar aberta uma sessão
   * num aparelho alheio anularia a troca.
   */
  app.post("/auth/reset", async (request, reply) => {
    const body = z
      .object({
        token: z.string().min(20).max(200),
        password: z.string().min(8, "Use at least 8 characters.")
      })
      .safeParse(request.body);
    if (!body.success) {
      const problema = body.error.issues[0];
      if (problema.path[0] === "password") return falhaDeValidacao(reply, problema.message);
      return falha(reply, 400, "auth.reset_invalid", "That reset link is invalid or has expired.");
    }

    const pedido = await prisma.passwordReset.findUnique({
      where: { tokenHash: sha256(body.data.token) }
    });
    const agora = new Date();
    if (!redefinicaoValida(pedido, agora)) {
      return falha(reply, 400, "auth.reset_invalid", "That reset link is invalid or has expired.");
    }

    // O bcrypt é lento de propósito; fica fora da transação para não segurá-la.
    const hash = await hashPassword(body.data.password);

    const usou = await prisma.$transaction(async (tx) => {
      /*
       * Marca como usado SÓ se ainda não estava. Dois cliques no mesmo link —
       * ou o link aberto em dois aparelhos — passariam os dois pela checagem
       * acima; é esta linha que deixa só um deles valer.
       */
      const marcou = await tx.passwordReset.updateMany({
        where: { id: pedido!.id, usedAt: null },
        data: { usedAt: agora }
      });
      if (marcou.count !== 1) return false;

      await tx.user.update({ where: { id: pedido!.userId }, data: { passwordHash: hash } });
      // Os outros links pendentes da mesma pessoa morrem: a senha já mudou.
      await tx.passwordReset.updateMany({
        where: { userId: pedido!.userId, usedAt: null },
        data: { usedAt: agora }
      });
      await tx.refreshToken.updateMany({
        where: { userId: pedido!.userId, revokedAt: null },
        data: { revokedAt: agora }
      });
      return true;
    });
    if (!usou) {
      return falha(reply, 400, "auth.reset_invalid", "That reset link is invalid or has expired.");
    }

    return reply.send(await novaSessao(pedido!.userId, request.headers["user-agent"]));
  });

  /**
   * Trocar a senha, já estando dentro.
   *
   * Pede a senha ATUAL. Sem isso, qualquer pessoa diante de um app deixado
   * aberto — um computador emprestado, uma aba esquecida — trocaria a senha e
   * tomaria a conta de quem saiu da frente da tela.
   *
   * As outras sessões caem, e a resposta traz uma sessão nova para este
   * aparelho: quem troca a senha continua dentro onde está, e sai de todo o resto.
   */
  app.post("/auth/password", { preHandler: authGuard }, async (request, reply) => {
    const body = z
      .object({
        atual: z.string().min(1, "Enter your password."),
        nova: z.string().min(8, "Use at least 8 characters.")
      })
      .safeParse(request.body);
    if (!body.success) return falhaDeValidacao(reply, body.error.issues[0].message);

    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) return falha(reply, 404, "auth.account_missing", "Account not found.");
    if (!(await verifyPassword(body.data.atual, user.passwordHash))) {
      return falha(reply, 403, "auth.wrong_password", "Your current password is not right.");
    }

    const hash = await hashPassword(body.data.nova);
    const agora = new Date();
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: agora }
      }),
      prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: agora }
      })
    ]);

    return reply.send(await novaSessao(user.id, request.headers["user-agent"]));
  });

  app.get("/auth/me", { preHandler: authGuard }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      select: userSelect
    });
    if (!user) return falha(reply, 404, "auth.account_missing", "Account not found.");
    return reply.send({ user });
  });
}
