import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore, type Message } from "../store";
import { api, fileUrl, uploadFile } from "../lib/api";
import { clock, daySeparator, fileSize, initials, isImage, isVideo, sameDay } from "../lib/format";
import { signalTyping, stopTyping } from "../lib/socket";
import { EmojiPicker } from "./EmojiPicker";
import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import {
  IconAttach, IconEmoji, IconSend, IconSearch, IconMenu, IconPhone,
  IconVideo, IconChecks, IconCheck, IconClock, IconReply, IconClose, IconFile,
  IconVoiceRoom, IconBack, IconHash, IconMute, IconUserPlus
} from "./icons";

export function Chat({ onStartCall }: { onStartCall: (video: boolean) => void }) {
  const { t } = useLingui();
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
  const refreshRooms = useStore((s) => s.refreshRooms);
  const notify = useStore((s) => s.notify);

  const room = rooms.find((r) => r.id === activeRoomId);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findTerm, setFindTerm] = useState("");
  const [pendingFiles, setPendingFiles] = useState<
    { key: string; name: string; mime: string; size: number; progress: number }[]
  >([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages?.length, activeRoomId]);

  useEffect(() => {
    setDraft("");
    setPendingFiles([]);
    setEmojiOpen(false);
    setMenuOpen(false);
    setFindOpen(false);
    setFindTerm("");
    stickToBottom.current = true;
  }, [activeRoomId]);

  const all = messages ?? [];
  const list = useMemo(() => {
    const t = findTerm.trim().toLowerCase();
    if (!t) return all;
    return all.filter((m) => m.content.toLowerCase().includes(t));
  }, [all, findTerm]);

  if (!room || !activeRoomId) return <EmptyState />;

  const isVoiceRoom = room.kind === "VOICE";
  const isChannel = room.kind === "TEXT";
  const title = room.name ?? room.counterpart?.displayName ?? t`Conversation`;
  const counterpartOnline = room.counterpart ? online.has(room.counterpart.id) : false;

  const subtitle = isVoiceRoom
    ? plural(voicePresence[room.id]?.length ?? 0, { one: "# connected", other: "# connected" })
    : typing && typing.length > 0
      ? t`typing…`
      : room.kind === "DM"
        ? counterpartOnline
          ? t`online`
          : t`offline`
        : room.topic || plural(room.memberCount, { one: "# member", other: "# members" });

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
          setPendingFiles((prev) => prev.map((p, i) => (i === index ? { ...p, progress: pct } : p)))
        );
        setPendingFiles((prev) =>
          prev.map((p, i) => (i === index ? { ...uploaded, progress: 100 } : p))
        );
      } catch (err) {
        setPendingFiles((prev) => prev.filter((_, i) => i !== index));
        notify(err instanceof Error ? err.message : t`That file could not be uploaded.`, "bad");
      }
    }
  }

  async function submit() {
    const text = draft.trim();
    const ready = pendingFiles.filter((f) => f.key);
    if (!text && ready.length === 0) return;

    setDraft("");
    setPendingFiles([]);
    setEmojiOpen(false);
    stopTyping(activeRoomId!);
    stickToBottom.current = true;
    await send(
      activeRoomId!,
      text,
      ready.map((f) => ({ key: f.key, name: f.name, mime: f.mime, size: f.size }))
    );
  }

  function insertEmoji(emoji: string) {
    setDraft((d) => d + emoji);
    setEmojiOpen(false);
    composerRef.current?.focus();
  }

  async function toggleMute() {
    setMenuOpen(false);
    try {
      await api.patch(`/rooms/${activeRoomId}/mute`, { muted: !room!.muted });
      await refreshRooms();
      notify(room!.muted ? t`Notifications turned back on.` : t`Conversation muted.`);
    } catch {
      notify(t`That could not be changed.`, "bad");
    }
  }

  async function leaveRoom() {
    setMenuOpen(false);
    try {
      await api.del(`/rooms/${activeRoomId}/members/me`);
      await refreshRooms();
      closeRoom();
      notify(`You left ${title}.`);
    } catch {
      notify(t`You could not leave that conversation.`, "bad");
    }
  }

  const canSend = Boolean(draft.trim()) || pendingFiles.some((f) => f.key);

  return (
    <section className="chat">
      <header className="chat-header">
        <button className="icon-btn back-btn" onClick={closeRoom} title={t`Back to conversations`}>
          <IconBack />
        </button>
        <div className={`avatar${isVoiceRoom ? " voice" : ""}${isChannel ? " channel" : ""}`}>
          {isVoiceRoom ? <IconVoiceRoom size={20} />
            : isChannel ? <IconHash size={19} />
            : (() => {
                // Conversa direta mostra a pessoa; grupo e canal mostram o quarto.
                const foto = room.kind === "DM" ? room.counterpart?.avatarUrl : room.iconUrl;
                return foto ? <img src={fileUrl(foto)} alt="" /> : initials(title);
              })()}
        </div>
        <div className="chat-title">
          <strong>{title}</strong>
          <span style={typing && typing.length ? { color: "var(--accent-bright)" } : undefined}>
            {subtitle}
          </span>
        </div>

        <div className="header-actions" style={{ position: "relative" }}>
          <button className="icon-btn" title={t`Start a video call`} onClick={() => onStartCall(true)}>
            <IconVideo />
          </button>
          <button className="icon-btn" title={t`Start a voice call`} onClick={() => onStartCall(false)}>
            <IconPhone />
          </button>
          <button
            className="icon-btn"
            title={t`Search in this conversation`}
            aria-pressed={findOpen}
            onClick={() => { setFindOpen((v) => !v); setFindTerm(""); }}
          >
            <IconSearch size={22} />
          </button>
          <button className="icon-btn" title={t`More options`} onClick={() => setMenuOpen((v) => !v)}>
            <IconMenu size={22} />
          </button>

          {menuOpen && (
            <div className="pop-menu right">
              <button onClick={toggleMute}>
                <IconMute size={17} />{" "}
                {room.muted ? <Trans>Unmute notifications</Trans> : <Trans>Mute notifications</Trans>}
              </button>
              {room.kind === "GROUP" && (
                <button onClick={leaveRoom} className="danger">
                  <IconClose size={17} /> <Trans>Leave this group</Trans>
                </button>
              )}
              {room.space && (
                <button onClick={() => { setMenuOpen(false); notify(t`Open the space from the left rail to invite people.`); }}>
                  <IconUserPlus size={17} /> <Trans>How to invite people</Trans>
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {findOpen && (
        <div className="find-bar">
          <IconSearch />
          <input
            autoFocus
            value={findTerm}
            onChange={(e) => setFindTerm(e.target.value)}
            placeholder={t`Find in this conversation`}
            aria-label={t`Find in this conversation`}
          />
          <span className="find-count">
            {findTerm.trim() ? `${list.length} found` : `${all.length} loaded`}
          </span>
          <button className="icon-btn" onClick={() => { setFindOpen(false); setFindTerm(""); }} title={t`Close search`}>
            <IconClose size={18} />
          </button>
        </div>
      )}

      <div
        className="messages"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (el.scrollTop < 120 && cursor && !findTerm) {
            const before = el.scrollHeight;
            loadOlder(activeRoomId!).then(() => {
              requestAnimationFrame(() => {
                el.scrollTop = el.scrollHeight - before;
              });
            });
          }
        }}
      >
        {findTerm.trim() && list.length === 0 && (
          <div className="day-sep"><span>Nothing loaded matches “{findTerm.trim()}”</span></div>
        )}
        {!findTerm && cursor && <div className="day-sep">
            <span>
              <Trans>Loading earlier messages…</Trans>
            </span>
          </div>}
        {!findTerm && !cursor && all.length > 0 && (
          <div className="day-sep">
            <span>
              <Trans>This is the start of the conversation</Trans>
            </span>
          </div>
        )}
        {isVoiceRoom && all.length === 0 && (
          <div className="day-sep">
            <span>
              <Trans>Voice room — press the call button above to join</Trans>
            </span>
          </div>
        )}

        {list.map((message, i) => {
          const prev = list[i - 1];
          const newDay = !prev || !sameDay(prev.createdAt, message.createdAt);
          const firstOfRun = newDay || !prev || prev.author.id !== message.author.id;
          return (
            <div key={message.id}>
              {newDay && <div className="day-sep"><span>{daySeparator(message.createdAt)}</span></div>}
              <Bubble
                message={message}
                mine={message.author.id === me?.id}
                firstOfRun={firstOfRun}
                showAuthor={firstOfRun && room.kind !== "DM" && message.author.id !== me?.id}
                onReply={setReplyTo}
              />
            </div>
          );
        })}

        {typing && typing.length > 0 && (
          <div className="typing-line">
            {typing.length === 1
              ? t`typing…`
              : plural(typing.length, {
                  one: "# person is typing…",
                  other: "# people are typing…"
                })}
          </div>
        )}
      </div>

      {replyTo && (
        <div className="reply-bar">
          <div className="rb-body">
            <b>{replyTo.author.displayName}</b>
            <span>{replyTo.content || "Attachment"}</span>
          </div>
          <button className="icon-btn" onClick={() => setReplyTo(null)} title={t`Cancel reply`}>
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
                title={t`Remove`}
                style={{ display: "grid", placeItems: "center" }}
              >
                <IconClose size={14} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="composer">
        <div style={{ position: "relative" }}>
          <button
            className="icon-btn"
            title={t`Insert an emoji`}
            aria-pressed={emojiOpen}
            onClick={() => setEmojiOpen((v) => !v)}
          >
            <IconEmoji />
          </button>
          {emojiOpen && (
            <div className="emoji-anchor">
              <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
            </div>
          )}
        </div>

        <button className="icon-btn" title={t`Attach a file`} onClick={() => fileInput.current?.click()}>
          <IconAttach />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => { onFilesPicked(e.target.files); e.target.value = ""; }}
        />

        <textarea
          ref={composerRef}
          className="composer-input"
          rows={1}
          value={draft}
          placeholder={isVoiceRoom ? t`Message this voice room` : t`Type a message`}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            signalTyping(activeRoomId!);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
        />

        {/* Send is always here, disabled until there is something to send. A
            microphone button that records nothing was worse than no button. */}
        <button
          className="icon-btn accent"
          onClick={submit}
          disabled={!canSend}
          title={canSend ? t`Send` : t`Write something first`}
        >
          <IconSend size={20} />
        </button>
      </div>
    </section>
  );
}

/**
 * Uma bolha de mensagem.
 *
 * Memoizada porque a lista nao e virtualizada: sem isso, cada tecla digitada
 * por alguem do outro lado ("esta digitando…") re-renderizava TODAS as
 * mensagens da conversa. Com 200 mensagens abertas isso e trabalho puro e
 * jogado fora, e e o que fazia a rolagem engasgar.
 *
 * Para o memo valer, as props precisam ser estaveis: `onReply` recebe a acao do
 * store (que nunca muda) em vez de uma seta nova a cada render, e a identidade
 * de `message` e preservada pelo dedupe do store.
 */
const Bubble = memo(function Bubble({
  message, mine, firstOfRun, showAuthor, onReply
}: {
  message: Message; mine: boolean; firstOfRun: boolean;
  showAuthor: boolean; onReply: (m: Message) => void;
}) {
  const react = useStore((s) => s.react);
  const me = useStore((s) => s.me);
  const [pickerOpen, setPickerOpen] = useState(false);
  /*
   * `useLingui` dentro do `memo` não é redundante: é ele que assina a troca de
   * idioma. Sem isso o balão está memoizado por `message`, que não muda quando
   * o idioma muda — e "editado" e "mensagem apagada" ficariam no idioma antigo
   * até a mensagem ser reescrita.
   */
  const { t } = useLingui();

  return (
    <div
      className={`msg ${mine ? "out" : "in"}${firstOfRun ? " first-of-run" : ""}`}
      /* Long-press and double-tap open the actions on touch, where hover does
         not exist and these were simply unreachable. */
      onDoubleClick={() => setPickerOpen(true)}
      onContextMenu={(e) => { e.preventDefault(); setPickerOpen(true); }}
    >
      <div className="bubble">
        {showAuthor && <div className="bubble-author">{message.author.displayName}</div>}

        {message.replyTo && (
          <div className="reply-quote">
            <b>{message.replyTo.author.displayName ?? t`Someone`}</b>
            <span>
              {message.replyTo.deleted ? t`Message deleted` : message.replyTo.content || t`Attachment`}
            </span>
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
          <div className="bubble-text deleted">
            <Trans>This message was deleted</Trans>
          </div>
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
                title={r.userIds.includes(me?.id ?? "") ? t`Remove your reaction` : t`React`}
              >
                {r.emoji} {r.userIds.length}
              </button>
            ))}
          </div>
        )}

        <span className="bubble-meta">
          {message.editedAt && (
            <span>
              <Trans>edited</Trans>
            </span>
          )}
          {clock(message.createdAt)}
          {mine && (
            <span className="ticks">
              {message.pending ? <IconClock /> : message.failed ? <IconCheck size={15} /> : <IconChecks />}
            </span>
          )}
        </span>

        {message.failed && (
          <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>
            <Trans>Not sent. Check your connection.</Trans>
          </div>
        )}
      </div>

      {/* Always in the DOM, reserving its space, revealed on hover or focus.
          Rendering it conditionally made the bubble jump sideways. */}
      {!message.deleted && (
        <div className="msg-actions">
          <button className="icon-btn" onClick={() => onReply(message)} title={t`Reply to this message`}>
            <IconReply size={16} />
          </button>
          <div style={{ position: "relative" }}>
            <button
              className="icon-btn"
              onClick={() => setPickerOpen((v) => !v)}
              title={t`React to this message`}
            >
              <IconEmoji size={16} />
            </button>
            {pickerOpen && (
              <div className={`react-anchor${mine ? " left" : ""}`}>
                <EmojiPicker
                  compact
                  onPick={(e) => { react(message.id, e); setPickerOpen(false); }}
                  onClose={() => setPickerOpen(false)}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

/** What a brand new account sees. It should offer a first step, not a shrug. */
function EmptyState() {
  return (
    <div className="empty">
      <div className="empty-inner">
        <h2>WhatsCord</h2>
        <p>
          <Trans>
            Pick a conversation on the left, or start one. Voice rooms sit in the same list — open
            one and press the call button in the header to join whoever is there.
          </Trans>
        </p>
        <div className="rule" />
        <p style={{ fontSize: 13 }}>
          <Trans>
            Messages travel over an encrypted connection. Calls run through your own LiveKit server.
          </Trans>
        </p>
      </div>
    </div>
  );
}
