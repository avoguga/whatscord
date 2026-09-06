import type { FastifyInstance } from "fastify";
import { z } from "zod";
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

  app.get("/auth/me", { preHandler: authGuard }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      select: userSelect
    });
    if (!user) return falha(reply, 404, "auth.account_missing", "Account not found.");
    return reply.send({ user });
  });
}
