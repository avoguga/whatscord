import { useEffect, useRef, useState } from "react";
import { api, uploadFile } from "../lib/api";
import { inviteLink } from "../lib/deeplink";
import { ImageError, squareThumbnail } from "../lib/image";
import { useStore, type Room, type SpaceRole, type User } from "../store";
import { Avatar } from "./Avatar";
import { IconSearch, IconCopy, IconCheck, IconClose } from "./icons";
import { Scrim } from "./Scrim";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg, plural } from "@lingui/core/macro";
import type { I18n } from "@lingui/core";

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

/** Um membro do espaço, com o papel que ele tem lá dentro. */
type SpaceMember = User & { role: SpaceRole; joinedAt?: string };

/*
 * Os nomes dos papéis ficam em `msg` e são traduzidos com o `i18n` do hook.
 * Uma tabela de strings já traduzidas no topo do módulo é avaliada na
 * importação, antes de o catálogo existir, e não reage à troca de idioma.
 */
const NOME_DO_PAPEL = {
  OWNER: msg`Owner`,
  ADMIN: msg`Admin`,
  MEMBER: msg`Member`
} as const;

function rotuloDoPapel(papel: SpaceRole, i18n: I18n) {
  return i18n._(NOME_DO_PAPEL[papel] ?? NOME_DO_PAPEL.MEMBER);
}

