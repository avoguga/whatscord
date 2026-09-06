import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { authGuard } from "../plugins/auth.js";
import { getObjectStream, isServableKey, newObjectKey, putObject } from "../lib/storage.js";
import { falha } from "../lib/falha.js";

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

/**
 * Only these types are ever echoed back as the response Content-Type.
 *
 * The download route is deliberately unauthenticated, so letting the uploader
 * choose the type turns this origin into a place to host `text/html` — a script
 * served from the API's own origin. Anything not on this list is served as an
 * opaque download instead.
 *
 * SVG is excluded on purpose: it is an image that can carry script.
 */
const INLINE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/mp4",
  "application/pdf",
  "text/plain"
]);

function safeContentType(mime: string) {
  const base = mime.split(";")[0].trim().toLowerCase();
  return INLINE_TYPES.has(base) ? base : "application/octet-stream";
}

export async function fileRoutes(app: FastifyInstance) {
  app.post("/files", { preHandler: authGuard }, async (request, reply) => {
    const uploaded = await request.file({
      limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 }
    });
    if (!uploaded) return falha(reply, 400, "files.none", "Attach a file to upload.");

    const buffer = await uploaded.toBuffer().catch(() => null);
    if (!buffer) {
      /*
       * O limite vai em `params`, e não colado na frase: em português a
       * frase é "Os arquivos precisam ter menos de 25 MB", com o número no
       * meio. Concatenar aqui obrigaria a tradução a manter a ordem do
       * inglês.
       */
      return falha(
        reply,
        413,
        "files.too_big",
        `Files have to be under ${env.MAX_UPLOAD_MB} MB.`,
        { mb: env.MAX_UPLOAD_MB }
      );
    }
    if (buffer.length === 0) {
      return falha(reply, 400, "files.empty", "That file is empty.");
    }

    const key = newObjectKey(uploaded.filename ?? "file.bin", request.userId);
    // Store the sanitised type, so the decision cannot be revisited on the way out.
    const mime = safeContentType(uploaded.mimetype || "application/octet-stream");
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
    // Also refuses the driver's internal `.type` sidecar, which is storage
    // metadata and never a file anyone uploaded.
    if (!isServableKey(key)) return falha(reply, 400, "files.bad_reference", "Bad file reference.");

    try {
      const object = await getObjectStream(key);
      const type = safeContentType(object.contentType);

      reply.header("Content-Type", type);
      if (object.contentLength) reply.header("Content-Length", String(object.contentLength));
      // Stop the browser from second-guessing the type we just narrowed.
      reply.header("X-Content-Type-Options", "nosniff");
      // Anything not on the inline list downloads instead of rendering.
      if (type === "application/octet-stream") {
        reply.header("Content-Disposition", "attachment");
      }
      reply.header("Cache-Control", "private, max-age=31536000, immutable");
      return reply.send(object.body);
    } catch {
      return falha(reply, 404, "files.gone", "That file is no longer here.");
    }
  });
}
