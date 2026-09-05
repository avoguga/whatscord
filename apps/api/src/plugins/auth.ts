import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "../lib/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

/** Rejects the request unless it carries a valid access token. */
export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Sign in to continue." });
  }
  const claims = verifyAccessToken(header.slice(7));
  if (!claims) {
    return reply.code(401).send({ error: "Your session expired. Sign in again." });
  }
  request.userId = claims.sub;
}
