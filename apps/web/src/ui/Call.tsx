import { useEffect, useMemo, useRef, useState } from "react";
import {
  ConnectionQuality,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication
} from "livekit-client";
import { api } from "../lib/api";
import { useStore, type User } from "../store";
import { getSocket } from "../lib/socket";
import { initials } from "../lib/format";
import {
  IconMic, IconMicOff, IconVideo, IconVideoOff, IconScreen,
  IconHangup, IconMinimize, IconSignal, IconSpeaker
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

  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
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

  const [revision, setRevision] = useState(0);
  const bump = () => setRevision((n) => n + 1);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

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
          .on(RoomEvent.ParticipantConnected, () => bump())
          .on(RoomEvent.ParticipantDisconnected, () => bump())
          .on(RoomEvent.LocalTrackPublished, () => bump())
          .on(RoomEvent.LocalTrackUnpublished, () => bump())
          .on(RoomEvent.TrackMuted, () => bump())
          .on(RoomEvent.TrackUnmuted, () => bump())
          .on(RoomEvent.ConnectionQualityChanged, () => bump())
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
  }, [roomId, withVideo, room]);

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
    try {
      await room.localParticipant.setScreenShareEnabled(!sharing, { audio: true });
      setSharing(!sharing);
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
        <RemoteAudio tracks={audioTracks} />
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
      <RemoteAudio tracks={audioTracks} />

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

      <div className="call-body">
        <div className="call-stage">
          {tiles.length === 0 ? (
            <div className="call-empty">
              <div className="tile-avatar">{initials(me?.displayName ?? "?")}</div>
              <p>{status === "connected" ? "You are connected." : statusLabel}</p>
              <p className="dim">
                {status === "connected"
                  ? "Nobody else has joined yet. They will see this call in the conversation."
                  : "Hold on while the connection is set up."}
              </p>
            </div>
          ) : (
            tiles.map((tile) => <VideoTile key={tile.key} tile={tile} />)
          )}
        </div>

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
          icon={<IconScreen />}
        />
        <CallButton label="Leave" hangup onClick={onClose} icon={<IconHangup />} />
      </div>
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
  label, icon, onClick, danger, active, hangup
}: {
  label: string; icon: React.ReactNode; onClick: () => void;
  danger?: boolean; active?: boolean; hangup?: boolean;
}) {
  const cls = ["call-btn", danger ? "off" : "", active ? "on" : "", hangup ? "hangup" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button className="call-ctl" onClick={onClick} title={label}>
      <span className={cls}>{icon}</span>
      <span className="call-ctl-label">{label}</span>
    </button>
  );
}

/**
 * Remote audio needs a real element to come out of. LiveKit does not create
 * one — without this the call connects, tiles render, and nobody hears anybody.
 */
function RemoteAudio({ tracks }: { tracks: { id: string; track: Track }[] }) {
  return (
    <div style={{ display: "none" }} aria-hidden="true">
      {tracks.map((t) => (
        <AudioSink key={t.id} track={t.track} />
      ))}
    </div>
  );
}

function AudioSink({ track }: { track: Track }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
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
