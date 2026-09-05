import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { messageDTO, messageInclude } from "../lib/shapes.js";
import { authGuard } from "../plugins/auth.js";
import { HttpError, requireMembership } from "../lib/rooms.js";
import { emitToRoom } from "../realtime/bus.js";

const attachmentInput = z.object({
  key: z.string().min(1),
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(160),
  size: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional()
});

export async function messageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  /** History, newest first, paged backwards with a cursor. */
  app.get("/rooms/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = z
      .object({
        before: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(40)
      })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Bad pagination values." });

    try {
      await requireMembership(id, request.userId);
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }

    const { before, limit } = query.data;
    const messages = await prisma.message.findMany({
      where: { roomId: id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: messageInclude
    });

    return {
      messages: messages.reverse().map(messageDTO),
      // Null means the caller has reached the beginning of the conversation.
      nextCursor: messages.length === limit ? messages[0]?.createdAt.toISOString() : null
    };
  });

  app.post("/rooms/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        content: z.string().max(8000).default(""),
        replyToId: z.string().optional(),
        attachments: z.array(attachmentInput).max(10).default([])
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0].message });

    const { content, replyToId, attachments } = body.data;
    if (!content.trim() && attachments.length === 0) {
      return reply.code(400).send({ error: "Write something or attach a file." });
    }

    try {
      await requireMembership(id, request.userId);
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }

    const created = await prisma.message.create({
      data: {
        roomId: id,
        authorId: request.userId,
        content: content.trim(),
        replyToId: replyToId ?? null,
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

    const dto = messageDTO(created);
    emitToRoom(id, "message:new", dto);
    return reply.code(201).send({ message: dto });
  });

  app.patch("/messages/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ content: z.string().min(1).max(8000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "The message cannot be empty." });

    const existing = await prisma.message.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return reply.code(404).send({ error: "That message is gone." });
    }
    if (existing.authorId !== request.userId) {
      return reply.code(403).send({ error: "You can only edit your own messages." });
    }

    const updated = await prisma.message.update({
      where: { id },
      data: { content: body.data.content.trim(), editedAt: new Date() },
      include: messageInclude
    });

    const dto = messageDTO(updated);
    emitToRoom(updated.roomId, "message:update", dto);
    return { message: dto };
  });

  app.delete("/messages/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.message.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "That message is gone." });
    if (existing.authorId !== request.userId) {
      return reply.code(403).send({ error: "You can only delete your own messages." });
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

    const where = {
      messageId_userId_emoji: { messageId: id, userId: request.userId, emoji: body.data.emoji }
    };
    const existing = await prisma.reaction.findUnique({ where });
    if (existing) {
      await prisma.reaction.delete({ where });
    } else {
      await prisma.reaction.create({
        data: { messageId: id, userId: request.userId, emoji: body.data.emoji }
      });
    }

    const refreshed = await prisma.message.findUnique({ where: { id }, include: messageInclude });
    if (refreshed) emitToRoom(message.roomId, "message:update", messageDTO(refreshed));
    return { ok: true, added: !existing };
  });
}
