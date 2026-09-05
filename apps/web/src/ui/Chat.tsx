import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore, type Message } from "../store";
import { fileUrl, uploadFile } from "../lib/api";
import { clock, daySeparator, fileSize, initials, isImage, isVideo, sameDay } from "../lib/format";
import { signalTyping, stopTyping } from "../lib/socket";
import {
  IconAttach, IconEmoji, IconSend, IconMic, IconSearch, IconMenu, IconPhone,
  IconVideo, IconChecks, IconCheck, IconClock, IconReply, IconClose, IconFile,
  IconVoiceRoom, IconBack
} from "./icons";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export function Chat({ onStartCall }: { onStartCall: (video: boolean) => void }) {
  const activeRoomId = useStore((s) => s.activeRoomId);
  const rooms = useStore((s) => s.rooms);
  const messages = useStore((s) => (activeRoomId ? s.messages[activeRoomId] : undefined));
  const typing = useStore((s) => (activeRoomId ? s.typing[activeRoomId] : undefined));
  const online = useStore((s) => s.online);
  const cursor = useStore((s) => (activeRoomId ? s.cursors[activeRoomId] : null));
  const me = useStore((s) => s.me);
  const replyTo = useStore((s) => s.replyTo);
  const voicePresence = useStore((s) => s.voicePresence);

  const send = useStore((s) => s.send);
  const loadOlder = useStore((s) => s.loadOlder);
  const setReplyTo = useStore((s) => s.setReplyTo);
  const closeRoom = useStore((s) => s.closeRoom);

  const room = rooms.find((r) => r.id === activeRoomId);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<
    { key: string; name: string; mime: string; size: number; progress: number }[]
  >([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // Follow new messages, but only when the reader is already at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages?.length, activeRoomId]);

  useEffect(() => {
    setDraft("");
    setPendingFiles([]);
    stickToBottom.current = true;
  }, [activeRoomId]);

  if (!room || !activeRoomId) return <EmptyState />;

  const isVoiceRoom = room.kind === "VOICE";
  const title = room.name ?? room.counterpart?.displayName ?? "Conversation";
  const counterpartOnline = room.counterpart ? online.has(room.counterpart.id) : false;

  const subtitle = isVoiceRoom
    ? `${voicePresence[room.id]?.length ?? 0} connected`
    : typing && typing.length > 0
      ? "typing…"
      : room.kind === "DM"
        ? counterpartOnline
          ? "online"
          : "offline"
        : room.topic || `${room.memberCount} members`;

  async function onFilesPicked(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files).slice(0, 5)) {
      const index = pendingFiles.length;
      setPendingFiles((prev) => [
        ...prev,
        { key: "", name: file.name, mime: file.type, size: file.size, progress: 0 }
      ]);
      try {
        const uploaded = await uploadFile(file, (pct) =>
          setPendingFiles((prev) =>
            prev.map((p, i) => (i === index ? { ...p, progress: pct } : p))
          )
        );
        setPendingFiles((prev) =>
          prev.map((p, i) => (i === index ? { ...uploaded, progress: 100 } : p))
        );
      } catch {
        setPendingFiles((prev) => prev.filter((_, i) => i !== index));
      }
    }
  }

  async function submit() {
    const text = draft.trim();
    const ready = pendingFiles.filter((f) => f.key);
    if (!text && ready.length === 0) return;

    setDraft("");
    setPendingFiles([]);
    stopTyping(activeRoomId!);
    stickToBottom.current = true;
    await send(
      activeRoomId!,
      text,
      ready.map((f) => ({ key: f.key, name: f.name, mime: f.mime, size: f.size }))
    );
  }

  const list = messages ?? [];

  return (
    <section className="chat">
      <header className="chat-header">
        {/* Only rendered on a narrow screen, where the list is off-screen. */}
        <button className="icon-btn back-btn" onClick={closeRoom} title="Back to conversations">
          <IconBack />
        </button>
        <div className={`avatar${isVoiceRoom ? " voice" : ""}`}>
          {isVoiceRoom ? <IconVoiceRoom size={20} /> : room.iconUrl ? (
            <img src={fileUrl(room.iconUrl)} alt="" />
          ) : (
            initials(title)
          )}
        </div>
        <div className="chat-title">
          <strong>{room.kind === "TEXT" ? `# ${title}` : title}</strong>
          <span style={typing && typing.length ? { color: "var(--accent-bright)" } : undefined}>
            {subtitle}
          </span>
        </div>
        <div className="header-actions">
          <button className="icon-btn" title="Start a video call" onClick={() => onStartCall(true)}>
            <IconVideo />
          </button>
          <button className="icon-btn" title="Start a voice call" onClick={() => onStartCall(false)}>
            <IconPhone />
          </button>
          <button className="icon-btn" title="Search in conversation"><IconSearch size={22} /></button>
          <button className="icon-btn" title="Menu"><IconMenu size={22} /></button>
        </div>
      </header>

      <div
        className="messages"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (el.scrollTop < 120 && cursor) {
            const before = el.scrollHeight;
            loadOlder(activeRoomId!).then(() => {
              requestAnimationFrame(() => {
                el.scrollTop = el.scrollHeight - before;
              });
            });
          }
        }}
      >
        {cursor && (
          <div className="day-sep"><span>Loading earlier messages…</span></div>
        )}
        {!cursor && list.length > 0 && (
          <div className="day-sep"><span>This is the start of the conversation</span></div>
        )}

        {isVoiceRoom && list.length === 0 && (
          <div className="day-sep">
            <span>Voice room — press the call button to join</span>
          </div>
        )}

        {list.map((message, i) => {
          const prev = list[i - 1];
          const newDay = !prev || !sameDay(prev.createdAt, message.createdAt);
          const firstOfRun =
            newDay || !prev || prev.author.id !== message.author.id;
          return (
            <div key={message.id}>
              {newDay && (
                <div className="day-sep"><span>{daySeparator(message.createdAt)}</span></div>
              )}
              <Bubble
                message={message}
                mine={message.author.id === me?.id}
                firstOfRun={firstOfRun}
                showAuthor={firstOfRun && room.kind !== "DM" && message.author.id !== me?.id}
                onReply={() => setReplyTo(message)}
              />
            </div>
          );
        })}

        {typing && typing.length > 0 && (
          <div className="typing-line">
            {typing.length === 1 ? "typing…" : `${typing.length} people are typing…`}
          </div>
        )}
      </div>

      {replyTo && (
        <div className="reply-bar">
          <div className="rb-body">
            <b>{replyTo.author.displayName}</b>
            <span>{replyTo.content || "Attachment"}</span>
          </div>
          <button className="icon-btn" onClick={() => setReplyTo(null)} title="Cancel reply">
            <IconClose />
          </button>
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div className="upload-strip">
          {pendingFiles.map((f, i) => (
            <span className="upload-pill" key={`${f.name}-${i}`}>
              <IconFile size={15} />
              {f.name}
              <span style={{ color: "var(--text-dim)" }}>
                {f.progress < 100 ? `${f.progress}%` : fileSize(f.size)}
              </span>
              <button
                onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                title="Remove"
                style={{ display: "grid", placeItems: "center" }}
              >
                <IconClose size={14} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="composer">
        <button className="icon-btn" title="Emoji"><IconEmoji /></button>
        <button className="icon-btn" title="Attach" onClick={() => fileInput.current?.click()}>
          <IconAttach />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            onFilesPicked(e.target.files);
            e.target.value = "";
          }}
        />
        <textarea
          className="composer-input"
          rows={1}
          value={draft}
          placeholder="Type a message"
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            signalTyping(activeRoomId!);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {draft.trim() || pendingFiles.some((f) => f.key) ? (
          <button className="icon-btn accent" onClick={submit} title="Send">
            <IconSend size={20} />
          </button>
        ) : (
          <button className="icon-btn" title="Voice message"><IconMic /></button>
        )}
      </div>
    </section>
  );
}

function Bubble({
  message, mine, firstOfRun, showAuthor, onReply
}: {
  message: Message; mine: boolean; firstOfRun: boolean;
  showAuthor: boolean; onReply: () => void;
}) {
  const react = useStore((s) => s.react);
  const me = useStore((s) => s.me);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`msg ${mine ? "out" : "in"}${firstOfRun ? " first-of-run" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="bubble">
        {showAuthor && <div className="bubble-author">{message.author.displayName}</div>}

        {message.replyTo && (
          <div className="reply-quote">
            <b>{message.replyTo.author.displayName ?? "Someone"}</b>
            <span>{message.replyTo.deleted ? "Message deleted" : message.replyTo.content || "Attachment"}</span>
          </div>
        )}

        {message.attachments.map((a) =>
          isImage(a.mime) ? (
            <img key={a.id} className="attach-image" src={fileUrl(a.url)} alt={a.name} loading="lazy" />
          ) : isVideo(a.mime) ? (
            <video key={a.id} className="attach-video" src={fileUrl(a.url)} controls preload="metadata" />
          ) : (
            <a key={a.id} className="attach-file" href={fileUrl(a.url)} target="_blank" rel="noreferrer">
              <IconFile />
              <span>
                <span className="file-name">{a.name}</span>
                <br />
                <span className="file-size">{fileSize(a.size)}</span>
              </span>
            </a>
          )
        )}

        {message.deleted ? (
          <div className="bubble-text deleted">This message was deleted</div>
        ) : (
          message.content && <div className="bubble-text">{message.content}</div>
        )}

        {message.reactions.length > 0 && (
          <div className="reactions">
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                className="reaction"
                aria-pressed={me ? r.userIds.includes(me.id) : false}
                onClick={() => react(message.id, r.emoji)}
              >
                {r.emoji} {r.userIds.length}
              </button>
            ))}
          </div>
        )}

        <span className="bubble-meta">
          {message.editedAt && <span>edited</span>}
          {clock(message.createdAt)}
          {mine && (
            <span className={`ticks${message.failed ? "" : ""}`}>
              {message.pending ? <IconClock /> : message.failed ? <IconCheck size={15} /> : <IconChecks />}
            </span>
          )}
        </span>

        {message.failed && (
          <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>
            Not sent. Check your connection.
          </div>
        )}
      </div>

      {hovered && !message.deleted && (
        <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "0 6px" }}>
          <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={onReply} title="Reply">
            <IconReply size={16} />
          </button>
          <button
            className="icon-btn"
            style={{ width: 30, height: 30, fontSize: 15 }}
            onClick={() => react(message.id, QUICK_REACTIONS[0])}
            title="React"
          >
            {QUICK_REACTIONS[0]}
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <div className="empty-inner">
        <h2>WhatsCord</h2>
        <p>
          Pick a conversation on the left, or start a new one. Voice rooms sit in the same
          list — open one and press the call button to join whoever is already there.
        </p>
        <div className="rule" />
        <p style={{ fontSize: 13 }}>Messages are encrypted in transit. Calls run peer-to-server over your own LiveKit.</p>
      </div>
    </div>
  );
}
