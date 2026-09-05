import type { Prisma } from "@prisma/client";

/**
 * Response shapes. Everything the client renders comes from here, so a field
 * never leaks by accident and the web app can rely on one contract.
 */

export const userSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  presence: true,
  lastSeenAt: true
} satisfies Prisma.UserSelect;

export const messageInclude = {
  author: { select: userSelect },
  attachments: true,
  reactions: { select: { emoji: true, userId: true } },
  replyTo: {
    select: {
      id: true,
      content: true,
      deletedAt: true,
      author: { select: { id: true, displayName: true, username: true } }
    }
  }
} satisfies Prisma.MessageInclude;

export type MessageWithRelations = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export function messageDTO(message: MessageWithRelations) {
  const grouped = new Map<string, string[]>();
  for (const reaction of message.reactions) {
    const list = grouped.get(reaction.emoji) ?? [];
    list.push(reaction.userId);
    grouped.set(reaction.emoji, list);
  }

  return {
    id: message.id,
    roomId: message.roomId,
    // The client matches this against its own optimistic bubble.
    clientMsgId: message.clientMsgId,
    content: message.deletedAt ? "" : message.content,
    author: message.author,
    attachments: message.deletedAt ? [] : message.attachments,
    reactions: [...grouped.entries()].map(([emoji, userIds]) => ({ emoji, userIds })),
    replyTo: message.replyTo
      ? {
          id: message.replyTo.id,
          content: message.replyTo.deletedAt ? "" : message.replyTo.content,
          author: message.replyTo.author,
          deleted: Boolean(message.replyTo.deletedAt)
        }
      : null,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    deleted: Boolean(message.deletedAt)
  };
}

export type MessageDTO = ReturnType<typeof messageDTO>;
