import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ConnectionQuality,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication
} from "livekit-client";
import { api } from "../lib/api";
import { useStore, type User } from "../store";
import { getSocket } from "../lib/socket";
import {
  cameraParaFacing,
  deveUsarFacingMode,
  loadDevicePrefs,
  proximoFacingMode,
  trocouDeCamera,
  useDevices,
  type FacingMode
} from "../lib/devices";
import { playCue } from "../lib/sounds";
import {
  bandejaSilenciada,
  empacotarSom,
  lerRecadoDeSom,
  tocarSom,
  type SomId
} from "../lib/soundboard";
import {
  chaveDeAudio,
  rotuloDeVolume,
  salvarVolume,
  volumeDe,
  VOLUME_MAX
} from "../lib/volumeDaChamada";
import {
  chamadaExpandida,
  ladoDoRoster,
  rosterAberto,
  salvarChamadaExpandida,
  salvarLadoDoRoster,
  salvarRosterAberto,
  type LadoDoRoster
} from "../lib/layoutChamada";
import {
  canShareScreen,
  captureOptions,
  loadQualidade,
  publishOptions,
  resumo,
  saveQualidade,
  type Qualidade
} from "../lib/screenshare";
import { Avatar } from "./Avatar";
import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { DevicePicker } from "./DevicePicker";
import { QuickDeviceMenu } from "./QuickDeviceMenu";
import { QualidadeDeTela } from "./ShareQuality";
import { CallChat } from "./CallChat";
import { Soundboard } from "./Soundboard";
import {
  IconMic, IconMicOff, IconVideo, IconVideoOff, IconScreen, IconChats,
  IconHangup, IconMinimize, IconSignal, IconSpeaker, IconSettings, IconClose,
  IconExpandir, IconRecolher, IconChevronDown as IconSeta, IconBandeja,
  IconTelaCheia, IconSairTelaCheia, IconVolume, IconVolumeMudo,
  IconChevronDown
} from "./icons";

type Tile = {
  key: string;
  participantId: string;
  name: string;
  avatarUrl: string | null;
  track: Track | null;
  isScreen: boolean;
  isLocal: boolean;
  muted: boolean;
  speaking: boolean;
  quality: ConnectionQuality;
};

