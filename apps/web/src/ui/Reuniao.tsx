import { useEffect, useMemo, useRef, useState } from "react";
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant
} from "livekit-client";
import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { useStore } from "../store";
import { Avatar } from "./Avatar";
import {
  IconChats,
  IconClose,
  IconCopy,
  IconCheck,
  IconHangup,
  IconMic,
  IconMicOff,
  IconScreen,
  IconSpaces,
  IconVideo,
  IconVideoOff
} from "./icons";
import { canShareScreen } from "../lib/screenshare";
import { lembrarNome, nomeLembrado } from "../lib/linkDeReuniao";
import {
  encerrarParaTodos,
  entrarNaReuniao,
  infoDaReuniao,
  removerPessoa,
  type Entrada,
  type InfoDaReuniao
} from "../lib/reuniao";

/**
 * Reunião por link, no jeito do Google Meet.
 *
 * Duas telas: a ESPERA, onde a pessoa se vê na câmera, escolhe se entra com a
 * conta ou só com o nome, e decide se chega com microfone e câmera ligados; e a
 * REUNIÃO em si. A espera existe pelo mesmo motivo que existe no Meet — ninguém
 * gosta de cair numa sala com a câmera ligada sem ter visto o próprio rosto.
 *
 * Esta tela funciona sem conta, e por isso não usa nada da tela de chamada das
 * conversas: aquela pergunta à API quem está na sala, assina eventos do socket
 * e abre o chat da sala — tudo coisa que exige conta. Aqui o LiveKit é a única
 * fonte: quem está, como se chama, se é convidado (vem no token) e até o
 * bate-papo, que passa pelo canal de dados dele.
 */
export function TelaDaReuniao() {
  const code = useStore((s) => s.reuniao);
  const fechar = useStore((s) => s.fecharReuniao);
  const [entrada, setEntrada] = useState<(Entrada & { mic: boolean; cam: boolean }) | null>(null);

  if (!code) return null;
  if (!entrada) {
    return <Espera code={code} onEntrar={setEntrada} onSair={fechar} />;
  }
  return (
    <NaReuniao
      entrada={entrada}
      onSair={fechar}
      onEntrarDeNovo={() => setEntrada(null)}
    />
  );
}

/* ================================================================ espera */

