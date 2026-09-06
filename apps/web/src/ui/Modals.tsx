import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useStore, type User } from "../store";
import { Avatar } from "./Avatar";
import { IconSearch } from "./icons";
import { Scrim } from "./Scrim";
import { Trans, useLingui } from "@lingui/react/macro";

export function NewChatModal({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const openRoom = useStore((s) => s.openRoom);
  const refreshRooms = useStore((s) => s.refreshRooms);
  const notify = useStore((s) => s.notify);

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
      notify(`Chat with ${user.displayName} is open.`);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Scrim onClose={onClose}>
      <header>
        <Trans>New chat</Trans>
      </header>
      <div className="modal-body">
        <div className="search" style={{ marginBottom: 12 }}>
          <IconSearch />
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t`Search by name or username`}
            aria-label={t`Search people`}
          />
        </div>

        {term.trim() && results.length === 0 && (
          <p style={{ color: "var(--text-dim)", fontSize: 13.5, padding: "12px 0" }}>
            <Trans>Nobody here goes by that.</Trans>
          </p>
        )}

        {results.map((user) => (
          <button key={user.id} className="row" style={{ height: 64 }} disabled={busy} onClick={() => start(user)}>
            <Avatar name={user.displayName} url={user.avatarUrl} size={40} online={user.online} />
            <div className="row-body">
              <div className="row-name">{user.displayName}</div>
              <div className="row-preview">@{user.username}</div>
            </div>
          </button>
        ))}
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>
          <Trans>Close</Trans>
        </button>
      </footer>
    </Scrim>
  );
}

export function NewSpaceModal({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const refreshSpaces = useStore((s) => s.refreshSpaces);
  const refreshRooms = useStore((s) => s.refreshRooms);
  const setActiveSpace = useStore((s) => s.setActiveSpace);
  const notifySpace = useStore((s) => s.notify);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ space: { id: string } }>("/spaces", { name: name.trim() });
      await Promise.all([refreshSpaces(), refreshRooms()]);
      setActiveSpace(res.space.id);
      notifySpace(`Space ${name.trim()} created. Share the invite code to bring people in.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`That did not work.`);
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!joinCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ space: { id: string; name: string } }>(`/spaces/join/${joinCode.trim()}`);
      await Promise.all([refreshSpaces(), refreshRooms()]);
      setActiveSpace(res.space.id);
      notifySpace(`You joined ${res.space.name}.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`That invite did not work.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Scrim onClose={onClose}>
      <header>
        <Trans>New space</Trans>
      </header>
      <div className="modal-body">
        {error && <div className="form-error">{error}</div>}
        <p style={{ color: "var(--text-dim)", fontSize: 13.5, marginTop: 0 }}>
          <Trans>
            A space holds text channels and voice rooms, and everyone you invite sees all of them.
          </Trans>
        </p>
        <div className="field">
          <label htmlFor="space-name">
            <Trans>Name</Trans>
          </label>
          <input id="space-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t`Design team`} />
        </div>
        <button className="btn-primary" disabled={busy || !name.trim()} onClick={create}>
          {busy ? <Trans>One moment…</Trans> : <Trans>Create space</Trans>}
        </button>

        <div style={{ height: 1, background: "var(--divider)", margin: "24px 0" }} />

        <div className="field">
          <label htmlFor="join-code">
            <Trans>Have an invite code?</Trans>
          </label>
          <input id="join-code" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="a1b2c3d4e5" />
        </div>
        <button className="btn-ghost" style={{ padding: 0 }} disabled={busy || !joinCode.trim()} onClick={join}>
          <Trans>Join that space</Trans>
        </button>
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>
          <Trans>Cancel</Trans>
        </button>
      </footer>
    </Scrim>
  );
}
