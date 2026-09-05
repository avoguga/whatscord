import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { authGuard } from "../plugins/auth.js";
import { getObjectStream, newObjectKey, putObject } from "../lib/storage.js";

/**
 * Uploads go to whichever storage driver is configured; downloads are proxied
 * back through here rather than handed out as direct links.
 *
 * Proxying costs a little bandwidth but buys a lot: storage never has to be
 * reachable from the internet, there are no signed URLs to expire while the
 * desktop app sits open overnight, and every asset shares the API's origin —
 * which matters inside the Tauri webview, where a plain-http URL would be
 * blocked as mixed content.
 */
export async function fileRoutes(app: FastifyInstance) {
  app.post("/files", { preHandler: authGuard }, async (request, reply) => {
    const uploaded = await request.file({
      limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 }
    });
    if (!uploaded) return reply.code(400).send({ error: "Attach a file to upload." });

    const buffer = await uploaded.toBuffer().catch(() => null);
    if (!buffer) {
      return reply
        .code(413)
        .send({ error: `Files have to be under ${env.MAX_UPLOAD_MB} MB.` });
    }

    const key = newObjectKey(uploaded.filename ?? "file.bin");
    const mime = uploaded.mimetype || "application/octet-stream";
    await putObject(key, buffer, mime);

    // The client hands these straight back when it posts the message.
    return reply.code(201).send({
      key,
      name: uploaded.filename ?? "file",
      mime,
      size: buffer.length,
      url: `/files/${encodeURIComponent(key)}`
    });
  });

  /**
   * Deliberately unauthenticated: the desktop webview renders these in <img>
   * and <video> tags, which cannot carry an Authorization header. Keys are
   * random UUIDs, so the URL is the capability.
   */
  app.get("/files/*", async (request, reply) => {
    const key = decodeURIComponent((request.params as Record<string, string>)["*"] ?? "");
    if (!key || key.includes("..")) return reply.code(400).send({ error: "Bad file reference." });

    try {
      const object = await getObjectStream(key);
      reply.header("Content-Type", object.contentType);
      if (object.contentLength) reply.header("Content-Length", String(object.contentLength));
      reply.header("Cache-Control", "private, max-age=31536000, immutable");
      return reply.send(object.body);
    } catch {
      return reply.code(404).send({ error: "That file is no longer here." });
    }
  });
}
