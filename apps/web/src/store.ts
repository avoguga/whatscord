import { create } from "zustand";
import { api, clearTokens, loadTokens, saveTokens } from "./lib/api";

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

export type Space = {
  id: string;
  name: string;
  iconUrl: string | null;
  inviteCode: string;
  role: string;
  memberCount: number;
  channels: { id: string; name: string | null; kind: RoomKind; topic: string | null }[];
};

type State = {
  me: User | null;
  booting: boolean;
  rooms: Room[];
  spaces: Space[];
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
  openRoom: (roomId: string) => Promise<void>;
  loadOlder: (roomId: string) => Promise<void>;
  send: (roomId: string, content: string, attachments: unknown[]) => Promise<void>;
  react: (messageId: string, emoji: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;

  setFilter: (f: "all" | "unread") => void;
  setSearch: (s: string) => void;
  setReplyTo: (m: Message | null) => void;
  setActiveSpace: (id: string | null) => void;

  ingestMessage: (m: Message) => void;
  patchMessage: (m: Message) => void;
  dropMessage: (id: string, roomId: string) => void;
  setTyping: (roomId: string, userId: string, on: boolean) => void;
  setOnline: (userId: string, on: boolean) => void;
  setVoicePresence: (roomId: string, userIds: string[]) => void;
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
  voicePresence: {} as Record<string, string[]>
};

export const useStore = create<State>((set, get) => ({
  me: null,
  booting: true,
  ...blankSession,

  async bootstrap() {
    if (!loadTokens()) return set({ booting: false, me: null, ...blankSession });
    try {
      const { user } = await api.get<{ user: User }>("/auth/me");
      set({ me: user, ...blankSession });
      await Promise.all([get().refreshRooms(), get().refreshSpaces()]);
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
    await Promise.all([get().refreshRooms(), get().refreshSpaces()]);
  },

  async signUp(input) {
    const res = await api.post<{ user: User; accessToken: string; refreshToken: string }>(
      "/auth/register",
      input
    );
    saveTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    set({ me: res.user, ...blankSession });
    await Promise.all([get().refreshRooms(), get().refreshSpaces()]);
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
    set({ spaces });
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
    set((s) => ({ voicePresence: { ...s.voicePresence, [roomId]: userIds } }));
  }
}));