function Espera({
  code,
  onEntrar,
  onSair
}: {
  code: string;
  onEntrar: (e: Entrada & { mic: boolean; cam: boolean }) => void;
  onSair: () => void;
}) {
  const { t } = useLingui();
  const me = useStore((s) => s.me);
  const booting = useStore((s) => s.booting);
  const pedirConta = useStore((s) => s.pedirContaParaReuniao);

  const [info, setInfo] = useState<InfoDaReuniao | null>(null);
  const [erroInfo, setErroInfo] = useState<string | null>(null);
  const [nome, setNome] = useState(() => nomeLembrado());
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [semAcesso, setSemAcesso] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const previa = useRef<HTMLVideoElement>(null);
  const fluxo = useRef<MediaStream | null>(null);

  useEffect(() => {
    let vivo = true;
    infoDaReuniao(code)
      .then((i) => vivo && setInfo(i))
      .catch((e) => vivo && setErroInfo(e instanceof Error ? e.message : t`That meeting could not be opened.`));
    return () => {
      vivo = false;
    };
  }, [code, t]);

  /*
   * A prévia da câmera. Pede câmera e microfone de uma vez, porque é o pedido
   * de permissão que a pessoa vai ter de responder de qualquer jeito — melhor
   * aqui, com calma, do que no meio da reunião com todo mundo esperando.
   */
  useEffect(() => {
    let cancelado = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: true, audio: true })
      .then((s) => {
        if (cancelado) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        fluxo.current = s;
        if (previa.current) previa.current.srcObject = s;
      })
      .catch(() => {
        if (!cancelado) {
          setSemAcesso(true);
          setCam(false);
        }
      });
    return () => {
      cancelado = true;
      fluxo.current?.getTracks().forEach((tr) => tr.stop());
      fluxo.current = null;
    };
  }, []);

  // Ligar e desligar na prévia é ligar e desligar a faixa — sem pedir de novo.
  useEffect(() => {
    fluxo.current?.getVideoTracks().forEach((tr) => (tr.enabled = cam));
  }, [cam]);
  useEffect(() => {
    fluxo.current?.getAudioTracks().forEach((tr) => (tr.enabled = mic));
  }, [mic]);

  async function entrar() {
    setErro(null);
    const limpo = nome.trim();
    if (!me && !limpo) {
      setErro(t`Type your name to join.`);
      return;
    }
    setEntrando(true);
    try {
      const e = await entrarNaReuniao(code, me ? undefined : limpo);
      if (!me) lembrarNome(limpo);
      /*
       * Solta a câmera da prévia ANTES de entrar. Em vários aparelhos só um
       * dono por vez pode segurar a câmera, e a reunião vai pedir a mesma.
       */
      fluxo.current?.getTracks().forEach((tr) => tr.stop());
      fluxo.current = null;
      onEntrar({ ...e, mic, cam: cam && !semAcesso });
    } catch (err) {
      setErro(err instanceof Error ? err.message : t`That did not work. Try again.`);
      setEntrando(false);
    }
  }

  const titulo =
    info?.title || (info ? t`${info.host.displayName}'s meeting` : t`Meeting`);
  const fechada = info && !info.ativa;

  return (
    <div className="reuniao-espera">
      <div className="espera-camera">
        <div className="espera-video">
          <video ref={previa} autoPlay playsInline muted className={cam ? "" : "escondido"} />
          {!cam && (
            <div className="espera-sem-camera">
              {semAcesso ? (
                <Trans>The browser didn't allow the camera or microphone. You can still join.</Trans>
              ) : (
                <Trans>Camera is off</Trans>
              )}
            </div>
          )}
          <div className="espera-botoes">
            <button
              className={`call-btn${mic ? "" : " off"}`}
              onClick={() => setMic((v) => !v)}
              disabled={semAcesso}
              title={mic ? t`Turn off microphone` : t`Turn on microphone`}
              aria-label={mic ? t`Turn off microphone` : t`Turn on microphone`}
            >
              {mic ? <IconMic /> : <IconMicOff />}
            </button>
            <button
              className={`call-btn${cam ? "" : " off"}`}
              onClick={() => setCam((v) => !v)}
              disabled={semAcesso}
              title={cam ? t`Turn off camera` : t`Turn on camera`}
              aria-label={cam ? t`Turn off camera` : t`Turn on camera`}
            >
              {cam ? <IconVideo /> : <IconVideoOff />}
            </button>
          </div>
        </div>
      </div>

      <div className="espera-lado">
        {erroInfo ? (
          <>
            <h2>
              <Trans>We couldn't open this meeting</Trans>
            </h2>
            <p className="espera-dim">{erroInfo}</p>
            <button className="btn-ghost" onClick={onSair}>
              <Trans>Go back</Trans>
            </button>
          </>
        ) : !info ? (
          <p className="espera-dim">
            <Trans>Opening the meeting…</Trans>
          </p>
        ) : fechada ? (
          <>
            <h2>{titulo}</h2>
            <p className="espera-dim">
              <Trans>This meeting has ended.</Trans>
            </p>
            <button className="btn-ghost" onClick={onSair}>
              <Trans>Go back</Trans>
            </button>
          </>
        ) : (
          <>
            <h2>
              <Trans>Ready to join?</Trans>
            </h2>
            <p className="espera-titulo">{titulo}</p>
            <div className="espera-quem">
              <Avatar name={info.host.displayName} url={info.host.avatarUrl} size={22} />
              <span>
                <Trans>Created by {info.host.displayName}</Trans>
              </span>
            </div>
            <p className="espera-dim">
              {info.pessoas === 0
                ? t`Nobody is here yet.`
                : plural(info.pessoas, {
                    one: "# person is already here.",
                    other: "# people are already here."
                  })}
            </p>

            {erro && <div className="form-error">{erro}</div>}

            {booting ? (
              <p className="espera-dim">
                <Trans>One moment…</Trans>
              </p>
            ) : me ? (
              <>
                <button className="btn-primary" disabled={entrando} onClick={() => void entrar()}>
                  {entrando ? <Trans>Joining…</Trans> : <Trans>Join now</Trans>}
                </button>
                <p className="espera-nota">
                  <Trans>You're joining as {me.displayName}.</Trans>
                </p>
              </>
            ) : (
              /*
               * Sem conta é o caminho de cima, e não o de baixo: quem recebeu um
               * link quase sempre só quer entrar. A conta é a alternativa para
               * quem já tem uma — e entrar com ela é o que tira a etiqueta de
               * "convidado" do nome.
               */
              <>
                <div className="field">
                  <label htmlFor="reuniao-nome">
                    <Trans>Your name</Trans>
                  </label>
                  <input
                    id="reuniao-nome"
                    value={nome}
                    maxLength={40}
                    autoFocus
                    autoComplete="name"
                    onChange={(e) => setNome(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !entrando && void entrar()}
                  />
                </div>
                <button
                  className="btn-primary"
                  disabled={entrando || !nome.trim()}
                  onClick={() => void entrar()}
                >
                  {entrando ? <Trans>Joining…</Trans> : <Trans>Join without an account</Trans>}
                </button>
                <div className="espera-ou">
                  <span>
                    <Trans>or</Trans>
                  </span>
                </div>
                <button className="btn-outline" onClick={() => pedirConta(true)}>
                  <Trans>Sign in to join</Trans>
                </button>
                <p className="espera-nota">
                  <Trans>
                    Without an account you show up as a guest. Nothing is saved after you leave.
                  </Trans>
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================== reunião */

type Fim = "encerrada" | "removido" | "caiu" | "saiu";

type Mensagem = { id: string; nome: string; texto: string; minha: boolean; convidado: boolean };

/** O que o token disse sobre a pessoa: foto e se é convidado. */
function lerMetadata(p: Participant): { avatarUrl: string | null; convidado: boolean } {
  try {
    const m = JSON.parse(p.metadata || "{}");
    return {
      avatarUrl: typeof m.avatarUrl === "string" ? m.avatarUrl : null,
      convidado: m.convidado === true || p.identity.startsWith("g_")
    };
  } catch {
    // Metadata ilegível: a identidade decide. É ela que o servidor controla.
    return { avatarUrl: null, convidado: p.identity.startsWith("g_") };
  }
}

const MAX_MENSAGEM = 500;
const codificar = new TextEncoder();
const decodificar = new TextDecoder();

function NaReuniao({
  entrada,
  onSair,
  onEntrarDeNovo
}: {
  entrada: Entrada & { mic: boolean; cam: boolean };
  onSair: () => void;
  onEntrarDeNovo: () => void;
}) {
  const { t } = useLingui();
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [estado, setEstado] = useState<"ligando" | "dentro" | "falhou">("ligando");
  const [fim, setFim] = useState<Fim | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [revisao, setRevisao] = useState(0);
  const [painel, setPainel] = useState<"chat" | "pessoas" | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [somBloqueado, setSomBloqueado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [confirmarFim, setConfirmarFim] = useState(false);
  const bump = () => setRevisao((n) => n + 1);

  const painelRef = useRef(painel);
  painelRef.current = painel;
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const audios = useRef<HTMLDivElement>(null);

  // Primitivos, e não o objeto: o efeito que conecta não pode rodar de novo
  // porque o componente pai renderizou. Foi o que fez a tela de transmissão
  // desconectar sozinha.
  const endereco = entrada.url;
  const cracha = entrada.token;
  const micInicial = entrada.mic;
  const camInicial = entrada.cam;

  /* ------------------------------------------------------------- conexão */
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        room
          .on(RoomEvent.ParticipantConnected, bump)
          .on(RoomEvent.ParticipantDisconnected, bump)
          .on(RoomEvent.TrackSubscribed, bump)
          .on(RoomEvent.TrackUnsubscribed, bump)
          .on(RoomEvent.TrackMuted, bump)
          .on(RoomEvent.TrackUnmuted, bump)
          .on(RoomEvent.LocalTrackPublished, bump)
          .on(RoomEvent.LocalTrackUnpublished, bump)
          .on(RoomEvent.ActiveSpeakersChanged, bump)
          .on(RoomEvent.AudioPlaybackStatusChanged, () => setSomBloqueado(!room.canPlaybackAudio))
          .on(RoomEvent.DataReceived, (dados, participante, _tipo, topico) => {
            if (topico !== "chat" || !participante) return;
            try {
              const corpo = JSON.parse(decodificar.decode(dados));
              const texto = String(corpo.texto ?? "").slice(0, MAX_MENSAGEM).trim();
              if (!texto) return;
              /*
               * O NOME vem do participante, e não da mensagem. Quem manda a
               * mensagem escreve o texto; quem a pessoa é, o servidor disse no
               * token. Sem isso um convidado assinaria a mensagem com o nome de
               * qualquer um.
               */
              setMensagens((l) => [
                ...l.slice(-199),
                {
                  id: `${Date.now()}-${Math.random()}`,
                  nome: participante.name || participante.identity,
                  texto,
                  minha: false,
                  convidado: lerMetadata(participante).convidado
                }
              ]);
              if (painelRef.current !== "chat") setNaoLidas((n) => n + 1);
            } catch {
              /* mensagem ilegível: ignora */
            }
          })
          .on(RoomEvent.Disconnected, (motivo?: DisconnectReason) => {
            /*
             * Só é FIM se a pessoa chegou a estar dentro. Uma desconexão antes
             * disso é falha de conexão, e quem trata é o `catch` abaixo.
             */
            if (estadoRef.current !== "dentro") return;
            if (motivo === DisconnectReason.ROOM_DELETED) setFim("encerrada");
            else if (motivo === DisconnectReason.PARTICIPANT_REMOVED) setFim("removido");
            else if (motivo === DisconnectReason.CLIENT_INITIATED) setFim("saiu");
            else setFim("caiu");
          });

        await room.connect(endereco, cracha);
        if (cancelado) {
          void room.disconnect().catch(() => undefined);
          return;
        }
        setEstado("dentro");
        setSomBloqueado(!room.canPlaybackAudio);

        // Chega como a pessoa escolheu na espera. Falhar aqui não tira ninguém
        // da reunião: sem microfone, ela ainda vê e ouve.
        try {
          await room.localParticipant.setMicrophoneEnabled(micInicial);
        } catch {
          setErro(t`The microphone could not be turned on. You can still listen.`);
        }
        if (camInicial) {
          try {
            await room.localParticipant.setCameraEnabled(true);
          } catch {
            setErro(t`The camera could not be turned on.`);
          }
        }
        bump();
      } catch (e) {
        if (cancelado) return;
        setEstado("falhou");
        setErro(e instanceof Error ? e.message : t`The meeting could not be joined.`);
      }
    })();

    return () => {
      cancelado = true;
      room.removeAllListeners();
      void room.disconnect().catch(() => undefined);
    };
  }, [endereco, cracha, micInicial, camInicial, room, t]);

  /* ------------------------------------------------------- som dos outros */
  useEffect(() => {
    const caixa = audios.current;
    if (!caixa) return;
    const faixas: Track[] = [];
    room.remoteParticipants.forEach((p: RemoteParticipant) => {
      p.trackPublications.forEach((pub) => {
        if (pub.kind === Track.Kind.Audio && pub.track) faixas.push(pub.track);
      });
    });
    caixa.replaceChildren();
    for (const f of faixas) {
      const el = f.attach();
      el.autoplay = true;
      caixa.appendChild(el);
    }
    return () => {
      for (const f of faixas) f.detach();
    };
  }, [revisao, room]);

  /* ------------------------------------------------------------ quadros */
  const pessoas = useMemo(() => {
    const lista: Participant[] = [];
    if (estado === "dentro") lista.push(room.localParticipant);
    room.remoteParticipants.forEach((p) => lista.push(p));
    return lista;
    // `revisao` é o relógio: o LiveKit muda os objetos por dentro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, revisao, estado]);

  const telas = pessoas.filter((p) => p.getTrackPublication(Track.Source.ScreenShare)?.track);
  const anfitriaoId = entrada.reuniao.host.id;

  if (fim && fim !== "saiu") {
    return (
      <div className="reuniao-fim">
        <h2>
          {fim === "encerrada" ? (
            <Trans>The meeting has ended.</Trans>
          ) : fim === "removido" ? (
            <Trans>You were removed from the meeting.</Trans>
          ) : (
            <Trans>You lost connection to the meeting.</Trans>
          )}
        </h2>
        <div className="reuniao-fim-botoes">
          {fim === "caiu" && (
            <button className="btn-primary" onClick={onEntrarDeNovo}>
              <Trans>Rejoin</Trans>
            </button>
          )}
          <button className="btn-ghost" onClick={onSair}>
            <Trans>Leave</Trans>
          </button>
        </div>
      </div>
    );
  }

  const mic = room.localParticipant.isMicrophoneEnabled;
  const cam = room.localParticipant.isCameraEnabled;
  const tela = room.localParticipant.isScreenShareEnabled;

  async function alternar(o: "mic" | "cam" | "tela") {
    setErro(null);
    try {
      if (o === "mic") await room.localParticipant.setMicrophoneEnabled(!mic);
      if (o === "cam") await room.localParticipant.setCameraEnabled(!cam);
      if (o === "tela") {
        await room.localParticipant.setScreenShareEnabled(!tela, {
          audio: true,
          selfBrowserSurface: "exclude"
        });
      }
    } catch (e) {
      // Fechar o seletor de tela é um "não, obrigado", não um erro.
      if (e instanceof DOMException && e.name === "NotAllowedError") return;
      setErro(e instanceof Error ? e.message : t`That did not work. Try again.`);
    }
    bump();
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(entrada.reuniao.link);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1800);
    } catch {
      setErro(t`The link could not be copied.`);
    }
  }

  async function enviar(texto: string) {
    const limpo = texto.trim().slice(0, MAX_MENSAGEM);
    if (!limpo) return;
    await room.localParticipant.publishData(codificar.encode(JSON.stringify({ texto: limpo })), {
      reliable: true,
      topic: "chat"
    });
    setMensagens((l) => [
      ...l.slice(-199),
      { id: `${Date.now()}-eu`, nome: entrada.nome, texto: limpo, minha: true, convidado: entrada.convidado }
    ]);
  }

  async function sair() {
    await room.disconnect().catch(() => undefined);
    onSair();
  }

  async function encerrar() {
    try {
      await encerrarParaTodos(entrada.reuniao.code);
    } catch (e) {
      setErro(e instanceof Error ? e.message : t`That did not work. Try again.`);
      return;
    }
    onSair();
  }

  const titulo = entrada.reuniao.title || t`${entrada.reuniao.host.displayName}'s meeting`;

  return (
    <div className="reuniao">
      <header className="call-top">
        <div className="call-top-title">
          <strong>{titulo}</strong>
          <span>
            {estado === "ligando"
              ? t`Connecting…`
              : estado === "falhou"
                ? t`Could not connect`
                : plural(pessoas.length, { one: "# person", other: "# people" })}
          </span>
        </div>
        <button className="btn-ghost reuniao-copiar" onClick={() => void copiar()}>
          {copiado ? <IconCheck size={16} /> : <IconCopy size={16} />}
          {copiado ? <Trans>Copied</Trans> : <Trans>Copy link</Trans>}
        </button>
      </header>

      {somBloqueado && (
        <button
          className="call-banner"
          onClick={() => void room.startAudio().then(() => setSomBloqueado(!room.canPlaybackAudio))}
        >
          <Trans>The browser paused the sound. Click here to hear everyone.</Trans>
        </button>
      )}
      {erro && <div className="call-banner bad">{erro}</div>}

      <div className="call-body">
        {telas.length > 0 ? (
          <div className="call-stage focus">
            <div className="stage-main">
              {telas.map((p) => (
                <Quadro key={`${p.identity}-tela`} p={p} tela anfitriaoId={anfitriaoId} />
              ))}
            </div>
            <div className="stage-strip">
              {pessoas.map((p) => (
                <Quadro key={p.identity} p={p} anfitriaoId={anfitriaoId} />
              ))}
            </div>
          </div>
        ) : (
          <div className="call-stage">
            {pessoas.length <= 1 && estado === "dentro" && (
              <div className="reuniao-sozinho">
                <p>
                  <Trans>You're the only one here.</Trans>
                </p>
                <p className="dim">
                  <Trans>Send the link to whoever you want to call — they can join without an account.</Trans>
                </p>
                <button className="btn-outline" onClick={() => void copiar()}>
                  {copiado ? <Trans>Copied</Trans> : <Trans>Copy link</Trans>}
                </button>
              </div>
            )}
            {pessoas.map((p) => (
              <Quadro key={p.identity} p={p} anfitriaoId={anfitriaoId} />
            ))}
          </div>
        )}

        {painel === "chat" && (
          <BatePapo mensagens={mensagens} onEnviar={enviar} onFechar={() => setPainel(null)} />
        )}
        {painel === "pessoas" && (
          <aside className="reuniao-painel" aria-label={t`People`}>
            <header>
              <strong>
                <Trans>People</Trans> · {pessoas.length}
              </strong>
              <button className="icon-btn" onClick={() => setPainel(null)} aria-label={t`Close`}>
                <IconClose size={18} />
              </button>
            </header>
            <ul className="reuniao-pessoas">
              {pessoas.map((p) => {
                const meta = lerMetadata(p);
                const eu = p.identity === room.localParticipant.identity;
                return (
                  <li key={p.identity}>
                    <Avatar name={p.name || p.identity} url={meta.avatarUrl} size={32} />
                    <span className="reuniao-pessoa-nome">
                      {p.name || p.identity}
                      {eu && ` ${t`(you)`}`}
                      {p.identity === anfitriaoId && <em className="etiqueta">{t`host`}</em>}
                      {meta.convidado && <em className="etiqueta convidado">{t`guest`}</em>}
                    </span>
                    {!p.isMicrophoneEnabled && <IconMicOff size={15} />}
                    {entrada.souAnfitriao && !eu && (
                      <button
                        className="btn-link danger"
                        onClick={() =>
                          void removerPessoa(entrada.reuniao.code, p.identity).catch((e) =>
                            setErro(e instanceof Error ? e.message : t`That did not work. Try again.`)
                          )
                        }
                      >
                        <Trans>Remove</Trans>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>

      <div ref={audios} hidden />

      <div className="call-bar">
        <BotaoDaBarra
          rotulo={mic ? t`Mute` : t`Unmute`}
          desligado={!mic}
          onClick={() => void alternar("mic")}
          icone={mic ? <IconMic /> : <IconMicOff />}
          inativo={estado !== "dentro"}
        />
        <BotaoDaBarra
          rotulo={cam ? t`Stop video` : t`Start video`}
          desligado={!cam}
          onClick={() => void alternar("cam")}
          icone={cam ? <IconVideo /> : <IconVideoOff />}
          inativo={estado !== "dentro"}
        />
        {canShareScreen && (
          <BotaoDaBarra
            rotulo={tela ? t`Stop sharing` : t`Share screen`}
            ligado={tela}
            onClick={() => void alternar("tela")}
            icone={<IconScreen />}
            inativo={estado !== "dentro"}
          />
        )}
        <BotaoDaBarra
          rotulo={t`Chat`}
          ligado={painel === "chat"}
          onClick={() => {
            setPainel((v) => (v === "chat" ? null : "chat"));
            setNaoLidas(0);
          }}
          icone={<IconChats />}
          contador={naoLidas}
        />
        <BotaoDaBarra
          rotulo={t`People`}
          ligado={painel === "pessoas"}
          onClick={() => setPainel((v) => (v === "pessoas" ? null : "pessoas"))}
          icone={<IconSpaces />}
        />
        <BotaoDaBarra rotulo={t`Leave`} saida onClick={() => void sair()} icone={<IconHangup />} />
        {entrada.souAnfitriao &&
          (confirmarFim ? (
            <div className="reuniao-confirma">
              <span>
                <Trans>End for everyone?</Trans>
              </span>
              <button className="btn-outline danger" onClick={() => void encerrar()}>
                <Trans>Yes, end it</Trans>
              </button>
              <button className="btn-ghost" onClick={() => setConfirmarFim(false)}>
                <Trans>Cancel</Trans>
              </button>
            </div>
          ) : (
            <button className="btn-link danger reuniao-encerrar" onClick={() => setConfirmarFim(true)}>
              <Trans>End for everyone</Trans>
            </button>
          ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- pedaços */

function BotaoDaBarra({
  rotulo,
  icone,
  onClick,
  desligado,
  ligado,
  saida,
  inativo,
  contador
}: {
  rotulo: string;
  icone: React.ReactNode;
  onClick: () => void;
  desligado?: boolean;
  ligado?: boolean;
  saida?: boolean;
  inativo?: boolean;
  contador?: number;
}) {
  const cls = ["call-btn", desligado ? "off" : "", ligado ? "on" : "", saida ? "hangup" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button className="call-ctl" onClick={onClick} disabled={inativo} title={rotulo}>
      <span className={cls}>
        {icone}
        {contador ? <span className="reuniao-contador">{contador > 9 ? "9+" : contador}</span> : null}
      </span>
      <span className="call-ctl-label">{rotulo}</span>
    </button>
  );
}

function Quadro({ p, tela, anfitriaoId }: { p: Participant; tela?: boolean; anfitriaoId: string }) {
  const { t } = useLingui();
  const ref = useRef<HTMLVideoElement>(null);
  const pub = p.getTrackPublication(tela ? Track.Source.ScreenShare : Track.Source.Camera);
  const faixa = pub && !pub.isMuted ? pub.track : undefined;
  const meta = lerMetadata(p);
  const nome = p.name || p.identity;

  useEffect(() => {
    const el = ref.current;
    if (!el || !faixa) return;
    faixa.attach(el);
    return () => {
      faixa.detach(el);
    };
  }, [faixa]);

  return (
    <div className={`tile${tela ? " screen" : ""}${p.isSpeaking && !tela ? " speaking" : ""}`}>
      {faixa ? (
        <video ref={ref} autoPlay playsInline muted={p.isLocal} />
      ) : (
        <Avatar name={nome} url={meta.avatarUrl} size={84} className="tile-avatar" />
      )}
      <span className="tile-name">
        {!tela && !p.isMicrophoneEnabled && (
          <span className="tile-muted" title={t`Microphone off`}>
            <IconMicOff size={13} />
          </span>
        )}
        {nome}
        {p.isLocal && !tela ? ` ${t`(you)`}` : ""}
        {tela ? ` — ${t`screen`}` : ""}
        {!tela && p.identity === anfitriaoId && <em className="etiqueta">{t`host`}</em>}
        {/*
          A etiqueta de convidado é o que impede alguém sem conta de entrar como
          "Gustavo Henrique" e passar pelo Gustavo Henrique de verdade.
        */}
        {!tela && meta.convidado && <em className="etiqueta convidado">{t`guest`}</em>}
      </span>
    </div>
  );
}

function BatePapo({
  mensagens,
  onEnviar,
  onFechar
}: {
  mensagens: Mensagem[];
  onEnviar: (texto: string) => Promise<void>;
  onFechar: () => void;
}) {
  const { t } = useLingui();
  const [texto, setTexto] = useState("");
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [mensagens.length]);

  async function mandar() {
    const v = texto;
    if (!v.trim()) return;
    setTexto("");
    await onEnviar(v).catch(() => setTexto(v));
  }

  return (
    <aside className="reuniao-painel" aria-label={t`Chat`}>
      <header>
        <strong>
          <Trans>Chat</Trans>
        </strong>
        <button className="icon-btn" onClick={onFechar} aria-label={t`Close`}>
          <IconClose size={18} />
        </button>
      </header>
      <div className="reuniao-mensagens">
        {mensagens.length === 0 && (
          <p className="reuniao-dica">
            <Trans>Messages are seen only by people in the meeting, and they go away when it ends.</Trans>
          </p>
        )}
        {mensagens.map((m) => (
          <div key={m.id} className={`reuniao-msg${m.minha ? " minha" : ""}`}>
            <span className="reuniao-msg-nome">
              {m.minha ? t`You` : m.nome}
              {m.convidado && !m.minha && <em className="etiqueta convidado">{t`guest`}</em>}
            </span>
            <span className="reuniao-msg-texto">{m.texto}</span>
          </div>
        ))}
        <div ref={fim} />
      </div>
      <div className="reuniao-escrever">
        <input
          value={texto}
          maxLength={MAX_MENSAGEM}
          placeholder={t`Send a message`}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void mandar()}
        />
        <button className="btn-ghost" disabled={!texto.trim()} onClick={() => void mandar()}>
          <Trans>Send</Trans>
        </button>
      </div>
    </aside>
  );
}
