import { useMemo, useState } from "react";
import { useStore, type Room } from "../store";
import { api, fileUrl } from "../lib/api";
import { initials, listStamp } from "../lib/format";
import {
  IconChats, IconPhone, IconSpaces, IconSearch, IconNewChat, IconMenu,
  IconMute, IconChecks, IconVoiceRoom, IconSettings, IconUserPlus, IconGroup
} from "./icons";
import { NewChatModal, NewSpaceModal } from "./Modals";
import { SpaceModal, NewGroupModal, AddPeopleModal } from "./Invites";

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
  const signOut = useStore((s) => s.signOut);

  const [modal, setModal] = useState<"chat" | "space" | "group" | "spaceInfo" | "addPeople" | null>(
    null
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const activeRoom = rooms.find((r) => r.id === activeRoomId);

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

  const unreadTotal = rooms.reduce((n, r) => n + r.unread, 0);

  return (
    <>
      <nav className="rail" aria-label="Places">
        <button
          className="rail-btn"
          aria-pressed={activeSpaceId === null}
          onClick={() => setActiveSpace(null)}
          title="Chats"
        >
          <IconChats />
          {unreadTotal > 0 && activeSpaceId !== null && (
            <span className="badge" style={{ position: "absolute", top: -2, right: -2 }}>
              {unreadTotal > 99 ? "99+" : unreadTotal}
            </span>
          )}
        </button>
        <button className="rail-btn" title="Calls"><IconPhone /></button>
        <button className="rail-btn" title="People"><IconSpaces /></button>

        <div className="rail-sep" />

        {spaces.map((space) => (
          <button
            key={space.id}
            className="space-chip"
            aria-pressed={activeSpaceId === space.id}
            onClick={() => setActiveSpace(space.id)}
            title={space.name}
          >
            {space.iconUrl ? <img className="rail-avatar" src={fileUrl(space.iconUrl)} alt="" /> : initials(space.name)}
          </button>
        ))}

        <button className="rail-btn" onClick={() => setModal("space")} title="New space">
          <IconNewChat size={22} />
        </button>

        <div className="rail-spacer" />

        <button className="rail-btn" title="Settings"><IconSettings /></button>
        <button className="rail-btn" onClick={() => setMenuOpen((v) => !v)} title={me?.displayName ?? "You"}>
          {me?.avatarUrl ? (
            <img className="rail-avatar" src={fileUrl(me.avatarUrl)} alt="" />
          ) : (
            <span className="avatar" style={{ width: 38, height: 38, flexBasis: 38, fontSize: 14 }}>
              {initials(me?.displayName ?? "?")}
            </span>
          )}
        </button>
        {menuOpen && (
          <div style={{ position: "absolute", bottom: 16, left: 68, zIndex: 30 }}>
            <div className="modal" style={{ width: 200 }}>
              <div className="modal-body" style={{ padding: 8 }}>
                <button
                  className="btn-ghost"
                  style={{ width: "100%", textAlign: "left" }}
                  onClick={() => { setMenuOpen(false); signOut(); }}
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      <section className="list-panel" aria-label="Conversations">
        <header className="list-header">
          <h1>{activeSpaceId ? spaces.find((s) => s.id === activeSpaceId)?.name ?? "Space" : "Chats"}</h1>
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
                className="icon-btn"
                onClick={() => setNewMenuOpen((v) => !v)}
                title="New chat or group"
              >
                <IconNewChat />
              </button>
            )}
            <button className="icon-btn" title="Menu"><IconMenu /></button>

            {newMenuOpen && !activeSpaceId && (
              <div className="modal" style={{ position: "absolute", top: 44, right: 0, width: 220, zIndex: 30 }}>
                <div className="modal-body" style={{ padding: 8 }}>
                  <button
                    className="row"
                    style={{ height: 46, padding: "0 8px", gap: 12 }}
                    onClick={() => { setNewMenuOpen(false); setModal("chat"); }}
                  >
                    <IconNewChat size={18} />
                    <span className="row-name" style={{ fontSize: 14.5 }}>New chat</span>
                  </button>
                  <button
                    className="row"
                    style={{ height: 46, padding: "0 8px", gap: 12 }}
                    onClick={() => { setNewMenuOpen(false); setModal("group"); }}
                  >
                    <IconGroup size={18} />
                    <span className="row-name" style={{ fontSize: 14.5 }}>New group</span>
                  </button>
                  <button
                    className="row"
                    style={{ height: 46, padding: "0 8px", gap: 12 }}
                    onClick={() => { setNewMenuOpen(false); setModal("space"); }}
                  >
                    <IconSpaces size={18} />
                    <span className="row-name" style={{ fontSize: 14.5 }}>New space</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* A space you created is a room with no door until the code is visible. */}
        {activeSpaceId && (
          <button
            className="row"
            style={{ height: 52, borderBottom: "1px solid var(--divider)" }}
            onClick={() => setModal("spaceInfo")}
          >
            <span style={{ color: "var(--accent-bright)", display: "grid", placeItems: "center", width: 32 }}>
              <IconUserPlus size={19} />
            </span>
            <div className="row-body">
              <span className="row-name" style={{ fontSize: 14.5, color: "var(--accent-bright)" }}>
                Invite people to this space
              </span>
              <span className="row-preview">
                Code {spaces.find((s) => s.id === activeSpaceId)?.inviteCode ?? "…"}
              </span>
            </div>
          </button>
        )}

        {activeRoom?.kind === "GROUP" && !activeSpaceId && (
          <button
            className="row"
            style={{ height: 48, borderBottom: "1px solid var(--divider)" }}
            onClick={() => setModal("addPeople")}
          >
            <span style={{ color: "var(--accent-bright)", display: "grid", placeItems: "center", width: 32 }}>
              <IconUserPlus size={18} />
            </span>
            <span className="row-name" style={{ fontSize: 14.5, color: "var(--accent-bright)" }}>
              Add people to {activeRoom.name}
            </span>
          </button>
        )}

        <div className="search-wrap">
          <div className="search">
            <IconSearch />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search or start a new chat"
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
            <p style={{ padding: "32px 24px", color: "var(--text-dim)", fontSize: 13.5, textAlign: "center" }}>
              {search.trim()
                ? "Nothing here matches that."
                : activeSpaceId
                  ? "This space has no channels yet."
                  : "No conversations yet. Start one with the + button."}
            </p>
          )}
          {visible.map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              selected={room.id === activeRoomId}
              onOpen={() => openRoom(room.id)}
              online={room.counterpart ? online.has(room.counterpart.id) : false}
              inVoice={voicePresence[room.id]?.length ?? 0}
              meId={useStore.getState().me?.id ?? ""}
            />
          ))}
        </div>
      </section>

      {modal === "chat" && <NewChatModal onClose={() => setModal(null)} />}
      {modal === "space" && <NewSpaceModal onClose={() => setModal(null)} />}
      {modal === "group" && <NewGroupModal onClose={() => setModal(null)} />}
      {modal === "spaceInfo" && activeSpaceId && (
        <SpaceModal spaceId={activeSpaceId} onClose={() => setModal(null)} />
      )}
      {modal === "addPeople" && activeRoomId && (
        <AddPeopleModal roomId={activeRoomId} onClose={() => setModal(null)} />
      )}
    </>
  );
}

