import { create } from "zustand";
import { api, clearTokens, loadTokens, saveTokens } from "./lib/api";
import { saveTheme, storedTheme, type Theme } from "./lib/theme";
import { preferenciaSalva, salvarIdioma, type PreferenciaIdioma } from "./lib/i18n";

/**
 * Collapses a message list to one entry per message and keeps it in time order.
 *
 * A message can reach the client twice — once as the optimistic bubble, once as
 * the socket echo — and the two carry different ids until the server replies.
 * `clientMsgId` is the stable identity across both, so it wins over `id` when
 * present. This is the single place that guarantees a send shows up once.
 */
function dedupe(list: Message[]): Message[] {
  const byKey = new Map<string, Message>();
  for (const m of list) {
    const key = m.clientMsgId ?? m.id;
    const existing = byKey.get(key);
    // A confirmed message always replaces a pending one with the same identity.
    if (!existing || existing.pending || existing.failed) byKey.set(key, m);
  }

  const all = [...byKey.values()];
  /*
   * Messages the server has accepted are ordered by its clock, with the id as
   * the tie-break — the same order the API pages by.
   *
   * Anything still in flight is pinned to the end regardless of timestamp: its
   * createdAt comes from this machine's clock, and a clock that is off by an
   * hour would otherwise drop the bubble into the middle of the history, or
   * under yesterday's date separator.
   */
  const settled = all.filter((m) => !m.pending);
  const inFlight = all.filter((m) => m.pending);

  settled.sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return [...settled, ...inFlight];
}

export type User = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio?: string | null;
  presence?: string;
  online?: boolean;
};

export type Attachment = {
  id: string;
  url: string;
  name: string;
  mime: string;
  size: number;
  width?: number | null;
  height?: number | null;
};

export type Message = {
  id: string;
  roomId: string;
  /** Minted by this client before sending. How an echo is matched to its bubble. */
  clientMsgId: string | null;
  content: string;
  author: User;
  attachments: Attachment[];
  reactions: { emoji: string; userIds: string[] }[];
  replyTo: { id: string; content: string; author: Partial<User>; deleted: boolean } | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  /** Set on messages that have not reached the server yet. */
  pending?: boolean;
  failed?: boolean;
};

export type Toast = { id: string; text: string; kind: "ok" | "bad" };

export type RoomKind = "DM" | "GROUP" | "TEXT" | "VOICE";

export type Room = {
  id: string;
  kind: RoomKind;
  name: string | null;
  iconUrl: string | null;
  topic: string | null;
  space: { id: string; name: string; iconUrl: string | null } | null;
  counterpart: User | null;
  members: User[];
  memberCount: number;
  muted: boolean;
  unread: number;
  lastMessage: {
    id: string;
    content: string;
    authorId: string;
    authorName: string;
    attachmentCount: number;
    attachmentMime: string | null;
    createdAt: string;
  } | null;
  activityAt: string;
};

export type SpaceRole = "OWNER" | "ADMIN" | "MEMBER";

export type Space = {
  id: string;
  name: string;
  iconUrl: string | null;
  inviteCode: string;
  role: string;
  memberCount: number;
  channels: { id: string; name: string | null; kind: RoomKind; topic: string | null }[];
  /*
   * Ordem e pasta chegam do servidor, mas são OPCIONAIS de propósito: uma API
   * mais antiga que este app não manda nenhum dos dois, e nesse caso a barra
   * cai na ordem em que a lista veio — que é exatamente o que ela fazia antes
   * de existir arrastar. Tornar obrigatório aqui deixaria o rail vazio contra
   * um servidor desatualizado.
   */
  position?: number;
  folderId?: string | null;
};

/** Uma pasta do rail. Só agrupa; apagá-la nunca apaga os espaços de dentro. */
export type SpaceFolder = {
  id: string;
  name: string;
  color: string | null;
  position: number;
};

/** Quem está numa chamada. O servidor manda a pessoa inteira, não só o id. */
export type VoiceUser = Pick<User, "id" | "username" | "displayName" | "avatarUrl">;

/**
 * Põe os espaços na ordem que a pessoa escolheu.
 *
 * O índice entra como desempate para o caso de `position` faltar ou repetir —
 * duas posições iguais com `sort` instável trocariam de lugar a cada render, e
 * um ícone que pisca de lugar sozinho parece defeito de rede.
 */
export function ordenarEspacos(spaces: Space[]): Space[] {
  return spaces
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.position ?? a.i) - (b.s.position ?? b.i) || a.i - b.i)
    .map((x) => x.s);
}

