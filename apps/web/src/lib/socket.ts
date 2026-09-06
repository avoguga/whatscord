import { io, type Socket } from "socket.io-client";
import { apiBase, loadTokens } from "./api";
import { useStore, type Message } from "../store";

let socket: Socket | null = null;

export function getSocket() {
  return socket;
}

export function connectSocket() {
  const tokens = loadTokens();
  if (!tokens?.accessToken || socket?.connected) return socket;

  socket?.disconnect();
  socket = io(apiBase, {
    auth: { token: tokens.accessToken },
    transports: ["websocket", "polling"],
    reconnectionDelay: 800,
    reconnectionDelayMax: 6000
  });

  const store = useStore.getState;

  socket.on("message:new", (m: Message) => store().ingestMessage(m));
  socket.on("message:update", (m: Message) => store().patchMessage(m));
  socket.on("message:delete", (p: { id: string; roomId: string }) =>
    store().dropMessage(p.id, p.roomId)
  );

  socket.on("typing:start", (p: { roomId: string; userId: string }) =>
    store().setTyping(p.roomId, p.userId, true)
  );
  socket.on("typing:stop", (p: { roomId: string; userId: string }) =>
    store().setTyping(p.roomId, p.userId, false)
  );

  socket.on("presence:online", (p: { userId: string }) => store().setOnline(p.userId, true));
  socket.on("presence:offline", (p: { userId: string }) => store().setOnline(p.userId, false));

  socket.on("room:new", () => store().refreshRooms().catch(() => undefined));
  socket.on("room:members", () => store().refreshRooms().catch(() => undefined));
  socket.on("room:left", () => store().refreshRooms().catch(() => undefined));
  socket.on("space:joined", () => {
    store().refreshSpaces().catch(() => undefined);
    store().refreshRooms().catch(() => undefined);
  });
  // Someone accepted an invite to a space this client is already in. Without
  // this, the person who sent the invite never sees them arrive.
  socket.on("space:members", () => {
    store().refreshSpaces().catch(() => undefined);
    store().refreshRooms().catch(() => undefined);
  });
  // Saiu de um espaco (possivelmente noutra aba ou noutro aparelho): as salas
  // dele tem que sumir daqui tambem, senao ficam clicaveis e dao 403.
  socket.on("space:left", () => {
    store().refreshSpaces().catch(() => undefined);
    store().refreshRooms().catch(() => undefined);
  });

  socket.on("call:joined", (p: { roomId: string; userId: string }) => {
    const current = useStore.getState().voicePresence[p.roomId] ?? [];
    if (!current.includes(p.userId)) {
      store().setVoicePresence(p.roomId, [...current, p.userId]);
    }
  });
  socket.on("call:left", (p: { roomId: string; userId: string }) => {
    const current = useStore.getState().voicePresence[p.roomId] ?? [];
    store().setVoicePresence(
      p.roomId,
      current.filter((u) => u !== p.userId)
    );
  });

  socket.on("connect_error", (err) => console.warn("realtime:", err.message));

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Typing is throttled: one start, then a stop after two idle seconds. */
let typingTimer: ReturnType<typeof setTimeout> | null = null;
let typingRoom: string | null = null;

export function signalTyping(roomId: string) {
  if (!socket) return;
  if (typingRoom !== roomId) {
    socket.emit("typing:start", { roomId });
    typingRoom = roomId;
  }
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket?.emit("typing:stop", { roomId });
    typingRoom = null;
  }, 2000);
}

export function stopTyping(roomId: string) {
  if (typingTimer) clearTimeout(typingTimer);
  socket?.emit("typing:stop", { roomId });
  typingRoom = null;
}
