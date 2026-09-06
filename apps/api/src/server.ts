import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { env, callsEnabled } from "./env.js";
import { prisma } from "./lib/prisma.js";
import { driver, initStorage } from "./lib/storage.js";
import { redisEnabled } from "./lib/redis.js";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { roomRoutes } from "./routes/rooms.js";
import { messageRoutes } from "./routes/messages.js";
import { spaceRoutes } from "./routes/spaces.js";
import { fileRoutes } from "./routes/files.js";
import { callRoutes } from "./routes/calls.js";
import { attachSocketServer } from "./realtime/socket.js";
import { falha } from "./lib/falha.js";

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    transport: env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" }
  },
  bodyLimit: 2 * 1024 * 1024,
  trustProxy: true
});

async function main() {
  /*
   * This has to come before the first app.register.
   *
   * Fastify snapshots the error handler onto each route when the plugin that
   * registered it finishes loading (route.js: `context.errorHandler = ...`
   * inside `this.after`). Registered after the plugins, this is dead code that
   * fails silently — every 500 then falls through to the default handler, which
   * serialises the raw error and hands the client Prisma's model, field and
   * constraint names.
   */
  app.setErrorHandler((error: unknown, _request, reply) => {
    app.log.error(error);
    const detail = error as { statusCode?: number; message?: string };
    const status = detail.statusCode ?? 500;
    /*
      O `code` acompanha ate aqui, no ultimo recurso: sem ele o cliente nao
      teria como traduzir justamente o erro que ele mais mostra — o inesperado.
    */
    if (status >= 500) {
      return falha(reply, status, "server.broke", "Something broke on our side. Try again.");
    }
    return falha(
      reply,
      status,
      "server.bad_request",
      detail.message ?? "That request could not be handled."
    );
  });

  const origins = env.CORS_ORIGINS.split(",").map((o) => o.trim());
  await app.register(cors, {
    origin: origins.includes("*") ? true : origins,
    credentials: true
  });

  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 }
  });

  app.get("/health", async () => ({
    ok: true,
    storage: driver,
    calls: callsEnabled,
    realtimeScaling: redisEnabled
  }));

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(roomRoutes);
  await app.register(messageRoutes);
  await app.register(spaceRoutes);
  await app.register(fileRoutes);
  await app.register(callRoutes);

  // Storage failing to initialise must not stop the app from serving messages.
  await initStorage().catch((err) =>
    app.log.warn(`storage not ready at boot: ${err?.message ?? err}`)
  );

  await app.listen({ port: env.PORT, host: env.HOST });
  await attachSocketServer(app.server);

  app.log.info(
    `WhatsCord API on :${env.PORT} · storage=${driver} · calls=${callsEnabled} · redis=${redisEnabled}`
  );
}

async function shutdown(signal: string) {
  app.log.info(`${signal} received, shutting down`);
  await app.close().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