/** A space's door: the invite code, who is already in, and a way to add channels. */
export function SpaceModal({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const { t, i18n } = useLingui();
  const spaces = useStore((s) => s.spaces);
  const me = useStore((s) => s.me);
  const refreshSpaces = useStore((s) => s.refreshSpaces);
  const refreshRooms = useStore((s) => s.refreshRooms);
  const leaveSpace = useStore((s) => s.leaveSpace);
  const notify = useStore((s) => s.notify);
  const space = spaces.find((s) => s.id === spaceId);
  const [confirmarSaida, setConfirmarSaida] = useState(false);

  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [channelName, setChannelName] = useState("");
  const [channelKind, setChannelKind] = useState<"TEXT" | "VOICE">("TEXT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Qual ação destrutiva está esperando confirmação. Só uma por vez. */
  const [confirmar, setConfirmar] = useState<
    { tipo: "remover" | "posse"; membro: SpaceMember } | { tipo: "convite" } | null
  >(null);

  async function carregarMembros() {
    try {
      const r = await api.get<{ members: SpaceMember[] }>(`/spaces/${spaceId}/members`);
      setMembers(r.members);
    } catch {
      setMembers([]);
    }
  }

  useEffect(() => {
    void carregarMembros();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  if (!space) return null;

  /*
   * O papel vem de duas fontes e as duas podem estar desatualizadas por um
   * instante: `space.role` é o que a listagem de espaços trouxe, e a linha da
   * própria pessoa na lista de membros é o que o servidor acabou de dizer. A
   * segunda ganha — é ela que muda quando alguém transfere a posse enquanto a
   * janela está aberta.
   */
  const meuPapel = ((members.find((m) => m.id === me?.id)?.role ?? space.role) ||
    "MEMBER") as SpaceRole;
  const souDono = meuPapel === "OWNER";
  const mando = souDono || meuPapel === "ADMIN";

  async function mudarPapel(membro: SpaceMember, papel: SpaceRole) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/spaces/${spaceId}/members/${encodeURIComponent(membro.id)}`, {
        role: papel
      });
      await carregarMembros();
      const quem = membro.displayName;
      // Frase inteira por caso: em português e espanhol "promovido a
      // administradora" concorda com a pessoa, e montar o papel por fora
      // obrigaria a tradução a escolher um gênero e errar o outro.
      notify(papel === "ADMIN" ? t`${quem} is now an admin.` : t`${quem} is now a member.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`That could not be changed.`);
    } finally {
      setBusy(false);
    }
  }

  async function remover(membro: SpaceMember) {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/spaces/${spaceId}/members/${encodeURIComponent(membro.id)}`);
      await carregarMembros();
      await Promise.all([refreshSpaces(), refreshRooms()]);
      const quem = membro.displayName;
      notify(t`${quem} was removed from the space.`);
      setConfirmar(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`They could not be removed.`);
    } finally {
      setBusy(false);
    }
  }

  async function transferirPosse(membro: SpaceMember) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/spaces/${spaceId}/owner`, { userId: membro.id });
      await carregarMembros();
      await refreshSpaces();
      const quem = membro.displayName;
      notify(t`${quem} owns this space now.`);
      setConfirmar(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`The ownership could not be transferred.`);
    } finally {
      setBusy(false);
    }
  }

  async function regenerarConvite() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/spaces/${spaceId}/invite/regenerate`);
      await refreshSpaces();
      notify(t`New invite code. The old one no longer works.`);
      setConfirmar(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`A new code could not be created.`);
    } finally {
      setBusy(false);
    }
  }

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

        {/*
          Trocar o código é destrutivo sem parecer: nada some da tela, mas todo
          link que já foi mandado para alguém morre em silêncio. Por isso a
          confirmação diz exatamente isso antes.
        */}
        {mando &&
          (confirmar?.tipo === "convite" ? (
            <div className="leave-confirm" style={{ marginTop: 12 }}>
              <p>
                <Trans>
                  Create a new code? Every link and code you have already shared stops working
                  right away, and anyone still holding one will be turned away. People who are
                  already in the space stay in.
                </Trans>
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" onClick={() => setConfirmar(null)}>
                  <Trans>Cancel</Trans>
                </button>
                <button
                  className="btn-outline danger"
                  disabled={busy}
                  onClick={() => void regenerarConvite()}
                >
                  {busy ? <Trans>One moment…</Trans> : <Trans>Yes, replace the code</Trans>}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn-link"
              style={{ marginTop: 10 }}
              onClick={() => setConfirmar({ tipo: "convite" })}
            >
              <Trans>Create a new invite code</Trans>
            </button>
          ))}

        <div style={{ height: 1, background: "var(--divider)", margin: "20px 0" }} />

        <p className="section-label" style={{ padding: 0, marginBottom: 8 }}>
          <Trans>Members</Trans> · {members.length}
        </p>

        {mando && (
          <p className="settings-note" style={{ marginBottom: 10 }}>
            <Trans>
              Removing someone takes them out of every channel here. What they wrote stays where
              it is — messages are not deleted with the person.
            </Trans>
          </p>
        )}

        {members.map((m) => {
          const ehEu = m.id === me?.id;
          /*
           * Ninguém mexe no dono, nem ele em si mesmo por aqui: rebaixar o
           * próprio dono deixaria o espaço sem quem possa promover alguém de
           * volta. A saída dele é transferir a posse, logo abaixo.
           */
          const podeMexer = mando && !ehEu && m.role !== "OWNER";
          return (
            <div key={m.id} className="member-row">
              <div className="row" style={{ height: 56, padding: 0 }}>
                <Avatar name={m.displayName} url={m.avatarUrl} size={38} />
                <div className="row-body">
                  <div className="row-name" style={{ fontSize: 15 }}>
                    {m.displayName}
                  </div>
                  <div className="row-preview">@{m.username}</div>
                </div>
                <span className={`role-tag role-${m.role.toLowerCase()}`}>
                  {rotuloDoPapel(m.role, i18n)}
                </span>
              </div>

              {podeMexer && (
                <div className="member-actions">
                  {m.role === "MEMBER" ? (
                    <button
                      className="btn-link"
                      disabled={busy}
                      onClick={() => void mudarPapel(m, "ADMIN")}
                    >
                      <Trans>Make admin</Trans>
                    </button>
                  ) : (
                    <button
                      className="btn-link"
                      disabled={busy}
                      onClick={() => void mudarPapel(m, "MEMBER")}
                    >
                      <Trans>Remove admin</Trans>
                    </button>
                  )}
                  {souDono && (
                    <button
                      className="btn-link"
                      disabled={busy}
                      onClick={() => setConfirmar({ tipo: "posse", membro: m })}
                    >
                      <Trans>Transfer ownership</Trans>
                    </button>
                  )}
                  <button
                    className="btn-link danger"
                    disabled={busy}
                    onClick={() => setConfirmar({ tipo: "remover", membro: m })}
                  >
                    <Trans>Remove</Trans>
                  </button>
                </div>
              )}

              {confirmar?.tipo === "remover" && confirmar.membro.id === m.id && (
                <div className="leave-confirm">
                  <p>
                    <Trans>
                      Remove <b>{m.displayName}</b> from this space? They lose every channel here
                      and can only come back with an invite code. Everything they wrote stays in
                      the conversations.
                    </Trans>
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn-ghost" onClick={() => setConfirmar(null)}>
                      <Trans>Cancel</Trans>
                    </button>
                    <button
                      className="btn-outline danger"
                      disabled={busy}
                      onClick={() => void remover(m)}
                    >
                      {busy ? <Trans>Removing…</Trans> : <Trans>Yes, remove them</Trans>}
                    </button>
                  </div>
                </div>
              )}

              {confirmar?.tipo === "posse" && confirmar.membro.id === m.id && (
                <div className="leave-confirm">
                  <p>
                    <Trans>
                      Hand this space to <b>{m.displayName}</b>? They become the owner and you
                      become an admin. Only they can hand it back.
                    </Trans>
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn-ghost" onClick={() => setConfirmar(null)}>
                      <Trans>Cancel</Trans>
                    </button>
                    <button
                      className="btn-outline danger"
                      disabled={busy}
                      onClick={() => void transferirPosse(m)}
                    >
                      {busy ? <Trans>One moment…</Trans> : <Trans>Yes, transfer it</Trans>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {!mando && (
          <p className="settings-note" style={{ marginTop: 10 }}>
            <Trans>Only an admin or the owner can change who is here.</Trans>
          </p>
        )}

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

/**
 * O grupo por dentro: nome, foto e quantas pessoas há nele.
 *
 * A foto de um grupo existia no banco e no tipo (`Room.iconUrl`) e já era
 * desenhada na lista de conversas, mas NÃO havia como pôr uma — um campo que só
 * o servidor conseguia preencher. Isto é a porta que faltava.
 */
export function GroupModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { t } = useLingui();
  const rooms = useStore((s) => s.rooms);
  const refreshRooms = useStore((s) => s.refreshRooms);
  const notify = useStore((s) => s.notify);
  const room = rooms.find((r) => r.id === roomId);

  const [nome, setNome] = useState(room?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!room) return null;

  /**
   * Troca a foto do grupo.
   *
   * Reduz para um quadrado de 256 px ANTES de subir, como a foto de perfil. O
   * `POST /files` é genérico e não redimensiona nada: sem isto, uma foto de
   * 4 MB tirada no celular seria baixada inteira em cada linha da lista de
   * conversas de todo mundo do grupo.
   */
  async function trocarFoto(file: File) {
    setEnviandoFoto(true);
    setErro(null);
    try {
      const pequena = await squareThumbnail(file);
      const enviado = await uploadFile(pequena);
      await api.patch<{ room: Room }>(`/rooms/${roomId}`, { iconUrl: enviado.url });
      await refreshRooms();
      notify(t`Group picture updated.`);
    } catch (err) {
      setErro(
        err instanceof ImageError
          ? err.message
          : err instanceof Error
            ? err.message
            : t`That picture could not be saved.`
      );
    } finally {
      setEnviandoFoto(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removerFoto() {
    setEnviandoFoto(true);
    setErro(null);
    try {
      await api.patch<{ room: Room }>(`/rooms/${roomId}`, { iconUrl: null });
      await refreshRooms();
      notify(t`Group picture removed.`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : t`That picture could not be removed.`);
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function salvarNome() {
    const limpo = nome.trim();
    if (!limpo || limpo === room?.name) return;
    setBusy(true);
    setErro(null);
    try {
      await api.patch<{ room: Room }>(`/rooms/${roomId}`, { name: limpo });
      await refreshRooms();
      notify(t`Group name saved.`);
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : t`That name could not be saved.`);
      setBusy(false);
    }
  }

  const nomeDoGrupo = room.name ?? t`Group`;
  const mudou = nome.trim().length > 0 && nome.trim() !== room.name;

  return (
    <Scrim onClose={onClose}>
      <header>{nomeDoGrupo}</header>
      <div className="modal-body">
        {erro && <div className="form-error">{erro}</div>}

        <div className="settings-id">
          <button
            className="avatar-edit"
            onClick={() => fileRef.current?.click()}
            disabled={enviandoFoto}
            title={t`Change the group picture`}
            aria-label={t`Change the group picture`}
          >
            <Avatar name={nomeDoGrupo} url={room.iconUrl} size={64} />
            <span className="avatar-edit-hint">{enviandoFoto ? t`Saving…` : t`Change`}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void trocarFoto(f);
            }}
          />
          <div>
            <strong>{nomeDoGrupo}</strong>
            <span>{plural(room.memberCount, { one: "# person", other: "# people" })}</span>
            {room.iconUrl && (
              <button
                className="btn-link"
                disabled={enviandoFoto}
                onClick={() => void removerFoto()}
              >
                <Trans>Remove the picture</Trans>
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="group-rename">
            <Trans>Group name</Trans>
          </label>
          <input
            id="group-rename"
            value={nome}
            maxLength={60}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void salvarNome()}
          />
        </div>

        <p className="settings-note">
          <Trans>Everyone in the group sees the name and the picture.</Trans>
        </p>
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>
          <Trans>Done</Trans>
        </button>
        <button className="btn-ghost" disabled={busy || !mudou} onClick={() => void salvarNome()}>
          {busy ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
        </button>
      </footer>
    </Scrim>
  );
}