export function CallSheet({
  roomId,
  withVideo,
  onClose
}: {
  roomId: string;
  withVideo: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const me = useStore((s) => s.me);
  const rooms = useStore((s) => s.rooms);
  const roomMeta = rooms.find((r) => r.id === roomId);
  const callName = roomMeta?.name ?? roomMeta?.counterpart?.displayName ?? t`Call`;

  /*
   * The room opens on the devices this machine already chose. Passing them as
   * capture defaults matters beyond the first join: every later
   * setMicrophoneEnabled / setCameraEnabled reuses them, so muting and
   * unmuting cannot quietly drop back to the built-in microphone.
   */
  const [room] = useState(() => {
    const saved = loadDevicePrefs();
    return new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: saved.audioinput ? { deviceId: saved.audioinput } : undefined,
      videoCaptureDefaults: saved.videoinput ? { deviceId: saved.videoinput } : undefined,
      audioOutput: saved.audiooutput ? { deviceId: saved.audiooutput } : undefined
    });
  });
  const [status, setStatus] = useState<"connecting" | "connected" | "reconnecting" | "failed">(
    "connecting"
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(withVideo);
  const [sharing, setSharing] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  /*
   * Bloqueio dos NOSSOS elementos de audio, que e coisa diferente do
   * `audioBlocked` acima.
   *
   * `room.canPlaybackAudio` so enxerga o que o LiveKit mesmo criou. Os <audio>
   * daqui sao nossos, e um `play()` recusado neles nao mexe naquele sinalizador
   * — o som simplesmente nao sai e nada na tela diz por que. E o caminho mais
   * provavel para "o audio da transmissao nao funciona" com a voz funcionando:
   * o elemento da voz nasce no clique que entrou na chamada, e o do som da tela
   * nasce depois, longe de qualquer gesto, que e exatamente o caso que a
   * politica de autoplay recusa.
   */
  const [saidaBloqueada, setSaidaBloqueada] = useState(false);
  /** Muda para pedir a todos os elementos que tentem tocar de novo. */
  const [retomar, setRetomar] = useState(0);
  const [speakers, setSpeakers] = useState<Set<string>>(new Set());
  /** Everyone who belongs to this conversation, in or out of the call. */
  const [roster, setRoster] = useState<User[]>([]);

  const [showDevices, setShowDevices] = useState(false);
  /** Qual menu curto está aberto (a seta ao lado do microfone ou da câmera). */
  const [quick, setQuick] = useState<null | "audioinput" | "videoinput">(null);
  /** Short-lived "X joined" lines, the visual half of the arrival cue. */
  const [events, setEvents] = useState<{ id: number; text: string }[]>([]);
  const [outputId, setOutputId] = useState<string | undefined>(() => loadDevicePrefs().audiooutput);
  const [qualidade, setQualidade] = useState<Qualidade>(() => loadQualidade());
  /* O menu rapido do botao de compartilhar, e o painel de conversa. */
  const [menuTela, setMenuTela] = useState(false);
  const [chatAberto, setChatAberto] = useState(false);
  /** A bandeja de sons, aberta pelo botao da barra. */
  const [bandeja, setBandeja] = useState(false);
  /*
   * O volume de cada fonte, por participante.
   *
   * Fica em estado E no armazenamento: o estado e o que faz a barra andar
   * enquanto se arrasta, e o armazenamento e o que faz a escolha sobreviver a
   * proxima chamada. Ler direto do armazenamento a cada render daria uma barra
   * travada, porque `localStorage` nao avisa ninguem quando muda.
   */
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [expandida, setExpandida] = useState(() => chamadaExpandida());
  const [lado, setLado] = useState<LadoDoRoster>(() => ladoDoRoster());
  const [listaAberta, setListaAberta] = useState(() => rosterAberto());

  /*
   * Uma chamada abre pela câmera frontal — é a de quem fala. Guardamos o lado em
   * estado, e não perguntamos à track a cada render, porque `getSettings()` só
   * responde `facingMode` em parte das plataformas: nas outras a resposta seria
   * `undefined` e o botão perderia a noção de para que lado virar.
   */
  const [facing, setFacing] = useState<FacingMode>("user");
  const { rawCameras } = useDevices();
  const podeVirarCamera = deveUsarFacingMode(rawCameras);

  const [revision, setRevision] = useState(0);
  const bump = () => setRevision((n) => n + 1);

  /*
   * Sair com som.
   *
   * Tem que tocar ANTES de `onClose`: quem fecha desmonta este componente, e um
   * som disparado depois nunca chega a sair. Por isso a saída passa por aqui em
   * vez de chamar `onClose` direto nos botões.
   */
  const sair = useCallback(() => {
    void playCue("leave", outputRef.current, false, roomId);
    onClose();
  }, [onClose]);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  /*
   * Arrivals and departures fire from a listener registered once, which cannot
   * see later renders. These refs are how it still gets today's roster — and
   * today's chosen speaker — without re-registering and tearing down the call.
   */
  const rosterRef = useRef<User[]>([]);
  const meRef = useRef(me);
  const outputRef = useRef(outputId);
  rosterRef.current = roster;
  meRef.current = me;
  outputRef.current = outputId;

  const nameFor = useCallback((identity: string, fallback?: string) => {
    if (identity === meRef.current?.id) return meRef.current.displayName;
    return rosterRef.current.find((u) => u.id === identity)?.displayName ?? fallback ?? t`Someone`;
  }, []);

  const pushEvent = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setEvents((list) => [...list.slice(-2), { id, text }]);
    window.setTimeout(() => setEvents((list) => list.filter((e) => e.id !== id)), 4500);
  }, []);

  // The roster is what answers "who is here and who is not".
  useEffect(() => {
    api
      .get<{ room: { members: User[] } }>(`/rooms/${roomId}`)
      .then((r) => setRoster(r.room.members))
      .catch(() => setRoster([]));
  }, [roomId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await api.post<{ url: string; token: string }>(`/rooms/${roomId}/call/token`);
        if (cancelled) return;

        room
          .on(RoomEvent.TrackSubscribed, () => bump())
          .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
            track.detach();
            bump();
          })
          .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
            // Sound plus a line on screen: someone arriving used to change
            // nothing but a number in the corner, which was easy to miss.
            pushEvent(`${nameFor(p.identity, p.name)} joined the call`);
            void playCue("join", outputRef.current, false, roomId);
            bump();
          })
          .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
            pushEvent(`${nameFor(p.identity, p.name)} left the call`);
            void playCue("leave", outputRef.current, false, roomId);
            bump();
          })
          .on(RoomEvent.LocalTrackPublished, () => bump())
          .on(RoomEvent.LocalTrackUnpublished, (pub) => {
            /*
             * O navegador tem a propria barra de "parar compartilhamento", e
             * quem a usa nao passa pelo nosso botao. Sem isto o app continuava
             * dizendo "Stop sharing" para uma tela que ja nao ia mais.
             */
            if (pub.source === Track.Source.ScreenShare) setSharing(false);
            bump();
          })
          .on(RoomEvent.TrackMuted, () => bump())
          .on(RoomEvent.TrackUnmuted, () => bump())
          .on(RoomEvent.ConnectionQualityChanged, () => bump())
          .on(RoomEvent.ActiveDeviceChanged, () => bump())
          .on(RoomEvent.MediaDevicesError, (err: Error) => {
            setNotice(
              err.name === "NotAllowedError"
                ? t`The browser blocked your microphone or camera. Allow it in the address bar, then try again.`
                : err.name === "NotFoundError"
                  ? t`The device you picked is not there any more. Choose another under Devices.`
                  : t`A microphone or camera could not be opened — another app may be holding it.`
            );
          })
          .on(RoomEvent.ActiveSpeakersChanged, (list: Participant[]) =>
            setSpeakers(new Set(list.map((p) => p.identity)))
          )
          /*
           * O som que outra pessoa apertou na bandeja.
           *
           * Chega como recado, nao como audio: alguns bytes dizendo QUAL som, e
           * este aparelho sintetiza o mesmo. `lerRecadoDeSom` devolve `null`
           * para tudo que nao reconhece — inclusive um som de uma versao mais
           * nova do app — para que apertar um botao que ainda nao temos nao
           * quebre a chamada de quem esta atras.
           */
          .on(RoomEvent.DataReceived, (payload: Uint8Array) => {
            const id = lerRecadoDeSom(payload);
            // Lido na hora, e nao guardado em estado: quem acabou de silenciar
            // espera que o PROXIMO som ja venha calado, nao o seguinte.
            if (id && !bandejaSilenciada()) void tocarSom(id, outputRef.current);
          })
          .on(RoomEvent.AudioPlaybackStatusChanged, () =>
            setAudioBlocked(!room.canPlaybackAudio)
          )
          .on(RoomEvent.Disconnected, () => {
            /*
             * Only fall out of the call if it had actually started. A
             * disconnect that arrives before the first successful connect is a
             * failure, and closing the screen on it leaves the person staring
             * at the conversation with no idea why the call vanished — which
             * is exactly what it looked like when media could not get through.
             */
            setStatus((prev) => {
              if (prev === "connected" || prev === "reconnecting") onCloseRef.current();
              return "failed";
            });
          })
          .on(RoomEvent.Reconnecting, () => setStatus("reconnecting"))
          .on(RoomEvent.Reconnected, () => setStatus("connected"));

        await room.connect(res.url, res.token);
        if (cancelled) return;
        setStatus("connected");
        /*
         * O som de ENTRAR, para quem entrou.
         *
         * Os avisos sonoros só tocavam em `ParticipantConnected` e
         * `ParticipantDisconnected` — ou seja, só quando OUTRA pessoa chegava
         * ou saía. Quem entrava numa sala vazia não ouvia absolutamente nada, e
         * ficava sem saber se a chamada tinha conectado. É o momento em que a
         * confirmação mais importa, e era justamente o que faltava.
         */
        void playCue("join", outputRef.current, false, roomId);
        setAudioBlocked(!room.canPlaybackAudio);

        // Publishing is best effort: no microphone must not keep you out.
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch {
          setMicOn(false);
          setNotice(t`No microphone found. You can hear everyone, but they cannot hear you.`);
        }
        if (withVideo) {
          try {
            await room.localParticipant.setCameraEnabled(true);
          } catch {
            setCamOn(false);
            setNotice(t`No camera found. You joined with audio only.`);
          }
        }
        bump();
      } catch (err) {
        if (cancelled) return;
        setStatus("failed");
        setError(
          err instanceof Error
            ? err.message
            : t`The call could not connect. Check that the server is reachable.`
        );
      }
    })();

    return () => {
      cancelled = true;
      getSocket()?.emit("call:leave", { roomId });
      room.removeAllListeners();
      room.disconnect().catch(() => undefined);
    };
  }, [roomId, withVideo, room, nameFor, pushEvent]);

  /** Identities currently connected to the LiveKit room. */
  const connectedIds = useMemo(() => {
    const ids = new Set<string>();
    if (status === "connected") ids.add(room.localParticipant.identity);
    room.remoteParticipants.forEach((p) => ids.add(p.identity));
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, revision, status]);

  const audioTracks = useMemo(() => {
    const out: { id: string; track: Track; chave: string }[] = [];
    room.remoteParticipants.forEach((p) => {
      (p.trackPublications as Map<string, RemoteTrackPublication>).forEach((pub) => {
        const isAudio =
          pub.source === Track.Source.Microphone || pub.source === Track.Source.ScreenShareAudio;
        if (isAudio && pub.track) {
          out.push({
            id: `${p.identity}-${pub.source}`,
            track: pub.track,
            chave: chaveDeAudio(p.identity, pub.source)
          });
        }
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, revision, status]);

  /** Display name for an identity, preferring what our own API knows. */
  function nameOf(identity: string, fallback?: string) {
    if (identity === me?.id) return me.displayName;
    const known = roster.find((u) => u.id === identity);
    return known?.displayName ?? fallback ?? t`Someone`;
  }

  const tiles = useMemo<Tile[]>(() => {
    const out: Tile[] = [];

    const push = (participant: Participant, isLocal: boolean) => {
      const pubs = [...participant.trackPublications.values()] as TrackPublication[];
      const screen = pubs.find((p) => p.source === Track.Source.ScreenShare && p.track);
      const cam = pubs.find((p) => p.source === Track.Source.Camera && p.track);
      const mic = pubs.find((p) => p.source === Track.Source.Microphone);
      const muted = !mic || mic.isMuted;
      // LiveKit's `name` is empty until the server echoes it back, which is why
      // the local tile used to render as "?" for the first seconds.
      const name = nameOf(participant.identity, participant.name);
      const avatarUrl =
        (participant.identity === me?.id ? me?.avatarUrl : null) ??
        roster.find((u) => u.id === participant.identity)?.avatarUrl ??
        null;
      const speaking = speakers.has(participant.identity) && !muted;

      if (screen?.track) {
        out.push({
          key: `${participant.identity}-screen`, participantId: participant.identity,
          name, avatarUrl, track: screen.track, isScreen: true, isLocal, muted, speaking,
          quality: participant.connectionQuality
        });
      }
      out.push({
        key: `${participant.identity}-cam`, participantId: participant.identity,
        name, avatarUrl, track: cam?.track ?? null, isScreen: false, isLocal, muted, speaking,
        quality: participant.connectionQuality
      });
    };

    if (status === "connected") push(room.localParticipant, true);
    room.remoteParticipants.forEach((p) => push(p, false));

    return out.sort((a, b) => Number(b.isScreen) - Number(a.isScreen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, status, sharing, camOn, micOn, revision, speakers, roster, me]);

  /*
   * A fonte de audio de um tile. A tela tem a sua propria — e esse e o ponto:
   * abaixar o jogo de alguem nao pode abaixar a voz da mesma pessoa.
   */
  const fonteDoTile = (tile: Tile) =>
    tile.isScreen ? Track.Source.ScreenShareAudio : Track.Source.Microphone;

  const volumeDoTile = (tile: Tile) => {
    const k = chaveDeAudio(tile.participantId, fonteDoTile(tile));
    return volumes[k] ?? volumeDe(k);
  };

  const mudarVolumeDoTile = (tile: Tile, v: number) => {
    const k = chaveDeAudio(tile.participantId, fonteDoTile(tile));
    setVolumes((m) => ({ ...m, [k]: v }));
    salvarVolume(k, v);
  };

  const volumePara = (chave: string) => volumes[chave] ?? volumeDe(chave);

  /*
   * Um so lugar para montar um tile: ele aparece em tres arranjos diferentes
   * (vazio, com palco, em grade) e as tres copias ja divergiram uma vez.
   */
  const montarTile = (tile: Tile) => (
    <VideoTile
      key={tile.key}
      tile={tile}
      volume={tile.isLocal ? null : volumeDoTile(tile)}
      onVolume={(v) => mudarVolumeDoTile(tile, v)}
    />
  );

  const screenTiles = tiles.filter((t) => t.isScreen);
  const peopleTiles = tiles.filter((t) => !t.isScreen);

  const inCall = roster.filter((u) => connectedIds.has(u.id));
  const away = roster.filter((u) => !connectedIds.has(u.id));
  const total = connectedIds.size;

  async function toggleMic() {
    try {
      await room.localParticipant.setMicrophoneEnabled(!micOn);
      setMicOn(!micOn);
      setNotice(null);
    } catch {
      setNotice(t`Your microphone could not be turned on. Check the browser's permission.`);
    }
    bump();
  }

  async function toggleCam() {
    try {
      await room.localParticipant.setCameraEnabled(!camOn);
      setCamOn(!camOn);
      setNotice(null);
    } catch {
      setNotice(t`Your camera could not be turned on. Check the browser's permission.`);
    }
    bump();
  }

  /**
   * Virar a câmera: frontal ⇄ traseira.
   *
   * No computador `switchActiveDevice("videoinput", id)` resolve, porque lá cada
   * câmera tem um id estável e um nome que diz o que ela é. No telefone não:
   * pedir o LADO é a única forma que a plataforma entende bem.
   *
   * Três degraus, porque o de cima falha calado (ver `trocouDeCamera`):
   *  1. `restartTrack({ facingMode })` — o caminho certo no celular;
   *  2. se não trocou nada, `switchActiveDevice` com o id da outra câmera;
   *  3. só então avisamos a pessoa, em vez de deixá-la achando que o botão
   *     não faz nada.
   */
  async function virarCamera() {
    const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!track) {
      setNotice(t`Turn your camera on first — there is no picture to switch while it is off.`);
      return;
    }

    const alvo = proximoFacingMode(facing);
    const antes = track.mediaStreamTrack.getSettings();

    try {
      await track.restartTrack({ facingMode: alvo });
      if (trocouDeCamera(antes, track.mediaStreamTrack.getSettings(), alvo)) {
        setFacing(alvo);
        setNotice(null);
        bump();
        return;
      }
    } catch {
      /* segue para o plano B */
    }

    const id = cameraParaFacing(rawCameras, alvo, antes.deviceId);
    if (id) {
      try {
        await room.switchActiveDevice("videoinput", id);
        setFacing(alvo);
        setNotice(null);
        bump();
        return;
      } catch {
        /* nem por id: aí sim é para contar */
      }
    }

    setNotice(t`The other camera could not be opened — another app may be holding it.`);
    bump();
  }

  /**
   * Apertar um som da bandeja.
   *
   * Toca aqui e manda o recado no mesmo movimento, sem esperar volta do
   * servidor: quem apertou precisa ouvir no instante do clique, senao parece
   * que o botao nao pegou e a pessoa aperta de novo. `reliable` porque um
   * efeito perdido tem o mesmo efeito — vira clique repetido.
   */
  const tocarNaBandeja = useCallback(
    (id: SomId) => {
      void tocarSom(id, outputRef.current);
      room.localParticipant
        .publishData(empacotarSom(id), { reliable: true })
        .catch(() => undefined);
    },
    [room]
  );

  async function toggleShare() {
    const turningOn = !sharing;
    try {
      await room.localParticipant.setScreenShareEnabled(
        turningOn,
        turningOn ? captureOptions(qualidade) : undefined,
        turningOn ? publishOptions(qualidade) : undefined
      );
      setSharing(turningOn);

      if (turningOn) {
        /*
         * Pedir `audio: true` nao garante som: quem compartilha precisa marcar
         * a caixinha no dialogo do navegador, e em "janela" o Chrome no Windows
         * nem oferece a opcao. Dizer isso na hora e melhor do que a outra
         * pessoa avisar depois que nao esta ouvindo nada.
         */
        /*
         * A publicação do áudio pode não estar registrada no instante em que
         * `setScreenShareEnabled` resolve — o vídeo entra primeiro. Conferir na
         * hora dava um "sem som" falso mesmo quando o som tinha sido capturado,
         * e um aviso que mente é pior do que aviso nenhum: a pessoa vai mexer
         * no diálogo de compartilhamento tentando consertar o que já estava
         * certo.
         *
         * Duas leituras separadas por um quadro resolvem, e o custo é um
         * instante antes de a mensagem aparecer.
         */
        const temAudio = () =>
          !!room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
        let comSom = temAudio();
        if (!comSom) {
          await new Promise((r) => setTimeout(r, 250));
          comSom = temAudio();
        }
        setNotice(
          comSom
            ? null
            : t`Sharing without sound. To include it, share again and tick “Also share tab audio” (or “Share system audio”) in the browser's dialog — Chrome on Windows only offers it for a tab or a whole screen, not a single window.`
        );
      } else {
        setNotice(null);
      }
      bump();
    } catch (err) {
      if (err instanceof Error && err.name !== "NotAllowedError") {
        setNotice(t`Screen sharing could not start.`);
      }
    }
  }

  const statusLabel =
    status === "connecting" ? t`Connecting…`
    : status === "reconnecting" ? t`Reconnecting…`
    : status === "failed" ? t`Could not connect`
    : total <= 1 ? t`You are the only one here`
    : plural(total, { one: "# person connected", other: "# people connected" });

  if (minimized) {
    return (
      <>
        <RemoteAudio
          tracks={audioTracks}
          sinkId={outputId}
          retomar={retomar}
          onBloqueado={setSaidaBloqueada}
          volumePara={volumePara}
        />
        <div className="call-ribbon" role="status">
          <span className="live-dot" aria-hidden="true" />
          <span className="ribbon-text">
            <b>{callName}</b> · {statusLabel}
          </span>
          <button className="ribbon-open" onClick={() => setMinimized(false)}>
            <Trans>Open the call</Trans>
          </button>
          <button className="ribbon-hangup" onClick={sair}>
            Leave
          </button>
        </div>
      </>
    );
  }

  return (
    <div
      className={`call-sheet${expandida ? " expandida" : ""} roster-${lado}`}
      role="dialog"
      aria-label={`Call in ${callName}`}
    >
      <RemoteAudio
          tracks={audioTracks}
          sinkId={outputId}
          retomar={retomar}
          onBloqueado={setSaidaBloqueada}
          volumePara={volumePara}
        />

      <header className="call-top">
        <button
          className="icon-btn"
          onClick={() => setMinimized(true)}
          data-tip={t`Minimise — the call keeps running and you go back to the messages`}
          aria-label={t`Minimise the call`}
        >
          <IconMinimize />
        </button>
        {/*
          Expandir e recolher.
          ---------------------------------------------------------------
          Recolhida, a chamada ocupa só o espaço da conversa e a barra de
          espaços e a lista de grupos continuam à vista — dá para trocar de
          servidor sem sair da chamada. Expandida, cobre a janela toda, que é
          o que se quer quando alguém está apresentando a tela.

          Não é o mesmo que minimizar: minimizar troca o vídeo por uma tarja;
          isto só decide quanta tela a chamada ocupa.
        */}
        <button
          className="icon-btn"
          onClick={() => {
            const v = !expandida;
            setExpandida(v);
            salvarChamadaExpandida(v);
          }}
          data-tip={expandida ? t`Shrink — show the other spaces` : t`Expand to the whole window`}
          aria-label={expandida ? t`Shrink the call` : t`Expand the call`}
          aria-pressed={expandida}
        >
          {expandida ? <IconRecolher /> : <IconExpandir />}
        </button>
        <div className="call-top-title">
          <strong>{callName}</strong>
          <span className={status === "failed" ? "bad" : undefined}>{statusLabel}</span>
        </div>
        <button className="call-leave-top" onClick={sair} title={t`Leave the call`}>
          <IconHangup size={18} /> Leave
        </button>
      </header>

      {(audioBlocked || saidaBloqueada) && (
        /*
         * O clique e o gesto que a politica de autoplay exige, entao ele tem de
         * destravar OS DOIS lados: o audio interno do LiveKit e os nossos
         * elementos. Antes so chamava `startAudio()`, e quem estava sem o som da
         * tela clicava, a tarja sumia e continuava sem ouvir nada.
         */
        <button
          className="call-banner"
          onClick={() => {
            void room.startAudio();
            setSaidaBloqueada(false);
            setRetomar((n) => n + 1);
          }}
        >
          <IconSpeaker /> Sound is blocked by the browser. Click here to turn it on.
        </button>
      )}
      {status === "failed" && (
        <div className="call-banner bad">
          {error ??
            "The call dropped before it could start. The audio and video path could not be established — the server's media ports may be closed. Messages are unaffected."}
        </div>
      )}
      {notice && !error && <div className="call-banner">{notice}</div>}

      {events.length > 0 && (
        <div className="call-events" role="status" aria-live="polite">
          {events.map((e) => (
            <span key={e.id} className="call-event">{e.text}</span>
          ))}
        </div>
      )}

      <div className="call-body">
        {tiles.length === 0 ? (
          <div className="call-stage">
            <div className="call-empty">
              <Avatar name={me?.displayName ?? "?"} url={me?.avatarUrl} size={84} className="tile-avatar" />
              <p>{status === "connected" ? t`You are connected.` : statusLabel}</p>
              <p className="dim">
                {status === "connected"
                  ? t`Nobody else has joined yet. They will see this call in the conversation.`
                  : t`Hold on while the connection is set up.`}
              </p>
            </div>
          </div>
        ) : screenTiles.length > 0 ? (
          /*
           * Com tela compartilhada, ela vira o palco e as pessoas viram uma
           * tira embaixo. Nao e so estetica: com `adaptiveStream`, o LiveKit
           * escolhe a camada de video pelo TAMANHO do elemento — dividir o
           * espaco em partes iguais fazia o servidor mandar menos resolucao
           * justamente para o conteudo em que a nitidez importa.
           */
          <div className="call-stage focus">
            <div className="stage-main">
              {screenTiles.map(montarTile)}
            </div>
            {peopleTiles.length > 0 && (
              <div className="stage-strip">
                {peopleTiles.map(montarTile)}
              </div>
            )}
          </div>
        ) : (
          <div className="call-stage">
            {tiles.map(montarTile)}
          </div>
        )}

        {/* The roster is the answer to "who is here and who is not". */}
        {chatAberto && <CallChat roomId={roomId} onClose={() => setChatAberto(false)} />}

        <aside
          className={`call-roster${listaAberta ? "" : " fechada"}`}
          aria-label={t`Who is on the call`}
        >
          {/*
            A barra fica mesmo com a lista fechada: é ela que devolve a lista.
            Recolher para um estado sem volta seria pior do que não recolher.
          */}
          <div className="roster-barra">
            <button
              className="roster-recolher"
              onClick={() => {
                const v = !listaAberta;
                setListaAberta(v);
                salvarRosterAberto(v);
              }}
              aria-expanded={listaAberta}
              data-tip={listaAberta ? t`Hide who is here` : t`Show who is here`}
              aria-label={listaAberta ? t`Hide who is here` : t`Show who is here`}
            >
              <IconSeta size={16} />
            </button>
            {listaAberta && (
              <button
                className="roster-lado"
                onClick={() => {
                  const v: LadoDoRoster = lado === "direita" ? "esquerda" : "direita";
                  setLado(v);
                  salvarLadoDoRoster(v);
                }}
                data-tip={
                  lado === "direita" ? t`Move the list to the left` : t`Move the list to the right`
                }
                aria-label={
                  lado === "direita" ? t`Move the list to the left` : t`Move the list to the right`
                }
              >
                {lado === "direita" ? "\u2190" : "\u2192"}
              </button>
            )}
          </div>

          {listaAberta && (
            <>
          <p className="roster-head">In the call · {inCall.length || (status === "connected" ? 1 : 0)}</p>
          {inCall.length === 0 && status === "connected" && (
            <RosterRow
              name={me?.displayName ?? t`You`}
              avatarUrl={me?.avatarUrl}
              suffix="(you)"
              here
              muted={!micOn}
            />
          )}
          {inCall.map((u) => (
            <RosterRow
              key={u.id}
              name={u.displayName}
              avatarUrl={u.avatarUrl}
              suffix={u.id === me?.id ? t`(you)` : undefined}
              here
              muted={
                u.id === me?.id
                  ? !micOn
                  : tiles.find((t) => t.participantId === u.id && !t.isScreen)?.muted ?? false
              }
              speaking={speakers.has(u.id)}
            />
          ))}

          {away.length > 0 && (
            <>
              <p className="roster-head">
                <Trans>Not in the call</Trans> · {away.length}
              </p>
              {away.map((u) => (
                <RosterRow key={u.id} name={u.displayName} avatarUrl={u.avatarUrl} />
              ))}
            </>
          )}
            </>
          )}
        </aside>
      </div>

      <div className="call-bar">
        <div className="call-ctl-group">
          <CallButton
            label={micOn ? t`Mute` : t`Unmute`}
            danger={!micOn}
            onClick={toggleMic}
            icon={micOn ? <IconMic /> : <IconMicOff />}
          />
          <button
            className="call-caret"
            title={t`Microphone options`}
            aria-label={t`Microphone options`}
            aria-expanded={quick === "audioinput"}
            onClick={() => setQuick((q) => (q === "audioinput" ? null : "audioinput"))}
          >
            <IconChevronDown size={14} />
          </button>
          {quick === "audioinput" && (
            <QuickDeviceMenu
              kind="audioinput"
              onSwitch={(k, id) => room.switchActiveDevice(k, id).then(() => undefined)}
              onNotice={setNotice}
              onClose={() => setQuick(null)}
              onFullSettings={() => {
                setQuick(null);
                setShowDevices(true);
              }}
            />
          )}
        </div>

        <div className="call-ctl-group">
          <CallButton
            label={camOn ? t`Stop video` : t`Start video`}
            danger={!camOn}
            onClick={toggleCam}
            icon={camOn ? <IconVideo /> : <IconVideoOff />}
          />
          <button
            className="call-caret"
            title={t`Camera options`}
            aria-label={t`Camera options`}
            aria-expanded={quick === "videoinput"}
            onClick={() => setQuick((q) => (q === "videoinput" ? null : "videoinput"))}
          >
            <IconChevronDown size={14} />
          </button>
          {quick === "videoinput" && (
            <QuickDeviceMenu
              kind="videoinput"
              onSwitch={(k, id) => room.switchActiveDevice(k, id).then(() => undefined)}
              onNotice={setNotice}
              onClose={() => setQuick(null)}
              onFullSettings={() => {
                setQuick(null);
                setShowDevices(true);
              }}
            />
          )}
        </div>
        {/*
          Só aparece onde virar a câmera quer dizer alguma coisa: com mais de uma
          câmera e numa plataforma que não deixa escolher por id (ver
          `deveUsarFacingMode`). No computador o botão não existe — lá a escolha
          mora no menu da setinha, por nome.
        */}
        {podeVirarCamera && (
          <CallButton
            label={facing === "user" ? t`Rear camera` : t`Front camera`}
            onClick={() => void virarCamera()}
            disabled={!camOn}
            title={
              camOn
                ? facing === "user"
                  ? t`Switch to the rear camera`
                  : t`Switch to the front camera`
                : t`Turn your camera on to switch between them.`
            }
            icon={<IconFlipCamera />}
          />
        )}
        <div className="call-ctl-group">
          <CallButton
            label={sharing ? t`Stop sharing` : t`Share screen`}
            active={sharing}
            onClick={toggleShare}
            disabled={!canShareScreen}
            title={
              canShareScreen
                ? undefined
                : t`Screen sharing is not available on this device — Android's WebView cannot capture the screen.`
            }
            icon={<IconScreen />}
          />
          {/*
            A qualidade fica no proprio botao de compartilhar, e nao so nas
            configuracoes: e ali que a pessoa esta quando descobre que os
            quadros estao baixos, e mandar ela procurar num menu de dispositivos
            no meio de uma apresentacao e o mesmo que nao oferecer.
          */}
          {canShareScreen && (
            <button
              className="call-caret"
              title={t`Screen quality`}
              aria-label={t`Screen quality`}
              aria-expanded={menuTela}
              onClick={() => setMenuTela((v) => !v)}
            >
              <IconChevronDown size={14} />
            </button>
          )}
          {menuTela && (
            <div className="quick-menu quick-menu-wide" role="dialog" aria-label={t`Screen quality`}>
              <p className="quick-head">{resumo(qualidade, t`Source`)}</p>
              <QualidadeDeTela
                valor={qualidade}
                compacto
                onChange={(q) => {
                  setQualidade(q);
                  saveQualidade(q);
                  if (sharing) {
                    setNotice(t`The new setting applies the next time you start sharing.`);
                  }
                }}
              />
              <button className="quick-full" onClick={() => setMenuTela(false)}>
                <Trans>Done</Trans>
              </button>
            </div>
          )}
        </div>
        <CallButton
          label={t`Chat`}
          active={chatAberto}
          onClick={() => setChatAberto((v) => !v)}
          icon={<IconChats />}
        />
        {/*
          A bandeja de sons fica na barra, ao lado da conversa: e uma coisa que
          se faz DURANTE a chamada, no meio da frase de outra pessoa. Enterrar
          num menu de configuracoes seria o mesmo que nao ter.
        */}
        <div className="call-ctl-group">
          <CallButton
            label={t`Sounds`}
            active={bandeja}
            onClick={() => setBandeja((v) => !v)}
            icon={<IconBandeja />}
          />
          {bandeja && (
            <Soundboard
              roomId={roomId}
              onTocar={tocarNaBandeja}
              onFechar={() => setBandeja(false)}
            />
          )}
        </div>
        <CallButton
          label={t`Devices`}
          active={showDevices}
          onClick={() => setShowDevices((v) => !v)}
          icon={<IconSettings />}
        />
        <CallButton label={t`Leave`} hangup onClick={sair} icon={<IconHangup />} />
      </div>

      {showDevices && (
        <aside className="call-devices" aria-label={t`Audio and video devices`}>
          <header>
            <strong>
              <Trans>Audio and video</Trans>
            </strong>
            <button
              className="icon-btn"
              onClick={() => setShowDevices(false)}
              title={t`Close`}
              aria-label={t`Close devices`}
            >
              <IconClose />
            </button>
          </header>
          <DevicePicker
            micTrack={
              room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
                ?.mediaStreamTrack ?? null
            }
            onSwitch={(kind, id) => room.switchActiveDevice(kind, id).then(() => undefined)}
            onNotice={setNotice}
            onChange={(kind, id) => {
              if (kind === "audiooutput") setOutputId(id);
            }}
          />

        </aside>
      )}
    </div>
  );
}

/**
 * Câmera com duas setas em volta: virar para o outro lado.
 *
 * Mora aqui, e não em `icons.tsx`, porque é o único lugar que o usa e porque o
 * arquivo de ícones está sendo mexido por outra frente ao mesmo tempo. Mesma
 * receita visual do resto: traço 1.8, sem preenchimento, 24×24.
 */
function IconFlipCamera({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5h3.2l1.4-2h4.8l1.4 2H21v10H3z" />
      <path d="M9.6 13.2a2.9 2.9 0 0 0 4.8 1.6M14.4 13.2a2.9 2.9 0 0 0-4.8-1.6" />
      <path d="M9.6 10.4v1.2h1.2M14.4 15.9v-1.2h-1.2" />
    </svg>
  );
}

function RosterRow({
  name, avatarUrl, suffix, here, muted, speaking
}: {
  name: string; avatarUrl?: string | null;
  suffix?: string; here?: boolean; muted?: boolean; speaking?: boolean;
}) {
  const { t } = useLingui();
  return (
    <div className={`roster-row${here ? " here" : ""}${speaking ? " speaking" : ""}`}>
      <Avatar name={name} url={avatarUrl} size={30} className="roster-avatar" />
      <span className="roster-name">
        {name} {suffix && <em>{suffix}</em>}
      </span>
      {here ? (
        muted ? (
          <span className="roster-state muted" title={t`Microphone off`}>
            <IconMicOff size={14} />
          </span>
        ) : (
          <span className="roster-state on" title={t`Microphone on`}>
            <IconMic size={14} />
          </span>
        )
      ) : (
        <span className="roster-state away">
          <Trans>away</Trans>
        </span>
      )}
    </div>
  );
}

/**
 * A control is an icon plus a word.
 *
 * Icon-only controls were the biggest source of confusion here, and the two
 * states were drawn with the same highlight for opposite meanings. Red now
 * means one thing everywhere: this is off.
 */
function CallButton({
  label, icon, onClick, danger, active, hangup, disabled, title
}: {
  label: string; icon: React.ReactNode; onClick: () => void;
  danger?: boolean; active?: boolean; hangup?: boolean;
  disabled?: boolean; title?: string;
}) {
  const cls = ["call-btn", danger ? "off" : "", active ? "on" : "", hangup ? "hangup" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button className="call-ctl" onClick={onClick} disabled={disabled} title={title ?? label}>
      <span className={cls}>{icon}</span>
      <span className="call-ctl-label">{label}</span>
    </button>
  );
}

/**
 * Remote audio needs a real element to come out of. LiveKit does not create
 * one — without this the call connects, tiles render, and nobody hears anybody.
 */
function RemoteAudio({
  tracks,
  sinkId,
  retomar,
  onBloqueado,
  volumePara
}: {
  tracks: { id: string; track: Track; chave: string }[];
  sinkId?: string;
  retomar: number;
  onBloqueado: (v: boolean) => void;
  volumePara: (chave: string) => number;
}) {
  return (
    <div style={{ display: "none" }} aria-hidden="true">
      {tracks.map((t) => (
        <AudioSink
          key={t.id}
          track={t.track}
          sinkId={sinkId}
          retomar={retomar}
          onBloqueado={onBloqueado}
          volume={volumePara(t.chave)}
        />
      ))}
    </div>
  );
}

function AudioSink({
  track,
  sinkId,
  retomar,
  onBloqueado,
  volume
}: {
  track: Track;
  sinkId?: string;
  retomar: number;
  onBloqueado: (v: boolean) => void;
  volume: number;
}) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  /*
   * Tocar de verdade, e reclamar quando nao der.
   *
   * `autoPlay` no elemento nao basta: ele PEDE para tocar, e o navegador pode
   * recusar em silencio. Nao havia nada aqui checando isso, entao uma faixa que
   * chegava depois do gesto de entrar na chamada — o som da tela compartilhada e
   * o caso classico — podia nascer muda sem uma linha de aviso.
   *
   * A promessa de `play()` e a unica forma de saber. Rejeitou, a tarja aparece;
   * e como o clique dela mexe em `retomar`, este efeito roda de novo com o gesto
   * do usuario ja no bolso, que e o que a politica de autoplay pede.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let vivo = true;
    /*
     * So o FRACASSO e reportado. Se o sucesso tambem baixasse a tarja, o
     * microfone que toca normalmente apagaria o aviso levantado pelo som da
     * tela que nao toca — sao varios elementos correndo ao mesmo tempo, e quem
     * respondesse por ultimo decidiria. A tarja baixa no clique, que e o unico
     * momento em que se sabe que a pessoa pediu.
     */
    void el.play().catch(() => {
      if (vivo) onBloqueado(true);
    });
    return () => {
      vivo = false;
    };
  }, [track, retomar, onBloqueado]);

  /*
   * O volume escolhido para esta fonte.
   *
   * E aqui que a barra vira som. O elemento e nosso, entao mexer em `.volume`
   * atinge exatamente uma pessoa e exatamente um caminho — a tela de alguem sem
   * mexer na voz dele, que e justamente o que o volume do sistema nao faz.
   */
  useEffect(() => {
    const el = ref.current;
    if (el) el.volume = volume;
  }, [volume]);

  /*
   * Choosing a speaker only means something if the elements the audio actually
   * plays through follow it. These are ours, created here, so they have to be
   * pointed at the chosen output by hand every time it changes.
   */
  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!el?.setSinkId || !sinkId) return;
    void el.setSinkId(sinkId).catch(() => undefined);
  }, [sinkId]);

  return <audio ref={ref} autoPlay />;
}

