import { useEffect, useMemo, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { useLingui as useLinguiRuntime } from "@lingui/react";
import { api } from "../lib/api";
import { useStore, type User } from "../store";
import {
  agruparMembros,
  contarOnline,
  vozPorPessoa,
  type Grupo,
  type MembroAgrupado,
  type MembroCru,
  type PapelNoEspaco
} from "../lib/membros";
import { Avatar } from "./Avatar";
import { FotoAmpliada } from "./FotoAmpliada";
import { IconChats, IconPhone, IconVideo, IconVoiceRoom, IconClose } from "./icons";

/**
 * Quem está aqui — o painel à direita da conversa.
 *
 * É a lista de membros do Discord. Ela responde, nesta ordem: quem está numa
 * chamada agora (e em qual), quem administra, quem está online, quem não está.
 * Clicar em alguém abre o caminho curto: mensagem direta, ligar, ou entrar na
 * mesma chamada em que a pessoa já está.
 *
 * Só existe onde há "aqui" para mostrar — um canal de espaço ou um grupo. Numa
 * conversa direta a outra pessoa já está no cabeçalho, e um painel com um nome
 * só seria um painel vazio.
 */
export function PainelDeMembros() {
  const { t } = useLingui();
  const { i18n } = useLinguiRuntime();
  const me = useStore((s) => s.me);
  const rooms = useStore((s) => s.rooms);
  const spaces = useStore((s) => s.spaces);
  const activeRoomId = useStore((s) => s.activeRoomId);
  const membersOpen = useStore((s) => s.membersOpen);
  const online = useStore((s) => s.online);
  const voicePresence = useStore((s) => s.voicePresence);
  const seedOnline = useStore((s) => s.seedOnline);

  const room = rooms.find((r) => r.id === activeRoomId);
  const space = room?.space ? spaces.find((sp) => sp.id === room.space?.id) : undefined;
  const spaceId = space?.id ?? null;
  const ehGrupo = room?.kind === "GROUP";

  const [doEspaco, setDoEspaco] = useState<MembroCru[]>([]);

  /*
   * Os membros do espaço vêm da API; os do grupo já estão na sala. Recarrega
   * quando o espaço muda e quando alguém entra ou sai (o `memberCount` da lista
   * de espaços é o sinal mais barato disso).
   */
  const memberCount = space?.memberCount ?? 0;
  useEffect(() => {
    if (!spaceId) {
      setDoEspaco([]);
      return;
    }
    let vivo = true;
    api
      .get<{ members: (User & { role: PapelNoEspaco })[] }>(`/spaces/${spaceId}/members`)
      .then((r) => {
        if (vivo) setDoEspaco(r.members);
      })
      .catch(() => {
        if (vivo) setDoEspaco([]);
      });
    return () => {
      vivo = false;
    };
  }, [spaceId, memberCount]);

  const membros: MembroCru[] = useMemo(
    () => (spaceId ? doEspaco : ehGrupo ? (room?.members ?? []) : []),
    [spaceId, doEspaco, ehGrupo, room?.members]
  );

  /*
   * A leitura inicial de presença. Sem ela, quem já estava online quando o app
   * abriu fica invisível até reconectar — o conjunto `online` só enchia por
   * evento de socket. Dispara quando a lista de pessoas muda, não a cada render.
   */
  const idsDosMembros = useMemo(() => membros.map((m) => m.id).join(","), [membros]);
  useEffect(() => {
    if (!idsDosMembros) return;
    void seedOnline(idsDosMembros.split(","));
  }, [idsDosMembros, seedOnline]);

  /*
   * Onde cada um está falando. Num espaço, os canais de voz dele; num grupo, a
   * própria sala — um grupo pode hospedar uma chamada, e "em chamada" ali quer
   * dizer "nesta conversa".
   */
  const nomeDaSala = useMemo(() => {
    const m = new Map<string, string>();
    if (space) {
      for (const c of space.channels) {
        if (c.kind === "VOICE") m.set(c.id, c.name ?? t`Voice`);
      }
    } else if (room && ehGrupo) {
      m.set(room.id, t`this conversation`);
    }
    return m;
  }, [space, room, ehGrupo, t]);

  const grupos = useMemo(
    () => agruparMembros(membros, online, vozPorPessoa(voicePresence, nomeDaSala), me?.id ?? null),
    [membros, online, voicePresence, nomeDaSala, me?.id]
  );

  const [aberto, setAberto] = useState<string | null>(null);
  useEffect(() => setAberto(null), [activeRoomId]);

  if (!room || !membersOpen || (!spaceId && !ehGrupo)) return null;

  const onlineAgora = contarOnline(grupos);

  return (
    <aside className="members-panel" aria-label={t`Who is here`}>
      <header className="members-head">
        <strong>
          <Trans>Members</Trans>
        </strong>
        <span className="members-count">
          {onlineAgora}/{membros.length} <Trans>online</Trans>
        </span>
      </header>

      <div className="members-scroll">
        {grupos.map((g) => (
          <section key={g.grupo} className={`members-group ${g.grupo}`}>
            <h4>
              {i18n._(TITULOS[g.grupo])} — {g.membros.length}
            </h4>
            {g.membros.map((m) => (
              <LinhaDeMembro
                key={m.id}
                membro={m}
                aberto={aberto === m.id}
                onToggle={() => setAberto((v) => (v === m.id ? null : m.id))}
                onFechar={() => setAberto(null)}
              />
            ))}
          </section>
        ))}
        {membros.length === 0 && (
          <p className="members-empty">
            <Trans>Loading who is here…</Trans>
          </p>
        )}
      </div>
    </aside>
  );
}

/*
 * Os títulos como `msg`, traduzidos com o `i18n` do hook na hora de desenhar.
 *
 * A primeira versão passava o `t` do hook como PARÂMETRO para uma função com um
 * `switch` — e o título saiu vazio na tela. O macro só transforma o `t` que vem
 * direto do próprio `useLingui`; um `t` recebido por parâmetro é, para ele, uma
 * função qualquer, e o texto some em silêncio. Foi medido no navegador: o
 * cabeçalho do grupo dizia "— 1". É o mesmo defeito que já derrubou 18 frases
 * neste projeto, e `msg` + `i18n._` é a saída que já está em uso nos outros
 * lugares.
 */
const TITULOS: Record<Grupo, MessageDescriptor> = {
  chamada: msg`In a call`,
  administracao: msg`Admins`,
  online: msg`Online`,
  offline: msg`Offline`
};

function LinhaDeMembro({
  membro,
  aberto,
  onToggle,
  onFechar
}: {
  membro: MembroAgrupado;
  aberto: boolean;
  onToggle: () => void;
  onFechar: () => void;
}) {
  const { t } = useLingui();
  const refreshRooms = useStore((s) => s.refreshRooms);
  const openRoom = useStore((s) => s.openRoom);
  const startCall = useStore((s) => s.startCall);
  const notify = useStore((s) => s.notify);
  const [ocupado, setOcupado] = useState(false);
  const [fotoAberta, setFotoAberta] = useState(false);

  /**
   * A conversa direta com esta pessoa: encontra ou cria, e volta o id.
   *
   * É o mesmo `POST /rooms/dm` do "Nova conversa" — o servidor devolve a sala
   * que já existe quando existe, então não há risco de duplicar.
   */
  async function conversaDireta(): Promise<string | null> {
    setOcupado(true);
    try {
      const r = await api.post<{ room: { id: string } }>("/rooms/dm", { userId: membro.id });
      await refreshRooms();
      return r.room.id;
    } catch {
      notify(t`That conversation could not be opened.`, "bad");
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function mensagem() {
    const id = await conversaDireta();
    if (!id) return;
    onFechar();
    await openRoom(id);
  }

  async function ligar(video: boolean) {
    const id = await conversaDireta();
    if (!id) return;
    onFechar();
    await openRoom(id);
    startCall(id, video);
  }

  function entrarNaMesmaChamada() {
    if (!membro.canalDeVoz) return;
    onFechar();
    startCall(membro.canalDeVoz.salaId, false);
  }

  const papel =
    membro.role === "OWNER" ? t`Owner` : membro.role === "ADMIN" ? t`Admin` : null;

  return (
    <div className={`member-slot${aberto ? " aberto" : ""}`}>
      <button
        className={`member-line${membro.online ? "" : " offline"}`}
        onClick={onToggle}
        aria-expanded={aberto}
        aria-label={membro.displayName}
      >
        <Avatar
          name={membro.displayName}
          url={membro.avatarUrl}
          size={34}
          className="avatar member-avatar"
          online={membro.online}
        />
        <span className="member-text">
          <span className="member-name">
            {membro.displayName}
            {membro.souEu && <em> {t`(you)`}</em>}
          </span>
          {membro.canalDeVoz ? (
            <span className="member-sub voz">
              <IconVoiceRoom size={12} /> {membro.canalDeVoz.nome}
            </span>
          ) : papel ? (
            <span className="member-sub">{papel}</span>
          ) : null}
        </span>
      </button>

      {/*
        As ações moram num balão que abre embaixo da linha, e não em botões
        sempre visíveis: com trinta pessoas, trinta trios de botões viram uma
        parede. Quem quer falar com alguém clica na pessoa — é o gesto que todo
        mundo já tenta primeiro.
      */}
      {aberto && !membro.souEu && (
        <>
          <button className="member-scrim" aria-label={t`Close`} onClick={onFechar} />
          <div className="member-pop" role="menu">
            <p className="member-pop-head">
              <strong>{membro.displayName}</strong>
              <span>@{membro.username}</span>
            </p>
            {membro.avatarUrl && (
              <button
                onClick={() => {
                  onFechar();
                  setFotoAberta(true);
                }}
              >
                <Avatar name={membro.displayName} url={membro.avatarUrl} size={17} className="avatar member-pop-foto" />{" "}
                <Trans>View photo</Trans>
              </button>
            )}
            <button disabled={ocupado} onClick={() => void mensagem()}>
              <IconChats size={17} /> <Trans>Message</Trans>
            </button>
            <button disabled={ocupado} onClick={() => void ligar(false)}>
              <IconPhone size={17} /> <Trans>Call</Trans>
            </button>
            <button disabled={ocupado} onClick={() => void ligar(true)}>
              <IconVideo size={17} /> <Trans>Video call</Trans>
            </button>
            {membro.canalDeVoz && (
              <button onClick={entrarNaMesmaChamada}>
                <IconVoiceRoom size={17} />{" "}
                <Trans>Join them in {membro.canalDeVoz.nome}</Trans>
              </button>
            )}
          </div>
        </>
      )}
      {aberto && membro.souEu && (
        <>
          <button className="member-scrim" aria-label={t`Close`} onClick={onFechar} />
          <div className="member-pop" role="note">
            <p className="member-pop-head">
              <strong>{membro.displayName}</strong>
              <span>@{membro.username}</span>
            </p>
            <p className="member-pop-nota">
              <Trans>This is you.</Trans>
            </p>
            {membro.avatarUrl && (
              <button
                onClick={() => {
                  onFechar();
                  setFotoAberta(true);
                }}
              >
                <Avatar name={membro.displayName} url={membro.avatarUrl} size={17} className="avatar member-pop-foto" />{" "}
                <Trans>View photo</Trans>
              </button>
            )}
            <button onClick={onFechar}>
              <IconClose size={17} /> <Trans>Close</Trans>
            </button>
          </div>
        </>
      )}
      {fotoAberta && membro.avatarUrl && (
        <FotoAmpliada url={membro.avatarUrl} nome={membro.displayName} onClose={() => setFotoAberta(false)} />
      )}
    </div>
  );
}
