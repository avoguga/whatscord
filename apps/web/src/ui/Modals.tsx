import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useStore, type User } from "../store";
import { initials } from "../lib/format";
import { IconSearch } from "./icons";

function Scrim({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

export function NewChatModal({ onClose }: { onClose: () => void }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const openRoom = useStore((s) => s.openRoom);
  const refreshRooms = useStore((s) => s.refreshRooms);

  useEffect(() => {
    if (!term.trim()) return setResults([]);
    const id = setTimeout(async () => {
      try {
        const res = await api.get<{ users: User[] }>(`/users/search?q=${encodeURIComponent(term.trim())}`);
        setResults(res.users);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [term]);

  async function start(user: User) {
    setBusy(true);
    try {
      const res = await api.post<{ room: { id: string } }>("/rooms/dm", { userId: user.id });
      await refreshRooms();
      await openRoom(res.room.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Scrim onClose={onClose}>
      <header>New chat</header>
      <div className="modal-body">
        <div className="search" style={{ marginBottom: 12 }}>
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
          <p style={{ color: "var(--text-dim)", fontSize: 13.5, padding: "12px 0" }}>
            Nobody here goes by that.
          </p>
        )}

        {results.map((user) => (
          <button key={user.id} className="row" style={{ height: 64 }} disabled={busy} onClick={() => start(user)}>
            <div className="avatar" style={{ width: 42, height: 42, flexBasis: 42, fontSize: 15 }}>
              {initials(user.displayName)}
              {user.online && <span className="presence-dot" />}
            </div>
            <div className="row-body">
              <div className="row-name">{user.displayName}</div>
              <div className="row-preview">@{user.username}</div>
            </div>
          </button>
        ))}
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>Close</button>
      </footer>
    </Scrim>
  );
}

export function NewSpaceModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const refreshSpaces = useStore((s) => s.refreshSpaces);
  const refreshRooms = useStore((s) => s.refreshRooms);
  const setActiveSpace = useStore((s) => s.setActiveSpace);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ space: { id: string } }>("/spaces", { name: name.trim() });
      await Promise.all([refreshSpaces(), refreshRooms()]);
      setActiveSpace(res.space.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!joinCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ space: { id: string } }>(`/spaces/join/${joinCode.trim()}`);
      await Promise.all([refreshSpaces(), refreshRooms()]);
      setActiveSpace(res.space.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That invite did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Scrim onClose={onClose}>
      <header>New space</header>
      <div className="modal-body">
        {error && <div className="form-error">{error}</div>}
        <p style={{ color: "var(--text-dim)", fontSize: 13.5, marginTop: 0 }}>
          A space holds text channels and voice rooms, and everyone you invite sees all of them.
        </p>
        <div className="field">
          <label htmlFor="space-name">Name</label>
          <input id="space-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Design team" />
        </div>
        <button className="btn-primary" disabled={busy || !name.trim()} onClick={create}>
          {busy ? "One moment…" : "Create space"}
        </button>

        <div style={{ height: 1, background: "var(--divider)", margin: "24px 0" }} />

        <div className="field">
          <label htmlFor="join-code">Have an invite code?</label>
          <input id="join-code" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="a1b2c3d4e5" />
        </div>
        <button className="btn-ghost" style={{ padding: 0 }} disabled={busy || !joinCode.trim()} onClick={join}>
          Join that space
        </button>
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </footer>
    </Scrim>
  );
}