function VideoTile({
  tile,
  volume,
  onVolume
}: {
  tile: Tile;
  /** `null` quando nao ha audio remoto para mexer — o seu proprio tile. */
  volume: number | null;
  onVolume: (v: number) => void;
}) {
  const { t } = useLingui();
  const ref = useRef<HTMLVideoElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [cheia, setCheia] = useState(false);
  const [mexendoVolume, setMexendoVolume] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !tile.track) return;
    tile.track.attach(el);
    return () => {
      tile.track?.detach(el);
    };
  }, [tile.track]);

  /*
   * Tela cheia.
   *
   * `requestFullscreen` no tile INTEIRO, e nao no <video>: em tela cheia o nome
   * de quem apresenta e o botao de sair precisam continuar existindo. Um <video>
   * em tela cheia entrega o controle ao navegador e leva junto tudo o que
   * desenhamos por cima.
   *
   * No app instalado isso tambem funciona, e sem precisar de nada do Tauri: o
   * `tauri-runtime-wry` escuta o `ContainsFullScreenElementChanged` da WebView2
   * e poe a JANELA em tela cheia sozinho. Por isso nao ha dependencia nova aqui.
   *
   * O estado vem do evento, nunca do clique. Sair pelo Esc e o caminho mais
   * usado e nao passa por botao nenhum — confiar no clique deixaria o icone
   * mentindo.
   */
  useEffect(() => {
    const ver = () => setCheia(document.fullscreenElement === caixa.current);
    document.addEventListener("fullscreenchange", ver);
    return () => document.removeEventListener("fullscreenchange", ver);
  }, []);

  const alternarTelaCheia = () => {
    const el = caixa.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void el.requestFullscreen().catch(() => undefined);
    }
  };

  const poor =
    tile.quality === ConnectionQuality.Poor || tile.quality === ConnectionQuality.Lost;

  /* So faz sentido em quadro de video — num avatar nao ha o que ampliar. */
  const podeAmpliar = !!tile.track;
  const mudo = volume === 0;

  return (
    <div
      ref={caixa}
      className={`tile${tile.isScreen ? " screen" : ""}${tile.speaking ? " speaking" : ""}${
        cheia ? " cheia" : ""
      }`}
      /*
       * Dois cliques ampliam. E o gesto que todo mundo ja tenta primeiro num
       * video, e ele nao exige mirar num botao de 28px enquanto a apresentacao
       * corre.
       */
      onDoubleClick={podeAmpliar ? alternarTelaCheia : undefined}
    >
      {tile.track ? (
        <video ref={ref} autoPlay playsInline muted={tile.isLocal} />
      ) : (
        <Avatar name={tile.name} url={tile.avatarUrl} size={84} className="tile-avatar" />
      )}

      <span className="tile-name">
        {tile.muted && !tile.isScreen && (
          <span className="tile-muted" title={t`Microphone off`}>
            <IconMicOff size={13} />
          </span>
        )}
        {tile.name}
        {tile.isLocal && !tile.isScreen ? ` ${t`(you)`}` : ""}
        {tile.isScreen ? ` — ${t`screen`}` : ""}
      </span>

      {/*
        Os controles do quadro. Ficam escondidos ate o ponteiro chegar (ver
        `.tile-acoes` no CSS) porque em cima de uma apresentacao qualquer coisa
        permanente vira sujeira — mas continuam existindo para o teclado e para
        o leitor de tela, que nao tem ponteiro para passar por cima.
      */}
      <div className="tile-acoes">
        {volume !== null && (
          <div className={`tile-volume${mexendoVolume ? " aberto" : ""}`}>
            <button
              className="tile-acao"
              onClick={() => setMexendoVolume((v) => !v)}
              aria-expanded={mexendoVolume}
              title={
                tile.isScreen
                  ? t`Volume of this screen share`
                  : t`Volume of this person`
              }
              aria-label={
                tile.isScreen
                  ? t`Volume of this screen share`
                  : t`Volume of this person`
              }
            >
              {mudo ? <IconVolumeMudo /> : <IconVolume />}
            </button>
            {mexendoVolume && (
              <>
                <input
                  className="tile-volume-barra"
                  type="range"
                  min={0}
                  max={VOLUME_MAX}
                  step={0.05}
                  value={volume}
                  onChange={(e) => onVolume(Number(e.target.value))}
                  aria-label={t`Volume`}
                />
                <span className="tile-volume-num">
                  {rotuloDeVolume(volume, t`muted`)}
                </span>
              </>
            )}
          </div>
        )}

        {podeAmpliar && (
          <button
            className="tile-acao"
            onClick={alternarTelaCheia}
            title={cheia ? t`Leave full screen (Esc)` : t`Full screen`}
            aria-label={cheia ? t`Leave full screen` : t`Full screen`}
            aria-pressed={cheia}
          >
            {cheia ? <IconSairTelaCheia /> : <IconTelaCheia />}
          </button>
        )}
      </div>

      {poor && !tile.isLocal && (
        <span className="tile-quality" title={t`Weak connection`}>
          <IconSignal size={14} />
        </span>
      )}
    </div>
  );
}
