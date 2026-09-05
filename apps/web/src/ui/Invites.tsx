import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useStore, type User } from "../store";
import { initials } from "../lib/format";
import { IconSearch, IconCopy, IconCheck, IconClose } from "./icons";
import { Scrim } from "./Scrim";

/*
 * Getting people in.
 *
 * The API has always minted an invite code for every space, but nothing in the
 * UI ever showed it — so a space you created was a room with no door. These
 * cover the three ways someone gets in: a code for a space, a group you build
 * from a list, and adding people to a group after the fact.
 */

/** Copies to the clipboard and confirms in place, the way a copy button should. */
function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const id = `copy-${label.replace(/\s+/g, "-").toLowerCase()}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can be refused; select the text so it is still copyable by hand.
      (document.getElementById(id) as HTMLInputElement | null)?.select();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          id={id}
          readOnly
          value={value}
          onFocus={(e) => e.target.select()}
          style={{ flex: 1, fontFamily: "ui-monospace, monospace", letterSpacing: "0.04em" }}
        />
        <button
          className="icon-btn accent"
          onClick={copy}
          title="Copy"
          style={{ flex: "0 0 auto", borderRadius: 8, width: 44 }}
        >
          {copied ? <IconCheck size={18} /> : <IconCopy />}
        </button>
      </div>
      {copied && (
        <p style={{ color: "var(--accent-bright)", fontSize: 12.5, margin: "6px 0 0" }}>Copied.</p>
      )}
    </div>
  );
}

/** A space's door: the invite code, who is already in, and a way to add channels. */
export function SpaceModal({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const spaces = useStore((s) => s.spaces);
  const refreshSpaces = useStore((s) => s.refreshSpaces);
  const refreshRooms = useStore((s) => s.refreshRooms);
  const notify = useStore((s) => s.notify);
  const space = spaces.find((s) => s.id === spaceId);

  const [members, setMembers] = useState<User[]>([]);
  const [channelName, setChannelName] = useState("");
  const [channelKind, setChannelKind] = useState<"TEXT" | "VOICE">("TEXT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ members: User[] }>(`/spaces/${spaceId}/members`)
      .then((r) => setMembers(r.members))
      .catch(() => setMembers([]));
  }, [spaceId]);

  if (!space) return null;

  async function addChannel() {
    if (!channelName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/spaces/${spaceId}/channels`, {
        name: channelName.trim(),
        kind: channelKind
      });
      setChannelName("");
      await Promise.all([refreshSpaces(), refreshRooms()]);
      notify(`${channelKind === "VOICE" ? "Voice room" : "Channel"} ${channelName.trim()} created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That channel could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Scrim onClose={onClose}>
      <header>{space.name}</header>
      <div className="modal-body">
        {error && <div className="form-error">{error}</div>}

        <p style={{ color: "var(--text-dim)", fontSize: 13.5, margin: "0 0 14px" }}>
          Anyone with this code can join. Send it over, and they enter it under{" "}
          <b style={{ color: "var(--text)" }}>New space → Have an invite code?</b>
        </p>

        <CopyField value={space.inviteCode} label="Invite code" />

        <div style={{ height: 1, background: "var(--divider)", margin: "20px 0" }} />

        <p className="section-label" style={{ padding: 0, marginBottom: 8 }}>
          Members · {members.length}
        </p>
        {members.map((m) => (
          <div key={m.id} className="row" style={{ height: 56, padding: 0 }}>
            <div className="avatar" style={{ width: 38, height: 38, flexBasis: 38, fontSize: 14 }}>
              {initials(m.displayName)}
            </div>
            <div className="row-body">
              <div className="row-name" style={{ fontSize: 15 }}>
                {m.displayName}
              </div>
              <div className="row-preview">@{m.username}</div>
            </div>
          </div>
        ))}

        <div style={{ height: 1, background: "var(--divider)", margin: "20px 0" }} />

        <p className="section-label" style={{ padding: 0, marginBottom: 8 }}>
          New channel
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button
            className="chip"
            aria-pressed={channelKind === "TEXT"}
            onClick={() => setChannelKind("TEXT")}
          >
            Text
          </button>
          <button
            className="chip"
            aria-pressed={channelKind === "VOICE"}
            onClick={() => setChannelKind("VOICE")}
          >
            Voice
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addChannel()}
            placeholder={channelKind === "TEXT" ? "announcements" : "Lounge"}
            style={{
              flex: 1,
              background: "var(--input)",
              border: "1px solid transparent",
              borderRadius: 8,
              padding: "10px 12px",
              outline: "none"
            }}
          />
          <button className="btn-ghost" disabled={busy || !channelName.trim()} onClick={addChannel}>
            Add
          </button>
        </div>
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>
          Done
        </button>
      </footer>
    </Scrim>
  );
}

/** Search, tick, done. Shared by "new group" and "add people". */
function PeoplePicker({ chosen, onToggle }: { chosen: User[]; onToggle: (u: User) => void }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<User[]>([]);

  useEffect(() => {
    if (!term.trim()) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      try {
        const r = await api.get<{ users: User[] }>(
          `/users/search?q=${encodeURIComponent(term.trim())}`
        );
        setResults(r.users);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [term]);

  return (
    <>
      {chosen.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {chosen.map((u) => (
            <button key={u.id} className="upload-pill" onClick={() => onToggle(u)} title="Remove">
              {u.displayName}
              <IconClose size={13} />
            </button>
          ))}
        </div>
      )}

      <div className="search" style={{ marginBottom: 10 }}>
        <IconSearch />
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by name or username"
          aria-label="Search people"
        />
      </div>

      {term.trim() && results.length === 0 && (
        <p style={{ color: "var(--text-dim)", fontSize: 13.5 }}>Nobody here goes by that.</p>
      )}

      {results.map((u) => {
        const picked = chosen.some((c) => c.id === u.id);
        return (
          <button
            key={u.id}
            className="row"
            style={{ height: 60, padding: 0 }}
            aria-selected={picked}
            onClick={() => onToggle(u)}
          >
            <div className="avatar" style={{ width: 40, height: 40, flexBasis: 40, fontSize: 14 }}>
              {initials(u.displayName)}
              {u.online && <span className="presence-dot" />}
            </div>
            <div className="row-body">
              <div className="row-name" style={{ fontSize: 15 }}>
                {u.displayName}
              </div>
              <div className="row-preview">@{u.username}</div>
            </div>
            {picked && (
              <span style={{ color: "var(--accent-bright)" }}>
                <IconCheck size={18} />
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

export function NewGroupModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshRooms = useStore((s) => s.refreshRooms);
  const openRoom = useStore((s) => s.openRoom);
  const notify = useStore((s) => s.notify);

  const toggle = (u: User) =>
    setChosen((prev) =>
      prev.some((c) => c.id === u.id) ? prev.filter((c) => c.id !== u.id) : [...prev, u]
    );

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ room: { id: string } }>("/rooms/group", {
        name: name.trim(),
        memberIds: chosen.map((c) => c.id)
      });
      await refreshRooms();
      await openRoom(res.room.id);
      notify(`Group ${name.trim()} created.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That group could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Scrim onClose={onClose}>
      <header>New group</header>
      <div className="modal-body">
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label htmlFor="group-name">Group name</label>
          <input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Weekend plans"
          />
        </div>
        <PeoplePicker chosen={chosen} onToggle={toggle} />
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-ghost" disabled={busy || !name.trim()} onClick={create}>
          {busy ? "One moment…" : `Create${chosen.length ? ` with ${chosen.length}` : ""}`}
        </button>
      </footer>
    </Scrim>
  );
}

export function AddPeopleModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const [chosen, setChosen] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshRooms = useStore((s) => s.refreshRooms);
  const notify = useStore((s) => s.notify);

  const toggle = (u: User) =>
    setChosen((prev) =>
      prev.some((c) => c.id === u.id) ? prev.filter((c) => c.id !== u.id) : [...prev, u]
    );

  async function add() {
    if (chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/rooms/${roomId}/members`, { userIds: chosen.map((c) => c.id) });
      await refreshRooms();
      notify(chosen.length === 1 ? `${chosen[0].displayName} was added.` : `${chosen.length} people were added.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "They could not be added.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Scrim onClose={onClose}>
      <header>Add people</header>
      <div className="modal-body">
        {error && <div className="form-error">{error}</div>}
        <PeoplePicker chosen={chosen} onToggle={toggle} />
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-ghost" disabled={busy || chosen.length === 0} onClick={add}>
          {busy ? "Adding…" : `Add ${chosen.length || ""}`}
        </button>
      </footer>
    </Scrim>
  );
}
