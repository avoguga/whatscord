import { useMemo, useState } from "react";
import { useStore, type Room } from "../store";
import { fileUrl } from "../lib/api";
import { initials, listStamp } from "../lib/format";
import {
  IconChats, IconSearch, IconNewChat, IconMute, IconChecks,
  IconVoiceRoom, IconSettings, IconUserPlus, IconGroup, IconSpaces, IconHash
} from "./icons";
import { NewChatModal, NewSpaceModal } from "./Modals";
import { SpaceModal, NewGroupModal, AddPeopleModal } from "./Invites";
import { SettingsModal } from "./Settings";

export function Sidebar() {
  const me = useStore((s) => s.me);
  const rooms = useStore((s) => s.rooms);
  const spaces = useStore((s) => s.spaces);
  const activeRoomId = useStore((s) => s.activeRoomId);
  const activeSpaceId = useStore((s) => s.activeSpaceId);
  const filter = useStore((s) => s.filter);
  const search = useStore((s) => s.search);
  const online = useStore((s) => s.online);
  const voicePresence = useStore((s) => s.voicePresence);

  const openRoom = useStore((s) => s.openRoom);
  const setFilter = useStore((s) => s.setFilter);
  const setSearch = useStore((s) => s.setSearch);
  const setActiveSpace = useStore((s) => s.setActiveSpace);

  const [modal, setModal] = useState<
    "chat" | "space" | "group" | "spaceInfo" | "addPeople" | "settings" | null
  >(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const activeRoom = rooms.find((r) => r.id === activeRoomId);
  const activeSpace = spaces.find((s) => s.id === activeSpaceId);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rooms
      .filter((r) => (activeSpaceId ? r.space?.id === activeSpaceId : !r.space))
      .filter((r) => (filter === "unread" ? r.unread > 0 : true))
      .filter((r) => {
        if (!term) return true;
        const name = (r.name ?? r.counterpart?.displayName ?? "").toLowerCase();
        return name.includes(term) || (r.lastMessage?.content ?? "").toLowerCase().includes(term);
      });
  }, [rooms, filter, search, activeSpaceId]);

  // Inside a space, a flat list of text and voice channels reads as one pile.
  const textChannels = visible.filter((r) => r.kind === "TEXT");
  const voiceChannels = visible.filter((r) => r.kind === "VOICE");
  const unreadTotal = rooms.reduce((n, r) => n + r.unread, 0);

  const row = (room: Room) => (
    <RoomRow
      key={room.id}
      room={room}
      selected={room.id === activeRoomId}
      onOpen={() => openRoom(room.id)}
      online={room.counterpart ? online.has(room.counterpart.id) : false}
      inVoice={voicePresence[room.id]?.length ?? 0}
      meId={me?.id ?? ""}
    />
  );

  return (
    <>
      {/*
        The rail holds places, not actions. Two buttons here used to do nothing
        at all — half of the first thing a new person sees was inert, which
        reads as the app being broken rather than as a feature not being ready.
      */}
      <nav className="rail" aria-label="Places">
        <button
          className="rail-btn"
          data-tip="Chats"
          aria-pressed={activeSpaceId === null}
          onClick={() => setActiveSpace(null)}
        >
          <IconChats />
          {unreadTotal > 0 && activeSpaceId !== null && (
            <span className="rail-badge">{unreadTotal > 99 ? "99+" : unreadTotal}</span>
          )}
        </button>

        {spaces.length > 0 && <div className="rail-sep" />}

        {spaces.map((space) => (
          <button
            key={space.id}
            className="space-chip"
            data-tip={space.name}
            aria-pressed={activeSpaceId === space.id}
            onClick={() => setActiveSpace(space.id)}
          >
            {space.iconUrl ? (
              <img className="rail-avatar" src={fileUrl(space.iconUrl)} alt="" />
            ) : (
              initials(space.name)
            )}
          </button>
        ))}

        {/* A plus, not the people glyph: this adds a space, it does not list
            people, and the two icons sat next to each other. */}
        <button className="rail-btn add" data-tip="Create or join a space" onClick={() => setModal("space")}>
          <IconNewChat size={22} />
        </button>

        <div className="rail-spacer" />

        <button className="rail-btn" data-tip="Settings and account" onClick={() => setModal("settings")}>
          <IconSettings />
        </button>
        <button className="rail-btn" data-tip={me?.displayName ?? "You"} onClick={() => setModal("settings")}>
          {me?.avatarUrl ? (
            <img className="rail-avatar" src={fileUrl(me.avatarUrl)} alt="" />
          ) : (
            <span className="rail-me">{initials(me?.displayName ?? "?")}</span>
          )}
        </button>
      </nav>

      <section className="list-panel" aria-label="Conversations">
        <header className="list-header">
          <h1>{activeSpaceId ? (activeSpace?.name ?? "Space") : "Chats"}</h1>
          <div className="header-actions" style={{ position: "relative" }}>
            {activeSpaceId ? (
              <button
                className="icon-btn accent"
                onClick={() => setModal("spaceInfo")}
                title="Invite people and add channels"
              >
                <IconUserPlus />
              </button>
            ) : (
              <button
                className="icon-btn accent"
                onClick={() => setNewMenuOpen((v) => !v)}
                title="Start something new"
              >
                <IconNewChat />
              </button>
            )}

            {newMenuOpen && !activeSpaceId && (
              <div className="pop-menu">
                <button onClick={() => { setNewMenuOpen(false); setModal("chat"); }}>
                  <IconNewChat size={18} /> New chat
                </button>
                <button onClick={() => { setNewMenuOpen(false); setModal("group"); }}>
                  <IconGroup size={18} /> New group
                </button>
                <button onClick={() => { setNewMenuOpen(false); setModal("space"); }}>
                  <IconSpaces size={18} /> New space
                </button>
              </div>
            )}
          </div>
        </header>

        {activeSpaceId && (
          <button className="invite-strip" onClick={() => setModal("spaceInfo")}>
            <IconUserPlus size={19} />
            <span>
              <b>Invite people to this space</b>
              <em>Code {activeSpace?.inviteCode ?? "…"}</em>
            </span>
          </button>
        )}

        {activeRoom?.kind === "GROUP" && !activeSpaceId && (
          <button className="invite-strip" onClick={() => setModal("addPeople")}>
            <IconUserPlus size={18} />
            <span>
              <b>Add people to {activeRoom.name}</b>
            </span>
          </button>
        )}

        <div className="search-wrap">
          <div className="search">
            <IconSearch />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
            />
          </div>
        </div>

        <div className="filters">
          <button className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
          <button className="chip" aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>
            Unread{unreadTotal ? ` ${unreadTotal}` : ""}
          </button>
        </div>

        <div className="list-scroll">
          {visible.length === 0 && (
            <EmptyList
              inSpace={Boolean(activeSpaceId)}
              searching={Boolean(search.trim())}
              onNewChat={() => setModal("chat")}
              onNewGroup={() => setModal("group")}
              onNewSpace={() => setModal("space")}
              onInvite={() => setModal("spaceInfo")}
            />
          )}

          {activeSpaceId ? (
            <>
              {textChannels.length > 0 && <p className="section-label">Text channels</p>}
              {textChannels.map(row)}
              {voiceChannels.length > 0 && <p className="section-label">Voice channels</p>}
              {voiceChannels.map(row)}
            </>
          ) : (
            visible.map(row)
          )}
        </div>
      </section>

      {modal === "chat" && <NewChatModal onClose={() => setModal(null)} />}
      {modal === "space" && <NewSpaceModal onClose={() => setModal(null)} />}
      {modal === "group" && <NewGroupModal onClose={() => setModal(null)} />}
      {modal === "settings" && <SettingsModal onClose={() => setModal(null)} />}
      {modal === "spaceInfo" && activeSpaceId && (
        <SpaceModal spaceId={activeSpaceId} onClose={() => setModal(null)} />
      )}
      {modal === "addPeople" && activeRoomId && (
        <AddPeopleModal roomId={activeRoomId} onClose={() => setModal(null)} />
      )}
    </>
  );
}

