import type { Server } from "socket.io";

/**
 * A tiny indirection so HTTP routes can push realtime events without importing
 * the socket server (and creating a cycle with the socket auth code).
 */
let io: Server | null = null;

export function setIO(server: Server) {
  io = server;
}

export const roomChannel = (roomId: string) => `room:${roomId}`;
export const userChannel = (userId: string) => `user:${userId}`;

export function emitToRoom(roomId: string, event: string, payload: unknown) {
  io?.to(roomChannel(roomId)).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(userChannel(userId)).emit(event, payload);
}

export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  if (!io || userIds.length === 0) return;
  io.to(userIds.map(userChannel)).emit(event, payload);
}

/** Pulls every connected socket of a user into a newly joined room. */
export async function joinUserSockets(userId: string, roomId: string) {
  if (!io) return;
  const sockets = await io.in(userChannel(userId)).fetchSockets();
  for (const socket of sockets) socket.join(roomChannel(roomId));
}

/**
 * Removes every connected socket of a user from a room.
 *
 * Deleting the membership row is not enough on its own: an open tab stays in
 * the room channel and keeps receiving messages until the page is reloaded.
 */
export async function leaveUserSockets(userId: string, roomId: string) {
  if (!io) return;
  const sockets = await io.in(userChannel(userId)).fetchSockets();
  for (const socket of sockets) socket.leave(roomChannel(roomId));
}
