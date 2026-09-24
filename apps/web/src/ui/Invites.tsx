import { useEffect, useRef, useState, type CSSProperties } from "react";
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

/** O mesmo campo de texto que este painel já usava, escrito uma vez só. */
const CAMPO: CSSProperties = {
  flex: 1,
  background: "var(--input)",
  border: "1px solid transparent",
  borderRadius: 8,
  padding: "10px 12px",
  outline: "none"
};

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
/** As seções da janela do espaço. `convite` é por onde o botão de convidar entra. */
export type SecaoDoEspaco = "geral" | "convite" | "membros" | "canais";

export function SpaceModal({
  spaceId,
  onClose,
  inicial = "geral"
}: {
  spaceId: string;
  onClose: () => void;
  inicial?: SecaoDoEspaco;
}) {
  const { t, i18n } = useLingui();
  const spaces = useStore((s) => s.spaces);
  const me = useStore((s) => s.me);
  const refreshSpaces = useStore((s) => s.refreshSpaces);
  const refreshRooms = useStore((s) => s.refreshRooms);
  const leaveSpace = useStore((s) => s.leaveSpace);
  const deleteSpace = useStore((s) => s.deleteSpace);
  const deleteChannel = useStore((s) => s.deleteChannel);
  const notify = useStore((s) => s.notify);
  const space = spaces.find((s) => s.id === spaceId);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  /*
   * `null` quer dizer "a lista" no celular, onde as duas colunas não cabem
   * juntas — o mesmo contrato das configurações da conta. Quem entrou pelo botão
   * de convidar já cai direto no convite: foi para isso que clicou.
   */
  const [secao, setSecao] = useState<SecaoDoEspaco | null>(inicial === "geral" ? null : inicial);

  const [nome, setNome] = useState(space?.name ?? "");
  const [enviandoIcone, setEnviandoIcone] = useState(false);
  /** O canal que está sendo renomeado agora, e o texto em edição. */
  const [renomeando, setRenomeando] = useState<{ id: string; nome: string } | null>(null);
  const iconeRef = useRef<HTMLInputElement>(null);

  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [channelName, setChannelName] = useState("");
  const [channelKind, setChannelKind] = useState<"TEXT" | "VOICE">("TEXT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Qual ação destrutiva está esperando confirmação. Só uma por vez. */
  const [confirmar, setConfirmar] = useState<
    | { tipo: "remover" | "posse"; membro: SpaceMember }
    | { tipo: "convite" }
    | { tipo: "canal"; canalId: string }
    | { tipo: "espaco" }
    | null
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

  /*
   * O número de gente entra por `plural`, e não solto no meio da frase. Com
   * uma pessoa só, a tela dizia "para as 1 pessoas que estão aqui" — foi o que
   * apareceu no teste. Português e espanhol mudam a palavra, e o inglês também;
   * concatenar o número obriga a tradução a escolher uma forma e errar a outra.
   */
  const quantasPessoas = plural(space.memberCount, { one: "# person", other: "# people" });

  /*
   * Todo mundo vê as quatro: membro comum também quer o link de convite, a
   * lista de quem está aqui e os canais. O que muda com o papel é o que dá para
   * MEXER dentro de cada uma, e isso cada seção já decide com `mando`.
   */
  const secoes: { id: SecaoDoEspaco; titulo: string }[] = [
    { id: "geral", titulo: t`Overview` },
    { id: "convite", titulo: t`Invite` },
    { id: "membros", titulo: t`Members` },
    { id: "canais", titulo: t`Channels` }
  ];
  const atual: SecaoDoEspaco = secao ?? "geral";

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

  /**
   * Troca a imagem do espaço.
   *
   * Reduz para um quadrado de 640 px ANTES de subir, como a foto de perfil e a
   * do grupo. O `POST /files` é genérico e não redimensiona nada: sem isto, uma
   * foto de 4 MB tirada no celular seria baixada inteira toda vez que alguém
   * abrisse o app, porque o ícone do espaço fica na barra lateral de todo mundo.
   */
  async function trocarIcone(file: File) {
    setEnviandoIcone(true);
    setError(null);
    try {
      const pequena = await squareThumbnail(file);
      const enviado = await uploadFile(pequena);
      await api.patch(`/spaces/${spaceId}`, { iconUrl: enviado.url });
      await refreshSpaces();
      notify(t`Space picture updated.`);
    } catch (err) {
      setError(
        err instanceof ImageError
          ? err.message
          : err instanceof Error
            ? err.message
            : t`That picture could not be saved.`
      );
    } finally {
      setEnviandoIcone(false);
      if (iconeRef.current) iconeRef.current.value = "";
    }
  }

  async function removerIcone() {
    setEnviandoIcone(true);
    setError(null);
    try {
      await api.patch(`/spaces/${spaceId}`, { iconUrl: null });
      await refreshSpaces();
      notify(t`Space picture removed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`That picture could not be removed.`);
    } finally {
      setEnviandoIcone(false);
    }
  }

  async function salvarNome() {
    const limpo = nome.trim();
    if (!limpo || limpo === space?.name) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/spaces/${spaceId}`, { name: limpo });
      await refreshSpaces();
      notify(t`Space name saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`That name could not be saved.`);
    } finally {
      setBusy(false);
    }
  }

  async function salvarCanal(canalId: string) {
    const limpo = renomeando?.nome.trim() ?? "";
    if (!limpo) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/spaces/${spaceId}/channels/${encodeURIComponent(canalId)}`, {
        name: limpo
      });
      setRenomeando(null);
      await Promise.all([refreshSpaces(), refreshRooms()]);
      notify(t`Channel renamed to ${limpo}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`That channel could not be renamed.`);
    } finally {
      setBusy(false);
    }
  }

  async function apagarCanal(canalId: string, nomeDoCanal: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteChannel(spaceId, canalId);
      notify(t`${nomeDoCanal} was deleted.`);
      setConfirmar(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`That channel could not be deleted.`);
    } finally {
      setBusy(false);
    }
  }

  async function apagarEspaco() {
    setBusy(true);
    setError(null);
    try {
      const comoSeChamava = space?.name ?? "";
      await deleteSpace(spaceId);
      notify(t`${comoSeChamava} was deleted.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`That space could not be deleted.`);
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
    <Scrim onClose={onClose} className="modal-wide">
      <div className="settings-shell" data-view={secao ? "detalhe" : "lista"}>
        <nav className="settings-nav" aria-label={t`Space settings`}>
          <div className="settings-list-head">
            <h3>{space.name}</h3>
            <button className="settings-close" onClick={onClose} aria-label={t`Close`}>
              <IconClose size={20} />
            </button>
          </div>
          <div>
            <h4>{space.name}</h4>
            {secoes.map((sc) => (
              <button
                key={sc.id}
                className={`settings-tab${sc.id === atual ? " on" : ""}`}
                aria-current={sc.id === atual ? "page" : undefined}
                onClick={() => {
                  setSecao(sc.id);
                  setConfirmar(null);
                  setRenomeando(null);
                  setError(null);
                }}
              >
                <IconeDaSecao nome={sc.id} />
                {sc.titulo}
              </button>
            ))}
          </div>
        </nav>

        <section className="settings-panel">
          <header className="settings-panel-head">
            <button className="settings-back" onClick={() => setSecao(null)} aria-label={t`Back`}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path fill="currentColor" d="M15.7 4.3 8 12l7.7 7.7 1.4-1.4L10.8 12l6.3-6.3z" />
              </svg>
            </button>
            <h3>{secoes.find((sc) => sc.id === atual)?.titulo}</h3>
            <button className="settings-close" onClick={onClose} aria-label={t`Close`}>
              <IconClose size={20} />
            </button>
          </header>

          <div className="settings-panel-body">
            {error && <div className="form-error">{error}</div>}

            {atual === "geral" && (
              <>
                <div className="settings-id">
                  {mando ? (
                    <button
                      className="avatar-edit"
                      onClick={() => iconeRef.current?.click()}
                      disabled={enviandoIcone}
                      title={t`Change the space picture`}
                      aria-label={t`Change the space picture`}
                    >
                      <Avatar name={space.name} url={space.iconUrl} size={64} />
                      <span className="avatar-edit-hint">{enviandoIcone ? t`Saving…` : t`Change`}</span>
                    </button>
                  ) : (
                    <Avatar name={space.name} url={space.iconUrl} size={64} />
                  )}
                  <input
                    ref={iconeRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void trocarIcone(f);
                    }}
                  />
                  <div>
                    <strong>{space.name}</strong>
                    <span>{plural(space.memberCount, { one: "# person", other: "# people" })}</span>
                    {mando && space.iconUrl && (
                      <button
                        className="btn-link"
                        disabled={enviandoIcone}
                        onClick={() => void removerIcone()}
                      >
                        <Trans>Remove the picture</Trans>
                      </button>
                    )}
                  </div>
                </div>

                {mando && (
                  <div className="field">
                    <label htmlFor="space-rename">
                      <Trans>Space name</Trans>
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        id="space-rename"
                        value={nome}
                        maxLength={60}
                        onChange={(e) => setNome(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void salvarNome()}
                        style={CAMPO}
                      />
                      <button
                        className="btn-ghost"
                        disabled={busy || !nome.trim() || nome.trim() === space.name}
                        onClick={() => void salvarNome()}
                      >
                        <Trans>Save</Trans>
                      </button>
                    </div>
                  </div>
                )}


                <div className="settings-rule" />
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
                        <Trans>Cancel</Trans>
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

                {/*
                  Apagar o espaço fica DEPOIS de sair, e só para o dono. A ordem é de
                  propósito: quem quer só se ver livre do espaço encontra "sair"
                  primeiro, que é o que quase todo mundo quer. Apagar é o fim de tudo
                  para catorze pessoas, não uma saída pessoal.
                */}
                {souDono &&
                  (confirmar?.tipo === "espaco" ? (
                    <div className="leave-confirm" style={{ marginTop: 12 }}>
                      <p>
                        <Trans>
                          Delete <b>{space.name}</b> for everyone in it — {quantasPessoas}? Every
                          channel, every message, every picture and every file in this space goes with
                          it. There is no way back, and no copy is kept.
                        </Trans>
                      </p>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn-ghost" onClick={() => setConfirmar(null)}>
                          <Trans>Cancel</Trans>
                        </button>
                        <button
                          className="btn-outline danger"
                          disabled={busy}
                          onClick={() => void apagarEspaco()}
                        >
                          {busy ? <Trans>Deleting…</Trans> : <Trans>Yes, delete the space</Trans>}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="btn-link danger"
                      style={{ marginTop: 14 }}
                      onClick={() => {
                        setRenomeando(null);
                        setConfirmar({ tipo: "espaco" });
                      }}
                    >
                      <Trans>Delete this space</Trans>
                    </button>
                  ))}

              </>
            )}

            {atual === "convite" && (
              <>
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


              </>
            )}

            {atual === "membros" && (
              <>
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


              </>
            )}

            {atual === "canais" && (
              <>
                <p className="section-label" style={{ padding: 0, marginBottom: 8 }}>
                  <Trans>Channels</Trans> · {space.channels.length}
                </p>

                {space.channels.map((c) => {
                  const nomeDoCanal = c.name ?? t`Channel`;
                  const editando = renomeando?.id === c.id;
                  return (
                    <div key={c.id} className="member-row">
                      {editando ? (
                        <div style={{ display: "flex", gap: 8, padding: "8px 0" }}>
                          <input
                            autoFocus
                            value={renomeando.nome}
                            maxLength={60}
                            onChange={(e) => setRenomeando({ id: c.id, nome: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void salvarCanal(c.id);
                              if (e.key === "Escape") setRenomeando(null);
                            }}
                            style={CAMPO}
                          />
                          <button
                            className="btn-ghost"
                            disabled={busy || !renomeando.nome.trim()}
                            onClick={() => void salvarCanal(c.id)}
                          >
                            <Trans>Save</Trans>
                          </button>
                          <button className="btn-ghost" onClick={() => setRenomeando(null)}>
                            <Trans>Cancel</Trans>
                          </button>
                        </div>
                      ) : (
                        <div className="row" style={{ height: 46, padding: 0, gap: 10 }}>
                          {/*
                            O mesmo sinal que a barra lateral usa para separar os dois
                            tipos. Aqui ele importa mais do que lá: a lista está fora de
                            contexto, e sem ele um canal de voz e um de texto com nomes
                            parecidos viram a mesma linha na hora de apagar.
                          */}
                          <span style={{ color: "var(--text-faint)", width: 14, textAlign: "center" }}>
                            {c.kind === "VOICE" ? "♪" : "#"}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }} className="row-name">
                            {nomeDoCanal}
                          </div>
                          {mando && (
                            <div className="member-actions" style={{ margin: 0 }}>
                              <button
                                className="btn-link"
                                disabled={busy}
                                onClick={() => {
                                  setConfirmar(null);
                                  setRenomeando({ id: c.id, nome: nomeDoCanal });
                                }}
                              >
                                <Trans>Rename</Trans>
                              </button>
                              <button
                                className="btn-link danger"
                                disabled={busy}
                                onClick={() => {
                                  setRenomeando(null);
                                  setConfirmar({ tipo: "canal", canalId: c.id });
                                }}
                              >
                                <Trans>Delete</Trans>
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/*
                        O aviso diz o que some, e não "tem certeza?". Apagar um canal
                        leva junto tudo o que foi escrito nele, para todo mundo — é a
                        regra oposta à de expulsar alguém, onde as mensagens ficam.
                      */}
                      {confirmar?.tipo === "canal" && confirmar.canalId === c.id && (
                        <div className="leave-confirm">
                          <p>
                            <Trans>
                              Delete <b>{nomeDoCanal}</b>? Everything written there goes with it —
                              messages, pictures and files — for everyone in the space. There is no way
                              back.
                            </Trans>
                          </p>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button className="btn-ghost" onClick={() => setConfirmar(null)}>
                              <Trans>Cancel</Trans>
                            </button>
                            <button
                              className="btn-outline danger"
                              disabled={busy}
                              onClick={() => void apagarCanal(c.id, nomeDoCanal)}
                            >
                              {busy ? <Trans>Deleting…</Trans> : <Trans>Yes, delete it</Trans>}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}


                {/* Criar canal é coisa de quem administra; a API recusa os outros. */}
                {mando && (
                  <>
                    <div className="settings-rule" />
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
                        style={CAMPO}
                      />
                      <button className="btn-ghost" disabled={busy || !channelName.trim()} onClick={addChannel}>
                        <Trans>Add</Trans>
                      </button>
                    </div>

                  </>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </Scrim>
  );
}

/** Um desenho por seção, no mesmo traço das configurações da conta. */
function IconeDaSecao({ nome }: { nome: SecaoDoEspaco }) {
  const caminhos: Record<SecaoDoEspaco, string> = {
    geral:
      "M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.7 7.7 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.7 7.7 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.7 7.7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.7 7.7 0 0 0 1.7-1l2.5 1 2-3.5L19.4 13ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z",
    convite:
      "M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-7 1.7-7 4.5V20h14v-1.5c0-2.8-3.7-4.5-7-4.5Zm9-5V6h-2v3h-3v2h3v3h2v-3h3V9h-3Z",
    membros:
      "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM9 13c-3 0-7 1.5-7 4.5V20h14v-2.5C16 14.5 12 13 9 13Zm7 0c-.4 0-.8 0-1.2.1 1.3.9 2.2 2.2 2.2 4.4V20h5v-2.5c0-3-4-4.5-6-4.5Z",
    canais:
      "M10 3 9.3 8H5v2h4l-.6 4H4v2h4.1L7.4 21h2l.7-5h4l-.7 5h2l.7-5H20v-2h-3.9l.6-4H21V8h-4l.7-5h-2l-.7 5h-4L11 3h-1Zm.3 7h4l-.6 4h-4l.6-4Z"
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d={caminhos[nome]} />
    </svg>
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
   * Reduz para um quadrado de 640 px ANTES de subir, como a foto de perfil. O
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