/** An empty list is the first thing a new account sees. It should offer a next step. */
function EmptyList({
  inSpace, searching, onNewChat, onNewGroup, onNewSpace, onInvite
}: {
  inSpace: boolean; searching: boolean;
  onNewChat: () => void; onNewGroup: () => void;
  onNewSpace: () => void; onInvite: () => void;
}) {
  if (searching) {
    return <p className="list-empty">Nothing here matches that.</p>;
  }
  if (inSpace) {
    return (
      <div className="list-empty">
        <p>This space has no channels yet.</p>
        <button className="btn-primary" onClick={onInvite}>Add a channel</button>
      </div>
    );
  }
  return (
    <div className="list-empty">
      <p>No conversations yet.</p>
      <button className="btn-primary" onClick={onNewChat}>Message someone</button>
      <button className="btn-outline" onClick={onNewGroup}>Create a group</button>
      <button className="btn-outline" onClick={onNewSpace}>Create or join a space</button>
    </div>
  );
}

function RoomRow({
  room, selected, onOpen, online, inVoice, meId
}: {
  room: Room; selected: boolean; onOpen: () => void;
  online: boolean; inVoice: number; meId: string;
}) {
  const isVoice = room.kind === "VOICE";
  const isChannel = room.kind === "TEXT";
  const label = room.name ?? room.counterpart?.displayName ?? "Conversation";
  const last = room.lastMessage;

  const preview = isVoice
    ? inVoice > 0
      ? `${inVoice} connected`
      : "Nobody here right now"
    : last
      ? last.attachmentCount > 0 && !last.content
        ? attachmentLabel(last.attachmentMime)
        : last.content || " "
      : "No messages yet";

  return (
    <button className="row" aria-selected={selected} onClick={onOpen}>
      <div className={`avatar${isVoice ? " voice" : ""}${isChannel ? " channel" : ""}`}>
        {isVoice ? (
          <IconVoiceRoom size={22} />
        ) : isChannel ? (
          <IconHash size={20} />
        ) : (
          /*
           * Numa conversa direta o retrato e o da PESSOA, nao do quarto — o
           * `iconUrl` do quarto so existe para grupo. Sem este `??` a foto de
           * perfil de quem conversa com voce nunca apareceria na lista.
           */
          (() => {
            const foto = room.kind === "DM" ? room.counterpart?.avatarUrl : room.iconUrl;
            return foto ? <img src={fileUrl(foto)} alt="" /> : initials(label);
          })()
        )}
        {online && !isVoice && !isChannel && <span className="presence-dot" />}
      </div>

      <div className="row-body">
        <div className="row-top">
          <span className="row-name">{label}</span>
          {last && !isVoice && (
            <span className={`row-time${room.unread ? " unread" : ""}`}>{listStamp(last.createdAt)}</span>
          )}
        </div>
        <div className="row-bottom">
          <span className={`row-preview${isVoice && inVoice > 0 ? " row-voice" : ""}`}>
            {!isVoice && last && last.authorId === meId && (
              <span className="ticks"><IconChecks size={15} /></span>
            )}
            {(room.kind === "GROUP" || isChannel) && last && last.authorId !== meId && (
              <span style={{ color: "var(--text-faint)" }}>{last.authorName}:</span>
            )}
            {preview}
          </span>
          <span className="row-badges">
            {room.muted && <span className="muted-icon" title="Muted"><IconMute /></span>}
            {room.unread > 0 && <span className="badge">{room.unread > 99 ? "99+" : room.unread}</span>}
          </span>
        </div>
      </div>
    </button>
  );
}

function attachmentLabel(mime: string | null) {
  if (!mime) return "Attachment";
  if (mime.startsWith("image/")) return "Photo";
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("audio/")) return "Audio";
  return "Document";
}