function RoomRow({
  room, selected, onOpen, online, inVoice, meId
}: {
  room: Room; selected: boolean; onOpen: () => void;
  online: boolean; inVoice: number; meId: string;
}) {
  const isVoice = room.kind === "VOICE";
  const label = room.name ?? room.counterpart?.displayName ?? "Conversation";
  const last = room.lastMessage;

  const preview = isVoice
    ? inVoice > 0
      ? `${inVoice} connected`
      : "No one here right now"
    : last
      ? last.attachmentCount > 0 && !last.content
        ? attachmentLabel(last.attachmentMime)
        : last.content || " "
      : "No messages yet";

  return (
    <button className="row" aria-selected={selected} onClick={onOpen}>
      <div className={`avatar${isVoice ? " voice" : ""}`}>
        {isVoice ? (
          <IconVoiceRoom size={22} />
        ) : room.iconUrl ? (
          <img src={fileUrl(room.iconUrl)} alt="" />
        ) : (
          initials(label)
        )}
        {online && !isVoice && <span className="presence-dot" />}
      </div>

      <div className="row-body">
        <div className="row-top">
          <span className="row-name">
            {room.kind === "TEXT" ? `# ${label}` : label}
          </span>
          {last && !isVoice && (
            <span className={`row-time${room.unread ? " unread" : ""}`}>{listStamp(last.createdAt)}</span>
          )}
        </div>
        <div className="row-bottom">
          <span className={`row-preview${isVoice && inVoice > 0 ? " row-voice" : ""}`}>
            {!isVoice && last && last.authorId === meId && (
              <span className="ticks"><IconChecks size={15} /></span>
            )}
            {(room.kind === "GROUP" || room.kind === "TEXT") && last && last.authorId !== meId && (
              <span style={{ color: "var(--text-faint)" }}>{last.authorName}:</span>
            )}
            {preview}
          </span>
          <span className="row-badges">
            {room.muted && <span className="muted-icon"><IconMute /></span>}
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
