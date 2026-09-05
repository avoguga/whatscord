import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { messageDTO, messageInclude } from "../lib/shapes.js";
import { authGuard } from "../plugins/auth.js";
import { HttpError, requireMembership } from "../lib/rooms.js";
import { emitToRoom } from "../realtime/bus.js";
import { deleteObject, objectExists, ownerOfKey } from "../lib/storage.js";

const attachmentInput = z.object({
  key: z.string().min(1),
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(160),
  size: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional()
});

/**
 * Pagination cursor: "<iso timestamp>|<message id>".
 *
 * The id half is not decoration. createdAt is millisecond precision, and
 * messages sharing a millisecond come back from Postgres in a non-deterministic
 * order — a cursor on the timestamp alone skips some of them permanently.
 */
function encodeCursor(createdAt: Date, id: string) {
  return `${createdAt.toISOString()}|${id}`;
}

function decodeCursor(raw: string): { createdAt: Date; id: string } | null {
  const [iso, id] = raw.split("|");
  if (!iso || !id) return null;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

/** Attachment URLs are built as `/files/${encodeURIComponent(key)}`. */
function keyFromUrl(url: string) {
  const prefix = "/files/";
  if (!url.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(url.slice(prefix.length));
  } catch {
    return null;
  }
}

export async function messageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  /** History, newest first, paged backwards with a cursor. */
  app.get("/rooms/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = z
      .object({
        before: z.string().max(120).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(40)
      })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Bad pagination values." });

    const { before, limit } = query.data;
    const cursor = before ? decodeCursor(before) : null;
    if (before && !cursor) {
      return reply.code(400).send({ error: "That pagination cursor is not valid." });
    }

    try {
      await requireMembership(id, request.userId);
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }

    const messages = await prisma.message.findMany({
      where: {
        roomId: id,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } }
              ]
            }
          : {})
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: messageInclude
    });

    // Read the cursor off the oldest row BEFORE reversing — reverse() mutates.
    const oldest = messages[messages.length - 1];
    const nextCursor =
      messages.length === limit && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null;

    return { messages: messages.reverse().map(messageDTO), nextCursor };
  });

  app.post("/rooms/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        content: z.string().max(8000).default(""),
        replyToId: z.string().optional(),
        clientMsgId: z.string().min(8).max(64).optional(),
        attachments: z.array(attachmentInput).max(10).default([])
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0].message });

    const { content, replyToId, clientMsgId, attachments } = body.data;
    if (!content.trim() && attachments.length === 0) {
      return reply.code(400).send({ error: "Write something or attach a file." });
    }

    try {
      await requireMembership(id, request.userId);
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }

    /*
     * A reply has to live in the same room. Without this check a message from a
     * private DM can be quoted into a public channel, and the quote carries the
     * original text and author to everyone there.
     */
    if (replyToId) {
      const parent = await prisma.message.findUnique({
        where: { id: replyToId },
        select: { roomId: true }
      });
      if (!parent || parent.roomId !== id) {
        return reply.code(400).send({ error: "You can only reply to a message in this conversation." });
      }
    }

    /*
     * An attachment has to be something this person actually uploaded, and it
     * has to still be there. Without this you could attach a key you did not
     * upload, or a key that points at nothing — which surfaced as a broken
     * bubble or a 500 rather than a clear refusal.
     */
    for (const a of attachments) {
      const owner = ownerOfKey(a.key);
      if (owner !== request.userId) {
        return reply.code(400).send({ error: "That attachment is not yours to send." });
      }
      if (!(await objectExists(a.key))) {
        return reply.code(400).send({ error: "That attachment is no longer available. Upload it again." });
      }
    }

    // Fast path for a retry that already landed. Scoped to the author, so one
    // person's id can never surface another person's message.
    if (clientMsgId) {
      const already = await prisma.message.findUnique({
        where: { authorId_clientMsgId: { authorId: request.userId, clientMsgId } },
        include: messageInclude
      });
      if (already) {
        if (already.roomId !== id) {
          return reply.code(409).send({ error: "That send already exists in another conversation." });
        }
        return reply.code(200).send({ message: messageDTO(already) });
      }
    }

    let created;
    try {
      created = await prisma.message.create({
        data: {
          roomId: id,
          authorId: request.userId,
          content: content.trim(),
          replyToId: replyToId ?? null,
          clientMsgId: clientMsgId ?? null,
          attachments: {
            create: attachments.map((a) => ({
              url: `/files/${encodeURIComponent(a.key)}`,
              name: a.name,
              mime: a.mime,
              size: a.size,
              width: a.width,
              height: a.height,
              durationMs: a.durationMs
            }))
          }
        },
        include: messageInclude
      });
    } catch (err) {
      /*
       * The check above is an optimisation; the unique index is the guarantee.
       * Two sends racing on the same id — the double click this whole mechanism
       * exists for — both find nothing and both insert. The loser lands here.
       */
      if (
        clientMsgId &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const already = await prisma.message.findUnique({
          where: { authorId_clientMsgId: { authorId: request.userId, clientMsgId } },
          include: messageInclude
        });
        // 200, not 201, and deliberately no emit: the winner already broadcast.
        if (already) return reply.code(200).send({ message: messageDTO(already) });
      }
      throw err;
    }

    const dto = messageDTO(created);
    emitToRoom(id, "message:new", dto);
    return reply.code(201).send({ message: dto });
  });

  app.patch("/messages/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ content: z.string().max(8000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "That edit is not valid." });

    // Validate what will actually be stored. `min(1)` before trimming let a
    // string of spaces through and left the message empty — the very state the
    // create route refuses.
    const content = body.data.content.trim();
    if (!content) return reply.code(400).send({ error: "The message cannot be empty." });

    const existing = await prisma.message.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return reply.code(404).send({ error: "That message is gone." });
    }
    if (existing.authorId !== request.userId) {
      return reply.code(403).send({ error: "You can only edit your own messages." });
    }

    try {
      await requireMembership(existing.roomId, request.userId);
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }

    const updated = await prisma.message.update({
      where: { id },
      data: { content, editedAt: new Date() },
      include: messageInclude
    });

    const dto = messageDTO(updated);
    emitToRoom(updated.roomId, "message:update", dto);
    return { message: dto };
  });

  app.delete("/messages/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.message.findUnique({
      where: { id },
      include: { attachments: true }
    });
    if (!existing) return reply.code(404).send({ error: "That message is gone." });
    if (existing.authorId !== request.userId) {
      return reply.code(403).send({ error: "You can only delete your own messages." });
    }

    /*
     * Delete the stored objects before the rows that point at them. The rows
     * hold the only reference to each key, so dropping them first would strand
     * the files forever — and /files/* is unauthenticated by design, so anyone
     * holding the URL would keep downloading something the user believes is gone.
     */
    for (const attachment of existing.attachments) {
      const key = keyFromUrl(attachment.url);
      if (key) await deleteObject(key);
    }

    // Soft delete: the row stays so replies pointing at it still render.
    await prisma.message.update({
      where: { id },
      data: { deletedAt: new Date(), content: "" }
    });
    await prisma.attachment.deleteMany({ where: { messageId: id } });

    emitToRoom(existing.roomId, "message:delete", { id, roomId: existing.roomId });
    return { ok: true };
  });

  app.post("/messages/:id/reactions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ emoji: z.string().min(1).max(24) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Pick an emoji." });

    const message = await prisma.message.findUnique({ where: { id } });
    if (!message) return reply.code(404).send({ error: "That message is gone." });

    try {
      await requireMembership(message.roomId, request.userId);
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }

    const emoji = body.data.emoji;

    /*
     * Toggle without a read-then-write race. `deleteMany` does not throw when
     * there is nothing to delete, and a create that loses the race to the unique
     * index is treated as "already reacted" rather than a 500.
     */
    const removed = await prisma.reaction.deleteMany({
      where: { messageId: id, userId: request.userId, emoji }
    });

    let added = false;
    if (removed.count === 0) {
      try {
        await prisma.reaction.create({ data: { messageId: id, userId: request.userId, emoji } });
        added = true;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
          throw err;
        }
      }
    }

    const refreshed = await prisma.message.findUnique({ where: { id }, include: messageInclude });
    if (refreshed) emitToRoom(message.roomId, "message:update", messageDTO(refreshed));
    return { ok: true, added };
  });
}
