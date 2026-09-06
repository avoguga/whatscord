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
import { initials } from "../lib/format";
import { loadDevicePrefs } from "../lib/devices";
import { playCue } from "../lib/sounds";
import {
  canShareScreen,
  captureOptions,
  loadShareMode,
  publishOptions,
  saveShareMode,
  SHARE_MODE_LABELS,
  type ShareMode
} from "../lib/screenshare";
import { DevicePicker } from "./DevicePicker";
import {
  IconMic, IconMicOff, IconVideo, IconVideoOff, IconScreen,
  IconHangup, IconMinimize, IconSignal, IconSpeaker, IconSettings, IconClose
} from "./icons";

type Tile = {
  key: string;
  participantId: string;
  name: string;
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
  const me = useStore((s) => s.me);
  const rooms = useStore((s) => s.rooms);
  const roomMeta = rooms.find((r) => r.id === roomId);
  const callName = roomMeta?.name ?? roomMeta?.counterpart?.displayName ?? "Call";

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
  const [speakers, setSpeakers] = useState<Set<string>>(new Set());
  /** Everyone who belongs to this conversation, in or out of the call. */
  const [roster, setRoster] = useState<User[]>([]);

  const [showDevices, setShowDevices] = useState(false);
  /** Short-lived "X joined" lines, the visual half of the arrival cue. */
  const [events, setEvents] = useState<{ id: number; text: string }[]>([]);
  const [outputId, setOutputId] = useState<string | undefined>(() => loadDevicePrefs().audiooutput);
  const [shareMode, setShareMode] = useState<ShareMode>(() => loadShareMode());

  const [revision, setRevision] = useState(0);
  const bump = () => setRevision((n) => n + 1);

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
    return rosterRef.current.find((u) => u.id === identity)?.displayName ?? fallback ?? "Someone";
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
            void playCue("join", outputRef.current);
            bump();
          })
          .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
            pushEvent(`${nameFor(p.identity, p.name)} left the call`);
            void playCue("leave", outputRef.current);
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
                ? "The browser blocked your microphone or camera. Allow it in the address bar, then try again."
                : err.name === "NotFoundError"
                  ? "The device you picked is not there any more. Choose another under Devices."
                  : "A microphone or camera could not be opened — another app may be holding it."
            );
          })
          .on(RoomEvent.ActiveSpeakersChanged, (list: Participant[]) =>
            setSpeakers(new Set(list.map((p) => p.identity)))
          )
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
        setAudioBlocked(!room.canPlaybackAudio);

        // Publishing is best effort: no microphone must not keep you out.
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch {
          setMicOn(false);
          setNotice("No microphone found. You can hear everyone, but they cannot hear you.");
        }
        if (withVideo) {
          try {
            await room.localParticipant.setCameraEnabled(true);
          } catch {
            setCamOn(false);
            setNotice("No camera found. You joined with audio only.");
          }
        }
        bump();
      } catch (err) {
        if (cancelled) return;
        setStatus("failed");
        setError(
          err instanceof Error
            ? err.message
            : "The call could not connect. Check that the server is reachable."
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
    const out: { id: string; track: Track }[] = [];
    room.remoteParticipants.forEach((p) => {
      (p.trackPublications as Map<string, RemoteTrackPublication>).forEach((pub) => {
        const isAudio =
          pub.source === Track.Source.Microphone || pub.source === Track.Source.ScreenShareAudio;
        if (isAudio && pub.track) out.push({ id: `${p.identity}-${pub.source}`, track: pub.track });
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, revision, status]);

  /** Display name for an identity, preferring what our own API knows. */
  function nameOf(identity: string, fallback?: string) {
    if (identity === me?.id) return me.displayName;
    const known = roster.find((u) => u.id === identity);
    return known?.displayName ?? fallback ?? "Someone";
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
      const speaking = speakers.has(participant.identity) && !muted;

      if (screen?.track) {
        out.push({
          key: `${participant.identity}-screen`, participantId: participant.identity,
          name, track: screen.track, isScreen: true, isLocal, muted, speaking,
          quality: participant.connectionQuality
        });
      }
      out.push({
        key: `${participant.identity}-cam`, participantId: participant.identity,
        name, track: cam?.track ?? null, isScreen: false, isLocal, muted, speaking,
        quality: participant.connectionQuality
      });
    };

    if (status === "connected") push(room.localParticipant, true);
    room.remoteParticipants.forEach((p) => push(p, false));

    return out.sort((a, b) => Number(b.isScreen) - Number(a.isScreen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, status, sharing, camOn, micOn, revision, speakers, roster, me]);

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
      setNotice("Your microphone could not be turned on. Check the browser's permission.");
    }
    bump();
  }

  async function toggleCam() {
    try {
      await room.localParticipant.setCameraEnabled(!camOn);
      setCamOn(!camOn);
      setNotice(null);
    } catch {
      setNotice("Your camera could not be turned on. Check the browser's permission.");
    }
    bump();
  }

  async function toggleShare() {
    const turningOn = !sharing;
    try {
      await room.localParticipant.setScreenShareEnabled(
        turningOn,
        turningOn ? captureOptions(shareMode) : undefined,
        turningOn ? publishOptions(shareMode) : undefined
      );
      setSharing(turningOn);

      if (turningOn) {
        /*
         * Pedir `audio: true` nao garante som: quem compartilha precisa marcar
         * a caixinha no dialogo do navegador, e em "janela" o Chrome no Windows
         * nem oferece a opcao. Dizer isso na hora e melhor do que a outra
         * pessoa avisar depois que nao esta ouvindo nada.
         */
        const comSom = !!room.localParticipant.getTrackPublication(
          Track.Source.ScreenShareAudio
        );
        setNotice(
          comSom
            ? null
            : "Sharing without sound. To include it, share again and tick “Also share tab audio” (or “Share system audio”) in the browser's dialog — Chrome on Windows only offers it for a tab or a whole screen, not a single window."
        );
      } else {
        setNotice(null);
      }
      bump();
    } catch (err) {
      if (err instanceof Error && err.name !== "NotAllowedError") {
        setNotice("Screen sharing could not start.");
      }
    }
  }

  const statusLabel =
    status === "connecting" ? "Connecting…"
    : status === "reconnecting" ? "Reconnecting…"
    : status === "failed" ? "Could not connect"
    : total <= 1 ? "You are the only one here"
    : `${total} people connected`;

  if (minimized) {
    return (
      <>
        <RemoteAudio tracks={audioTracks} sinkId={outputId} />
        <div className="call-ribbon" role="status">
          <span className="live-dot" aria-hidden="true" />
          <span className="ribbon-text">
            <b>{callName}</b> · {statusLabel}
          </span>
          <button className="ribbon-open" onClick={() => setMinimized(false)}>
            Open the call
          </button>
          <button className="ribbon-hangup" onClick={onClose}>
            Leave
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="call-sheet" role="dialog" aria-label={`Call in ${callName}`}>
      <RemoteAudio tracks={audioTracks} sinkId={outputId} />

      <header className="call-top">
        <button
          className="icon-btn"
          onClick={() => setMinimized(true)}
          title="Minimise — the call keeps running and you go back to the messages"
        >
          <IconMinimize />
        </button>
        <div className="call-top-title">
          <strong>{callName}</strong>
          <span className={status === "failed" ? "bad" : undefined}>{statusLabel}</span>
        </div>
        <button className="call-leave-top" onClick={onClose} title="Leave the call">
          <IconHangup size={18} /> Leave
        </button>
      </header>

      {audioBlocked && (
        <button className="call-banner" onClick={() => room.startAudio()}>
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
              <div className="tile-avatar">{initials(me?.displayName ?? "?")}</div>
              <p>{status === "connected" ? "You are connected." : statusLabel}</p>
              <p className="dim">
                {status === "connected"
                  ? "Nobody else has joined yet. They will see this call in the conversation."
                  : "Hold on while the connection is set up."}
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
              {screenTiles.map((tile) => (
                <VideoTile key={tile.key} tile={tile} />
              ))}
            </div>
            {peopleTiles.length > 0 && (
              <div className="stage-strip">
                {peopleTiles.map((tile) => (
                  <VideoTile key={tile.key} tile={tile} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="call-stage">
            {tiles.map((tile) => (
              <VideoTile key={tile.key} tile={tile} />
            ))}
          </div>
        )}

        {/* The roster is the answer to "who is here and who is not". */}
        <aside className="call-roster" aria-label="Who is on the call">
          <p className="roster-head">In the call · {inCall.length || (status === "connected" ? 1 : 0)}</p>
          {inCall.length === 0 && status === "connected" && (
            <RosterRow name={me?.displayName ?? "You"} suffix="(you)" here muted={!micOn} />
          )}
          {inCall.map((u) => (
            <RosterRow
              key={u.id}
              name={u.displayName}
              suffix={u.id === me?.id ? "(you)" : undefined}
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
              <p className="roster-head">Not in the call · {away.length}</p>
              {away.map((u) => (
                <RosterRow key={u.id} name={u.displayName} />
              ))}
            </>
          )}
        </aside>
      </div>

      <div className="call-bar">
        <CallButton
          label={micOn ? "Mute" : "Unmute"}
          danger={!micOn}
          onClick={toggleMic}
          icon={micOn ? <IconMic /> : <IconMicOff />}
        />
        <CallButton
          label={camOn ? "Stop video" : "Start video"}
          danger={!camOn}
          onClick={toggleCam}
          icon={camOn ? <IconVideo /> : <IconVideoOff />}
        />
        <CallButton
          label={sharing ? "Stop sharing" : "Share screen"}
          active={sharing}
          onClick={toggleShare}
          disabled={!canShareScreen}
          title={
            canShareScreen
              ? undefined
              : "Screen sharing is not available on this device — Android's WebView cannot capture the screen."
          }
          icon={<IconScreen />}
        />
        <CallButton
          label="Devices"
          active={showDevices}
          onClick={() => setShowDevices((v) => !v)}
          icon={<IconSettings />}
        />
        <CallButton label="Leave" hangup onClick={onClose} icon={<IconHangup />} />
      </div>

      {showDevices && (
        <aside className="call-devices" aria-label="Audio and video devices">
          <header>
            <strong>Audio and video</strong>
            <button
              className="icon-btn"
              onClick={() => setShowDevices(false)}
              title="Close"
              aria-label="Close devices"
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

          {canShareScreen && (
          <div className="share-modes">
            <p className="settings-head">Screen sharing</p>
            {(Object.keys(SHARE_MODE_LABELS) as ShareMode[]).map((mode) => (
              <label key={mode} className="share-mode">
                <input
                  type="radio"
                  name="share-mode"
                  checked={shareMode === mode}
                  onChange={() => {
                    setShareMode(mode);
                    saveShareMode(mode);
                    if (sharing) {
                      setNotice("The new setting applies the next time you start sharing.");
                    }
                  }}
                />
                <span>
                  <strong>{SHARE_MODE_LABELS[mode].title}</strong>
                  <em>{SHARE_MODE_LABELS[mode].hint}</em>
                </span>
              </label>
            ))}
          </div>
          )}
        </aside>
      )}
    </div>
  );
}

function RosterRow({
  name, suffix, here, muted, speaking
}: {
  name: string; suffix?: string; here?: boolean; muted?: boolean; speaking?: boolean;
}) {
  return (
    <div className={`roster-row${here ? " here" : ""}${speaking ? " speaking" : ""}`}>
      <span className="roster-avatar">{initials(name)}</span>
      <span className="roster-name">
        {name} {suffix && <em>{suffix}</em>}
      </span>
      {here ? (
        muted ? (
          <span className="roster-state muted" title="Microphone off"><IconMicOff size={14} /></span>
        ) : (
          <span className="roster-state on" title="Microphone on"><IconMic size={14} /></span>
        )
      ) : (
        <span className="roster-state away">away</span>
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
  sinkId
}: {
  tracks: { id: string; track: Track }[];
  sinkId?: string;
}) {
  return (
    <div style={{ display: "none" }} aria-hidden="true">
      {tracks.map((t) => (
        <AudioSink key={t.id} track={t.track} sinkId={sinkId} />
      ))}
    </div>
  );
}

function AudioSink({ track, sinkId }: { track: Track; sinkId?: string }) {
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

function VideoTile({ tile }: { tile: Tile }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !tile.track) return;
    tile.track.attach(el);
    return () => {
      tile.track?.detach(el);
    };
  }, [tile.track]);

  const poor =
    tile.quality === ConnectionQuality.Poor || tile.quality === ConnectionQuality.Lost;

  return (
    <div className={`tile${tile.isScreen ? " screen" : ""}${tile.speaking ? " speaking" : ""}`}>
      {tile.track ? (
        <video ref={ref} autoPlay playsInline muted={tile.isLocal} />
      ) : (
        <div className="tile-avatar">{initials(tile.name)}</div>
      )}

      <span className="tile-name">
        {tile.muted && !tile.isScreen && (
          <span className="tile-muted" title="Microphone off">
            <IconMicOff size={13} />
          </span>
        )}
        {tile.name}
        {tile.isLocal && !tile.isScreen ? " (you)" : ""}
        {tile.isScreen ? " — screen" : ""}
      </span>

      {poor && !tile.isLocal && (
        <span className="tile-quality" title="Weak connection">
          <IconSignal size={14} />
        </span>
      )}
    </div>
  );
}