/**
 * Tudo que uma sessão precisa ter na tela logo depois de entrar.
 *
 * Estava escrito três vezes — entrar, criar conta e reabrir com token guardado
 * — e cada nova coisa a carregar tinha que ser lembrada nos três. A presença de
 * voz vem DEPOIS das salas de propósito: ela é buscada pelos ids das salas de
 * voz, e sem elas a busca sairia vazia.
 */
async function carregarSessao(get: () => State) {
  await Promise.all([get().refreshRooms(), get().refreshSpaces(), get().refreshSpaceFolders()]);
  await get().refreshVoicePresence();
}

type State = {
  me: User | null;
  booting: boolean;
  rooms: Room[];
  spaces: Space[];
  spaceFolders: SpaceFolder[];
  openFolders: Set<string>;
  activeSpaceId: string | null;
  activeRoomId: string | null;
  messages: Record<string, Message[]>;
  cursors: Record<string, string | null>;
  loadingRoom: boolean;
  typing: Record<string, string[]>;
  online: Set<string>;
  filter: "all" | "unread";
  search: string;
  replyTo: Message | null;
  voicePresence: Record<string, string[]>;
  /*
   * A mesma presença da linha acima, mas com a pessoa inteira — é o que a barra
   * lateral precisa para desenhar retrato e nome. Os ids continuam existindo à
   * parte porque a contagem é usada em telas que não carregam pessoa nenhuma.
   */
  voicePeople: Record<string, VoiceUser[]>;
  toasts: Toast[];
  /** Claro, escuro ou igual ao dispositivo. Pintado no `<html>`. */
  theme: Theme;
  /** Inglês, português, espanhol ou igual ao dispositivo. */
  locale: PreferenciaIdioma;

  bootstrap: () => Promise<void>;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    username: string;
    displayName: string;
    password: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;

  refreshRooms: () => Promise<void>;
  refreshSpaces: () => Promise<void>;
  refreshSpaceFolders: () => Promise<void>;
  /** Quem está em cada sala de voz, buscado do servidor. Sobrevive ao F5. */
  refreshVoicePresence: () => Promise<void>;
  reorderSpaces: (items: { spaceId: string; position: number; folderId: string | null }[]) => Promise<void>;
  createSpaceFolder: (name: string, color: string | null, spaceIds: string[]) => Promise<void>;
  updateSpaceFolder: (id: string, patch: { name?: string; color?: string | null; position?: number }) => Promise<void>;
  deleteSpaceFolder: (id: string) => Promise<void>;
  toggleFolder: (id: string) => void;
  joinSpaceByCode: (code: string) => Promise<{ id: string; name: string }>;
  leaveSpace: (spaceId: string) => Promise<{ spaceDeleted: boolean }>;
  openRoom: (roomId: string) => Promise<void>;
  closeRoom: () => void;
  loadOlder: (roomId: string) => Promise<void>;
  send: (roomId: string, content: string, attachments: unknown[]) => Promise<void>;
  react: (messageId: string, emoji: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;

  setFilter: (f: "all" | "unread") => void;
  setSearch: (s: string) => void;
  setReplyTo: (m: Message | null) => void;
  setActiveSpace: (id: string | null) => void;
  notify: (text: string, kind?: "ok" | "bad") => void;
  setTheme: (t: Theme) => void;
  setLocale: (l: PreferenciaIdioma) => Promise<void>;
  dismissToast: (id: string) => void;

  ingestMessage: (m: Message) => void;
  patchMessage: (m: Message) => void;
  dropMessage: (id: string, roomId: string) => void;
  setTyping: (roomId: string, userId: string, on: boolean) => void;
  setOnline: (userId: string, on: boolean) => void;
  setVoicePresence: (roomId: string, userIds: string[]) => void;
  /** Presença completa de uma sala, vinda de `voice:presence` ou do GET. */
  setVoiceRoster: (roomId: string, users: VoiceUser[]) => void;
};

/**
 * Everything that belongs to one signed-in person.
 *
 * The store outlives sign-out — React swaps the tree, it does not unmount the
 * store — so anything left behind here bleeds into the next account. That is
 * what made a fresh sign-in land on a sidebar filtered by the previous user's
 * space: no room matched, and because the filter was set, direct messages were
 * hidden too. Reset through this object, never field by field.
 */
const blankSession = {
  rooms: [] as Room[],
  spaces: [] as Space[],
  spaceFolders: [] as SpaceFolder[],
  openFolders: new Set<string>(),
  activeSpaceId: null as string | null,
  activeRoomId: null as string | null,
  messages: {} as Record<string, Message[]>,
  cursors: {} as Record<string, string | null>,
  loadingRoom: false,
  typing: {} as Record<string, string[]>,
  online: new Set<string>(),
  filter: "all" as const,
  search: "",
  replyTo: null as Message | null,
  voicePresence: {} as Record<string, string[]>,
  voicePeople: {} as Record<string, VoiceUser[]>
};

export const useStore = create<State>((set, get) => ({
  me: null,
  booting: true,
  toasts: [],
  /*
   * Lido do armazenamento, não fixado em "system": o `index.html` já pintou a
   * tela com esse mesmo valor antes do React existir, e divergir aqui faria a
   * tela de configurações marcar a opção errada.
   */
  theme: storedTheme(),
  locale: preferenciaSalva(),
  ...blankSession,

  async bootstrap() {
    if (!loadTokens()) return set({ booting: false, me: null, ...blankSession });
    try {
      const { user } = await api.get<{ user: User }>("/auth/me");
      set({ me: user, ...blankSession });
      await carregarSessao(get);
    } catch {
      clearTokens();
      set({ me: null, ...blankSession });
    } finally {
      set({ booting: false });
    }
  },

  async signIn(identifier, password) {
    const res = await api.post<{ user: User; accessToken: string; refreshToken: string }>(
      "/auth/login",
      { identifier, password }
    );
    saveTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    set({ me: res.user, ...blankSession });
    await carregarSessao(get);
  },

  async signUp(input) {
    const res = await api.post<{ user: User; accessToken: string; refreshToken: string }>(
      "/auth/register",
      input
    );
    saveTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    set({ me: res.user, ...blankSession });
    await carregarSessao(get);
  },

  async signOut() {
    const tokens = loadTokens();
    await api.post("/auth/logout", { refreshToken: tokens?.refreshToken }).catch(() => undefined);
    clearTokens();
    set({ me: null, ...blankSession });
  },

  async refreshRooms() {
    const { rooms } = await api.get<{ rooms: Room[] }>("/rooms");
    set({ rooms });
  },

  async refreshSpaces() {
    const { spaces } = await api.get<{ spaces: Space[] }>("/spaces");
    set({ spaces: ordenarEspacos(spaces) });
  },

  /*
   * As pastas são um recurso novo da API. Um servidor que ainda não as tem
   * responde 404, e isso NÃO pode derrubar a abertura do app — o rail sem
   * pastas continua sendo um rail que funciona. Por isso o erro morre aqui.
   */
  async refreshSpaceFolders() {
    try {
      const { folders } = await api.get<{ folders: SpaceFolder[] }>("/space-folders");
      set({ spaceFolders: [...folders].sort((a, b) => a.position - b.position) });
    } catch {
      set({ spaceFolders: [] });
    }
  },

  /**
   * Quem está em cada sala de voz, perguntado ao servidor.
   *
   * Este é o conserto do defeito central: a presença vivia só na memória, a
   * partir dos eventos `call:joined`/`call:left` que chegam DEPOIS de o socket
   * conectar. Quem recarregava a página via a sala de voz vazia mesmo com três
   * pessoas conversando lá dentro, até alguém entrar ou sair.
   */
  async refreshVoicePresence() {
    const ids = get()
      .rooms.filter((r) => r.kind === "VOICE")
      .map((r) => r.id);
    if (ids.length === 0) return;

    try {
      const res = await api.get<{ presence: Record<string, VoiceUser[]> }>(
        `/calls/presence?roomIds=${ids.map(encodeURIComponent).join(",")}`
      );
      const people: Record<string, VoiceUser[]> = {};
      const idsPorSala: Record<string, string[]> = {};
      for (const roomId of ids) {
        const users = res.presence[roomId] ?? [];
        people[roomId] = users;
        idsPorSala[roomId] = users.map((u) => u.id);
      }
      set((s) => ({
        voicePeople: { ...s.voicePeople, ...people },
        voicePresence: { ...s.voicePresence, ...idsPorSala }
      }));
    } catch {
      /* Servidor sem a rota ainda, ou rede fora: fica com o que já havia. */
    }
  },

  /**
   * Salva a ordem do rail, mudando a tela ANTES de perguntar ao servidor.
   *
   * Arrastar e esperar o ícone pular de volta meio segundo depois é a diferença
   * entre um rail que responde e um que parece travado. Se o servidor recusar,
   * a lista inteira volta ao estado anterior de uma vez — não item por item,
   * porque um desfazer parcial deixaria a ordem numa mistura que ninguém pediu.
   */
  async reorderSpaces(items) {
    const antes = get().spaces;
    const porId = new Map(items.map((i) => [i.spaceId, i]));

    set((s) => ({
      spaces: ordenarEspacos(
        s.spaces.map((sp) => {
          const alvo = porId.get(sp.id);
          return alvo ? { ...sp, position: alvo.position, folderId: alvo.folderId } : sp;
        })
      )
    }));

    try {
      await api.patch("/spaces/order", { items });
    } catch (err) {
      set({ spaces: antes });
      throw err;
    }
  },

  /**
   * Cria uma pasta e põe espaços dentro dela.
   *
   * São duas chamadas — criar a pasta, depois mover os espaços — porque só o
   * servidor sabe o id da pasta. A tela é atualizada com uma pasta provisória
   * enquanto isso, e a falha desfaz as duas metades juntas.
   */
  async createSpaceFolder(name, color, spaceIds) {
    const espacosAntes = get().spaces;
    const pastasAntes = get().spaceFolders;

    const provisoria: SpaceFolder = {
      id: `pending-${crypto.randomUUID()}`,
      name,
      color,
      position: pastasAntes.length
    };
    set((s) => ({
      spaceFolders: [...s.spaceFolders, provisoria],
      spaces: s.spaces.map((sp) =>
        spaceIds.includes(sp.id) ? { ...sp, folderId: provisoria.id } : sp
      ),
      openFolders: new Set([...s.openFolders, provisoria.id])
    }));

    try {
      const { folder } = await api.post<{ folder: SpaceFolder }>("/space-folders", {
        name,
        color: color ?? undefined
      });
      set((s) => ({
        spaceFolders: s.spaceFolders.map((f) => (f.id === provisoria.id ? folder : f)),
        spaces: s.spaces.map((sp) =>
          sp.folderId === provisoria.id ? { ...sp, folderId: folder.id } : sp
        ),
        openFolders: new Set(
          [...s.openFolders].map((id) => (id === provisoria.id ? folder.id : id))
        )
      }));

      const dentro = get().spaces.filter((sp) => sp.folderId === folder.id);
      await api.patch("/spaces/order", {
        items: dentro.map((sp, i) => ({ spaceId: sp.id, position: i, folderId: folder.id }))
      });
    } catch (err) {
      set({ spaces: espacosAntes, spaceFolders: pastasAntes });
      throw err;
    }
  },

  async updateSpaceFolder(id, patch) {
    const antes = get().spaceFolders;
    set((s) => ({
      spaceFolders: s.spaceFolders
        .map((f) => (f.id === id ? { ...f, ...patch } : f))
        .sort((a, b) => a.position - b.position)
    }));
    try {
      await api.patch(`/space-folders/${encodeURIComponent(id)}`, patch);
    } catch (err) {
      set({ spaceFolders: antes });
      throw err;
    }
  },

  /*
   * Apagar a pasta solta os espaços; não apaga nenhum deles. É o que o servidor
   * faz, e a tela tem que mostrar a mesma coisa no mesmo instante — ver os
   * ícones sumirem junto com a pasta, mesmo que voltassem no próximo carregar,
   * é um susto que não se desfaz.
   */
  async deleteSpaceFolder(id) {
    const espacosAntes = get().spaces;
    const pastasAntes = get().spaceFolders;
    set((s) => ({
      spaceFolders: s.spaceFolders.filter((f) => f.id !== id),
      spaces: s.spaces.map((sp) => (sp.folderId === id ? { ...sp, folderId: null } : sp))
    }));
    try {
      await api.del(`/space-folders/${encodeURIComponent(id)}`);
    } catch (err) {
      set({ spaces: espacosAntes, spaceFolders: pastasAntes });
      throw err;
    }
  },

  toggleFolder(id) {
    set((s) => {
      const next = new Set(s.openFolders);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { openFolders: next };
    });
  },

  /**
   * Entra num espaço por código de convite.
   *
   * Um caminho só, usado tanto por quem digita o código quanto por quem abre um
   * link — assim as duas entradas não podem divergir no que atualizam depois.
   * O código é escapado por vir de fora: de um link, ele chega do sistema
   * operacional e pode ser qualquer coisa.
   */
  /**
   * Sai de um espaço e limpa o que ficaria pendurado.
   *
   * Sair sem soltar `activeSpaceId` deixava a barra lateral filtrando por um
   * espaço que não existe mais para esta conta — foi exatamente o sintoma de
   * "entrei e a conversa sumiu" que já apareceu aqui antes, por outro caminho.
   */
  async leaveSpace(spaceId) {
    const res = await api.del<{ ok: true; spaceDeleted: boolean }>(
      `/spaces/${encodeURIComponent(spaceId)}/members/me`
    );

    const saiuDoAtivo = get().activeSpaceId === spaceId;
    const salasDoEspaco = new Set(
      get().rooms.filter((r) => r.space?.id === spaceId).map((r) => r.id)
    );

    set((s) => ({
      activeSpaceId: saiuDoAtivo ? null : s.activeSpaceId,
      activeRoomId: s.activeRoomId && salasDoEspaco.has(s.activeRoomId) ? null : s.activeRoomId
    }));

    await Promise.all([get().refreshSpaces(), get().refreshRooms()]);
    return { spaceDeleted: res.spaceDeleted };
  },

  async joinSpaceByCode(code) {
    const res = await api.post<{ space: { id: string; name: string } }>(
      `/spaces/join/${encodeURIComponent(code)}`
    );
    await Promise.all([get().refreshSpaces(), get().refreshRooms()]);
    set({ activeSpaceId: res.space.id });
    return res.space;
  },

  async openRoom(roomId) {
    set({ activeRoomId: roomId, loadingRoom: true, replyTo: null });

    // Clear the badge straight away; the server call is a formality.
    set((s) => ({
      rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, unread: 0 } : r))
    }));

    try {
      if (!get().messages[roomId]) {
        const res = await api.get<{ messages: Message[]; nextCursor: string | null }>(
          `/rooms/${roomId}/messages?limit=40`
        );
        // Merge, never overwrite: a message can arrive over the socket while
        // this GET is in flight, and assigning would throw it away until reload.
        set((s) => ({
          messages: {
            ...s.messages,
            [roomId]: dedupe([...res.messages, ...(s.messages[roomId] ?? [])])
          },
          cursors: { ...s.cursors, [roomId]: res.nextCursor }
        }));
      }
      await api.post(`/rooms/${roomId}/read`, {});
    } finally {
      set({ loadingRoom: false });
    }
  },

  /** Used by the narrow layout's back button to return to the list. */
  closeRoom() {
    set({ activeRoomId: null, replyTo: null });
  },

  async loadOlder(roomId) {
    const cursor = get().cursors[roomId];
    if (!cursor) return;
    const res = await api.get<{ messages: Message[]; nextCursor: string | null }>(
      `/rooms/${roomId}/messages?limit=40&before=${encodeURIComponent(cursor)}`
    );
    set((s) => ({
      messages: {
        ...s.messages,
        [roomId]: dedupe([...res.messages, ...(s.messages[roomId] ?? [])])
      },
      cursors: { ...s.cursors, [roomId]: res.nextCursor }
    }));
  },

  /**
   * Optimistic send: the bubble appears immediately with a pending tick and is
   * swapped for the server's copy when it lands. A failure marks the bubble
   * rather than dropping what someone typed.
   */
  async send(roomId, content, attachments) {
    const me = get().me;
    if (!me) return;

    const clientMsgId = crypto.randomUUID();
    const tempId = `pending-${clientMsgId}`;
    const reply = get().replyTo;
    const optimistic: Message = {
      id: tempId,
      roomId,
      clientMsgId,
      content,
      author: me,
      attachments: [],
      reactions: [],
      replyTo: reply
        ? { id: reply.id, content: reply.content, author: reply.author, deleted: false }
        : null,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deleted: false,
      pending: true
    };

    set((s) => ({
      messages: { ...s.messages, [roomId]: [...(s.messages[roomId] ?? []), optimistic] },
      replyTo: null
    }));

    try {
      const res = await api.post<{ message: Message }>(`/rooms/${roomId}/messages`, {
        content,
        replyToId: reply?.id,
        clientMsgId,
        attachments
      });
      // The socket echo may have arrived first. Drop the placeholder and any
      // copy already ingested, then insert the server's version once.
      set((s) => ({
        messages: {
          ...s.messages,
          [roomId]: dedupe([
            ...(s.messages[roomId] ?? []).filter(
              (m) => m.id !== tempId && m.clientMsgId !== clientMsgId
            ),
            res.message
          ])
        }
      }));
      get().refreshRooms().catch(() => undefined);
    } catch {
      set((s) => ({
        messages: {
          ...s.messages,
          [roomId]: (s.messages[roomId] ?? []).map((m) =>
            m.id === tempId ? { ...m, pending: false, failed: true } : m
          )
        }
      }));
    }
  },

  async react(messageId, emoji) {
    await api.post(`/messages/${messageId}/reactions`, { emoji }).catch(() => undefined);
  },

  async deleteMessage(messageId) {
    await api.del(`/messages/${messageId}`).catch(() => undefined);
  },

  setFilter: (filter) => set({ filter }),
  setSearch: (search) => set({ search }),
  setReplyTo: (replyTo) => set({ replyTo }),
  setActiveSpace: (activeSpaceId) => set({ activeSpaceId }),

  setTheme(t) {
    saveTheme(t);
    set({ theme: t });
  },

  /*
   * Assíncrono, ao contrário do tema: trocar de idioma baixa um catálogo. O
   * estado só muda DEPOIS que o catálogo está ativo — mudar antes deixaria a
   * opção marcada com a tela ainda no idioma anterior.
   */
  async setLocale(l) {
    await salvarIdioma(l);
    set({ locale: l });
  },

  notify(text, kind = "ok") {
    const id = crypto.randomUUID();
    // Cap the stack: a burst of failures should not paper over the screen.
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, kind }] }));
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  ingestMessage(m) {
    set((s) => {
      const existing = s.messages[m.roomId];
      // Keep it even for a room whose history has not been fetched yet — the
      // fetch merges rather than overwrites, so nothing is lost either way.
      const list = dedupe([...(existing ?? []), m]);

      const rooms = s.rooms.map((r) =>
        r.id === m.roomId
          ? {
              ...r,
              unread: s.activeRoomId === m.roomId || m.author.id === s.me?.id ? r.unread : r.unread + 1,
              activityAt: m.createdAt,
              lastMessage: {
                id: m.id,
                content: m.content,
                authorId: m.author.id,
                authorName: m.author.displayName,
                attachmentCount: m.attachments.length,
                attachmentMime: m.attachments[0]?.mime ?? null,
                createdAt: m.createdAt
              }
            }
          : r
      );
      rooms.sort((a, b) => new Date(b.activityAt).getTime() - new Date(a.activityAt).getTime());

      return {
        rooms,
        messages: { ...s.messages, [m.roomId]: list }
      };
    });

    if (get().activeRoomId === m.roomId) {
      api.post(`/rooms/${m.roomId}/read`, {}).catch(() => undefined);
    }
  },

  patchMessage(m) {
    set((s) => ({
      messages: {
        ...s.messages,
        [m.roomId]: (s.messages[m.roomId] ?? []).map((x) => (x.id === m.id ? m : x))
      }
    }));
  },

  dropMessage(id, roomId) {
    set((s) => ({
      messages: {
        ...s.messages,
        [roomId]: (s.messages[roomId] ?? []).map((x) =>
          x.id === id ? { ...x, deleted: true, content: "", attachments: [] } : x
        )
      }
    }));
  },

  setTyping(roomId, userId, on) {
    set((s) => {
      const current = s.typing[roomId] ?? [];
      const next = on
        ? current.includes(userId)
          ? current
          : [...current, userId]
        : current.filter((u) => u !== userId);
      return { typing: { ...s.typing, [roomId]: next } };
    });
  },

  setOnline(userId, on) {
    set((s) => {
      const next = new Set(s.online);
      if (on) next.add(userId);
      else next.delete(userId);
      return { online: next };
    });
  },

  setVoicePresence(roomId, userIds) {
    set((s) => ({
      voicePresence: { ...s.voicePresence, [roomId]: userIds },
      /*
       * A lista de pessoas segue a de ids: `call:joined` só traz um id, e
       * deixar as duas divergirem faria a barra lateral dizer "2 conectados"
       * e desenhar um retrato só. Quem entrou e ainda não é conhecido aqui
       * aparece no próximo `voice:presence`, que traz a pessoa inteira.
       */
      voicePeople: {
        ...s.voicePeople,
        [roomId]: (s.voicePeople[roomId] ?? []).filter((u) => userIds.includes(u.id))
      }
    }));
  },

  setVoiceRoster(roomId, users) {
    set((s) => ({
      voicePeople: { ...s.voicePeople, [roomId]: users },
      voicePresence: { ...s.voicePresence, [roomId]: users.map((u) => u.id) }
    }));
  }
}));
