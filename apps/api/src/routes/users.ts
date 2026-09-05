import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { userSelect } from "../lib/shapes.js";
import { authGuard } from "../plugins/auth.js";
import { onlineUserIds } from "../lib/redis.js";

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  /** Finding people to message. Matches username or display name. */
  app.get("/users/search", async (request) => {
    const query = z
      .object({ q: z.string().min(1).max(60), limit: z.coerce.number().int().min(1).max(30).default(15) })
      .safeParse(request.query);
    if (!query.success) return { users: [] };

    const term = query.data.q.trim();
    const users = await prisma.user.findMany({
      where: {
        id: { not: request.userId },
        OR: [
          { username: { contains: term, mode: "insensitive" } },
          { displayName: { contains: term, mode: "insensitive" } }
        ]
      },
      select: userSelect,
      take: query.data.limit
    });

    const online = await onlineUserIds(users.map((u) => u.id));
    return { users: users.map((u) => ({ ...u, online: online.has(u.id) })) };
  });

  app.get("/users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!user) return reply.code(404).send({ error: "That account does not exist." });
    const online = await onlineUserIds([id]);
    return { user: { ...user, online: online.has(id) } };
  });

  app.patch("/users/me", async (request, reply) => {
    const body = z
      .object({
        displayName: z.string().min(1).max(48).optional(),
        bio: z.string().max(300).optional(),
        avatarUrl: z.string().max(500).optional()
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0].message });

    const user = await prisma.user.update({
      where: { id: request.userId },
      data: body.data,
      select: userSelect
    });
    return { user };
  });

  /** Batch presence lookup, used to light up the sidebar. */
  app.post("/users/presence", async (request) => {
    const body = z.object({ userIds: z.array(z.string()).max(400) }).safeParse(request.body);
    if (!body.success) return { online: [] };
    const online = await onlineUserIds(body.data.userIds);
    return { online: [...online] };
  });
}
