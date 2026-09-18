import { io, type Socket } from "socket.io-client";
import { apiBase, loadTokens } from "./api";
import { useStore, type Message, type VoiceUser } from "../store";

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
  /*
   * Pode ser o canal que está aberto agora: um administrador apagou daqui a
   * pouco, do outro lado. Sem soltar a sala, o telefone fica preso num painel
   * vazio — o layout esconde a barra lateral enquanto há sala aberta.
   */
  socket.on("room:left", (p: { roomId?: string }) => {
    if (p?.roomId && store().activeRoomId === p.roomId) store().closeRoom();
    store().refreshRooms().catch(() => undefined);
  });
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
  socket.on("space:left", (p: { spaceId?: string }) => {
    /*
     * Três caminhos chegam aqui: eu saí noutra aba, me tiraram, ou o dono
     * apagou o espaço. Nos três o espaço deixou de existir para esta conta, e
     * segurá-lo como o espaço aberto deixaria a barra lateral filtrando pelo
     * que não está mais na lista.
     */
    if (p?.spaceId) store().esquecerEspaco(p.spaceId);
    store().refreshSpaces().catch(() => undefined);
    store().refreshRooms().catch(() => undefined);
  });

  /*
   * A lista completa de quem está numa sala de voz, com nome e retrato. É a
   * fonte boa: `call:joined` abaixo só traz um id, e um id não desenha nada na
   * barra lateral.
   */
  socket.on("voice:presence", (p: { roomId: string; users: VoiceUser[] }) => {
    store().setVoiceRoster(p.roomId, p.users ?? []);
  });

  socket.on("call:joined", (p: { roomId: string; userId: string }) => {
    const estado = useStore.getState();
    const current = estado.voicePresence[p.roomId] ?? [];
    if (current.includes(p.userId)) return;

    /*
     * O evento traz um id sem pessoa. Procurar nos membros da sala resolve o
     * caso comum sem uma ida à rede; quando não resolve — alguém que entrou no
     * espaço agora e ainda não está na lista local — vale a pena buscar, senão
     * a barra lateral contaria uma pessoa a mais do que consegue desenhar.
     */
    const membro = estado.rooms
      .find((r) => r.id === p.roomId)
      ?.members.find((m) => m.id === p.userId);

    if (membro) {
      const atual = estado.voicePeople[p.roomId] ?? [];
      store().setVoiceRoster(p.roomId, [...atual, membro]);
    } else {
      store().setVoicePresence(p.roomId, [...current, p.userId]);
      store().refreshVoicePresence().catch(() => undefined);
    }
  });
  socket.on("call:left", (p: { roomId: string; userId: string }) => {
    const current = useStore.getState().voicePresence[p.roomId] ?? [];
    store().setVoicePresence(
      p.roomId,
      current.filter((u) => u !== p.userId)
    );
  });

  /*
   * Reconectou: enquanto o socket esteve fora, gente entrou e saiu das chamadas
   * sem que nenhum evento chegasse aqui. Sem esta busca, a barra lateral fica
   * mostrando a foto de quem já desligou até a próxima entrada de alguém.
   */
  socket.on("connect", () => {
    store().refreshVoicePresence().catch(() => undefined);
  });

  /* ------------------------------------------------------ transmissões */

  // Só o número. A lista de quem assiste não é publicada a ninguém.
  socket.on("stream:viewers", (p: { streamId?: string; assistindo?: number }) => {
    if (p?.streamId && typeof p.assistindo === "number") {
      store().setEspectadores(p.streamId, p.assistindo);
    }
  });

  /*
   * A transmissão acabou, ou deixou de ser minha (o dono apagou, ou apertou a
   * visibilidade e eu não entro mais). Nos dois casos a tela tem de sair do ar
   * aqui — o servidor já derrubou a sala no LiveKit, e insistir numa tela de
   * vídeo que não vai voltar é pior do que fechá-la.
   */
  const acabou = (p: { streamId?: string }) => {
    const aberta = useStore.getState().aoVivo;
    if (p?.streamId && aberta?.stream.id === p.streamId) store().fecharTransmissao();
    store().refreshTransmissoes().catch(() => undefined);
  };
  socket.on("stream:ended", acabou);
  socket.on("stream:closed", acabou);

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
