import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { inviteLink } from "../lib/deeplink";
import { useStore, type User } from "../store";
import { Avatar } from "./Avatar";
import { IconSearch, IconCopy, IconCheck, IconClose } from "./icons";
import { Scrim } from "./Scrim";
import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";

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
  const { t } = useLingui();
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
          title={t`Copy`}
          style={{ flex: "0 0 auto", borderRadius: 8, width: 44 }}
        >
          {copied ? <IconCheck size={18} /> : <IconCopy />}
        </button>
      </div>
      {copied && (
        <p style={{ color: "var(--accent-bright)", fontSize: 12.5, margin: "6px 0 0" }}>
          <Trans>Copied.</Trans>
        </p>
      )}
    </div>
  );
}

/** A space's door: the invite code, who is already in, and a way to add channels. */
export function SpaceModal({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const { t } = useLingui();
  const spaces = useStore((s) => s.spaces);
  const refreshSpaces = useStore((s) => s.refreshSpaces);
  const refreshRooms = useStore((s) => s.refreshRooms);
  const leaveSpace = useStore((s) => s.leaveSpace);
  const notify = useStore((s) => s.notify);
  const space = spaces.find((s) => s.id === spaceId);
  const [confirmarSaida, setConfirmarSaida] = useState(false);

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
      /*
        Frase inteira por tipo, e não "{tipo} {nome} criado": em português e
        espanhol "sala de voz criada" e "canal criado" mudam a concordância, e
        montar o tipo por fora obriga a tradução a errar um dos dois.
      */
      const nome = channelName.trim();
      notify(
        channelKind === "VOICE" ? t`Voice room ${nome} created.` : t`Channel ${nome} created.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t`That channel could not be created.`);
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
          <Trans>
            Anyone with this link can join. Opening it signs them straight into the space — in the
            desktop app if they have it installed, in the browser if they do not.
          </Trans>
        </p>

        <CopyField value={inviteLink(space.inviteCode)} label={t`Invite link`} />

        <p style={{ color: "var(--text-faint)", fontSize: 12.5, margin: "14px 0 8px" }}>
          <Trans>
            Or send just the code, for someone who would rather type it under{" "}
            <b style={{ color: "var(--text-dim)" }}>New space → Have an invite code?</b>
          </Trans>
        </p>

        <CopyField value={space.inviteCode} label={t`Invite code`} />

        <div style={{ height: 1, background: "var(--divider)", margin: "20px 0" }} />

        <p className="section-label" style={{ padding: 0, marginBottom: 8 }}>
          <Trans>Members</Trans> · {members.length}
        </p>
        {members.map((m) => (
          <div key={m.id} className="row" style={{ height: 56, padding: 0 }}>
            <Avatar name={m.displayName} url={m.avatarUrl} size={38} />
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
          <Trans>New channel</Trans>
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button
            className="chip"
            aria-pressed={channelKind === "TEXT"}
            onClick={() => setChannelKind("TEXT")}
          >
            <Trans>Text</Trans>
          </button>
          <button
            className="chip"
            aria-pressed={channelKind === "VOICE"}
            onClick={() => setChannelKind("VOICE")}
          >
            <Trans>Voice</Trans>
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addChannel()}
            placeholder={channelKind === "TEXT" ? t`announcements` : t`Lounge`}
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
            <Trans>Add</Trans>
          </button>
        </div>
        <div style={{ height: 1, background: "var(--divider)", margin: "20px 0" }} />

        {/*
          Sair ficava impossível: dava para entrar num espaço e nunca mais sair
          dele, nem pela interface nem pela API. A confirmação em dois passos
          existe porque isto tira você de TODOS os canais de uma vez.
        */}
        {confirmarSaida ? (
          <div className="leave-confirm">
            <p>
              <Trans>
                Leaving takes you out of every channel in <b>{space.name}</b>. What you have
                written stays where it is, and you can come back with the invite code.
              </Trans>
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-ghost" onClick={() => setConfirmarSaida(false)}>
                Cancel
              </button>
              <button
                className="btn-outline danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const { spaceDeleted } = await leaveSpace(spaceId);
                    notify(
                      spaceDeleted
                        ? t`You left ${space.name}. Nobody was left, so the space is gone.`
                        : t`You left ${space.name}.`
                    );
                    onClose();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : t`You could not leave that space.`);
                    setBusy(false);
                  }
                }}
              >
                {busy ? <Trans>Leaving…</Trans> : <Trans>Yes, leave</Trans>}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn-outline danger" onClick={() => setConfirmarSaida(true)}>
            <Trans>Leave this space</Trans>
          </button>
        )}
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>
          <Trans>Done</Trans>
        </button>
      </footer>
    </Scrim>
  );
}

/** Search, tick, done. Shared by "new group" and "add people". */
function PeoplePicker({ chosen, onToggle }: { chosen: User[]; onToggle: (u: User) => void }) {
  const { t } = useLingui();
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
            <button key={u.id} className="upload-pill" onClick={() => onToggle(u)} title={t`Remove`}>
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
          placeholder={t`Search by name or username`}
          aria-label={t`Search people`}
        />
      </div>

      {term.trim() && results.length === 0 && (
        <p style={{ color: "var(--text-dim)", fontSize: 13.5 }}>
          <Trans>Nobody here goes by that.</Trans>
        </p>
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
            <Avatar name={u.displayName} url={u.avatarUrl} size={40} online={u.online} />
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
  const { t } = useLingui();
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
      {
        const grupo = name.trim();
        notify(t`Group ${grupo} created.`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`That group could not be created.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Scrim onClose={onClose}>
      <header>
        <Trans>New group</Trans>
      </header>
      <div className="modal-body">
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label htmlFor="group-name">
            <Trans>Group name</Trans>
          </label>
          <input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t`Weekend plans`}
          />
        </div>
        <PeoplePicker chosen={chosen} onToggle={toggle} />
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>
          <Trans>Cancel</Trans>
        </button>
        <button className="btn-ghost" disabled={busy || !name.trim()} onClick={create}>
          {busy ? (
            <Trans>One moment…</Trans>
          ) : chosen.length ? (
            <Trans>Create with {chosen.length}</Trans>
          ) : (
            <Trans>Create</Trans>
          )}
        </button>
      </footer>
    </Scrim>
  );
}

export function AddPeopleModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { t } = useLingui();
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
      {
        const quem = chosen[0].displayName;
        notify(
          chosen.length === 1
            ? t`${quem} was added.`
            : plural(chosen.length, { one: "# person was added.", other: "# people were added." })
        );
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`They could not be added.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Scrim onClose={onClose}>
      <header>
        <Trans>Add people</Trans>
      </header>
      <div className="modal-body">
        {error && <div className="form-error">{error}</div>}
        <PeoplePicker chosen={chosen} onToggle={toggle} />
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>
          <Trans>Cancel</Trans>
        </button>
        <button className="btn-ghost" disabled={busy || chosen.length === 0} onClick={add}>
          {busy ? (
            <Trans>Adding…</Trans>
          ) : chosen.length ? (
            <Trans>Add {chosen.length}</Trans>
          ) : (
            <Trans>Add</Trans>
          )}
        </button>
      </footer>
    </Scrim>
  );
}
