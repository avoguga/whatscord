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
import { useStore } from "../store";
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
  /** The browser refused to autoplay audio until the page is clicked. */
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [speakers, setSpeakers] = useState<Set<string>>(new Set());

  /*
   * LiveKit's participant list lives outside React, so a track arriving has to
   * be turned into a render by hand. This has to be the state VALUE, not the
   * setter: a setter is stable by contract, so listing it as a dependency does
   * nothing and the tile list silently never recomputes.
   */
  const [revision, setRevision] = useState(0);
  const bump = () => setRevision((n) => n + 1);

  /*
   * `onClose` is an inline arrow in the parent, so it is a new function on every
   * render of App. Depending on it re-ran this effect, whose cleanup calls
   * room.disconnect() — which fires Disconnected, which calls onClose. The call
   * hung itself up whenever anything else re-rendered.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

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
          // Someone muting is a state change with no track event of its own.
          .on(RoomEvent.TrackMuted, () => bump())
          .on(RoomEvent.TrackUnmuted, () => bump())
          .on(RoomEvent.ConnectionQualityChanged, () => bump())
          .on(RoomEvent.ActiveSpeakersChanged, (list: Participant[]) => {
            setSpeakers(new Set(list.map((p) => p.identity)));
          })
          // Browsers refuse to play audio before the page is interacted with.
          .on(RoomEvent.AudioPlaybackStatusChanged, () => {
            setAudioBlocked(!room.canPlaybackAudio);
          })
          .on(RoomEvent.Disconnected, () => {
            setStatus("failed");
            onCloseRef.current();
          })
          .on(RoomEvent.Reconnecting, () => setStatus("reconnecting"))
          .on(RoomEvent.Reconnected, () => setStatus("connected"));

        await room.connect(res.url, res.token);
        if (cancelled) return;
        setStatus("connected");
        setAudioBlocked(!room.canPlaybackAudio);

        /*
         * Publishing is best effort. A blocked, missing or busy microphone used
         * to reject here and abort the whole join — leaving someone who only
         * wanted to listen unable to enter the call at all.
         */
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch {
          setMicOn(false);
          setNotice("No microphone. You can hear everyone, but they cannot hear you.");
        }

        if (withVideo) {
          try {
            await room.localParticipant.setCameraEnabled(true);
          } catch {
            setCamOn(false);
            setNotice("No camera available. You joined with audio only.");
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

  /** Every remote audio track that needs an element to come out of. */
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

  const tiles = useMemo<Tile[]>(() => {
    const out: Tile[] = [];

    const push = (participant: Participant, isLocal: boolean) => {
      const pubs = [...participant.trackPublications.values()] as TrackPublication[];
      const screen = pubs.find((p) => p.source === Track.Source.ScreenShare && p.track);
      const cam = pubs.find((p) => p.source === Track.Source.Camera && p.track);
      const mic = pubs.find((p) => p.source === Track.Source.Microphone);
      const muted = !mic || mic.isMuted;
      const name = participant.name || participant.identity;

      if (screen?.track) {
        out.push({
          key: `${participant.identity}-screen`,
          participantId: participant.identity,
          name,
          track: screen.track,
          isScreen: true,
          isLocal,
          muted,
          quality: participant.connectionQuality
        });
      }
      out.push({
        key: `${participant.identity}-cam`,
        participantId: participant.identity,
        name,
        track: cam?.track ?? null,
        isScreen: false,
        isLocal,
        muted,
        quality: participant.connectionQuality
      });
    };

    push(room.localParticipant, true);
    room.remoteParticipants.forEach((p) => push(p, false));

    // A shared screen is the thing everyone is looking at — it goes first.
    return out.sort((a, b) => Number(b.isScreen) - Number(a.isScreen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, status, sharing, camOn, micOn, revision]);

  const peopleCount = room.remoteParticipants.size + 1;
  const alone = peopleCount === 1;

  async function toggleMic() {
    const next = !micOn;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
      setNotice(null);
    } catch {
      setNotice("Your microphone could not be turned on. Check the browser's permission.");
    }
    bump();
  }

  async function toggleCam() {
    const next = !camOn;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCamOn(next);
      setNotice(null);
    } catch {
      setNotice("Your camera could not be turned on. Check the browser's permission.");
    }
    bump();
  }

  /**
   * Screen sharing. Inside the Tauri webview this goes through WebView2's own
   * picker — Chromium handles the dialog, and there is no way to replace it.
   * `audio: true` asks for the sound of what is on screen; the LiveKit token
   * has to carry the screen_share_audio grant or it is dropped silently.
   */
  async function toggleShare() {
    try {
      const next = !sharing;
      await room.localParticipant.setScreenShareEnabled(next, { audio: true });
      setSharing(next);
      bump();
    } catch (err) {
      // Dismissing the picker throws too — that is not an error worth showing.
      if (err instanceof Error && err.name !== "NotAllowedError") {
        setNotice("Screen sharing could not start.");
      }
    }
  }

  const statusLabel =
    status === "connecting"
      ? "Connecting…"
      : status === "reconnecting"
        ? "Reconnecting…"
        : status === "failed"
          ? "Could not connect"
          : alone
            ? "Waiting for someone to join"
            : `${peopleCount} on the call`;

  // Minimised: the call keeps running, the conversation comes back into view.
  if (minimized) {
    return (
      <>
        <RemoteAudio tracks={audioTracks} />
        <div className="call-ribbon" role="status">
          <span className="live-dot" aria-hidden="true" />
          <span>
            <b>{callName}</b> · {statusLabel}
          </span>
          <button onClick={() => setMinimized(false)}>Back to the call</button>
          <button
            className="ribbon-hangup"
            onClick={onClose}
            title="Leave the call"
          >
            Leave
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="call-sheet">
      <RemoteAudio tracks={audioTracks} />

      <header className="call-top">
        <button
          className="icon-btn"
          onClick={() => setMinimized(true)}
          title="Minimise — the call keeps running"
        >
          <IconMinimize />
        </button>
        <div className="call-top-title">
          <strong>{callName}</strong>
          <span className={status === "failed" ? "bad" : undefined}>{statusLabel}</span>
        </div>
        <span className="call-count" title="People on the call">
          {peopleCount}
        </span>
      </header>

      {audioBlocked && (
        <button className="call-banner" onClick={() => room.startAudio()}>
          <IconSpeaker /> Sound is blocked by the browser. Click to turn it on.
        </button>
      )}
      {error && <div className="call-banner bad">{error}</div>}
      {notice && !error && <div className="call-banner">{notice}</div>}

      <div className="call-stage">
        {alone && status === "connected" && (
          <div className="call-alone">
            <p>You are the only one here.</p>
            <p className="dim">
              They will see the call in the conversation. Your microphone is
              {micOn ? " on" : " off"}.
            </p>
          </div>
        )}
        {tiles.map((tile) => (
          <VideoTile
            key={tile.key}
            tile={tile}
            speaking={speakers.has(tile.participantId) && !tile.muted}
          />
        ))}
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

/**
 * A control is an icon plus a word.
 *
 * Icon-only controls were the single biggest source of confusion here, and the
 * two states were drawn with the same white highlight for opposite meanings —
 * white meant "muted" on one button and "camera on" on the next. Red now means
 * one thing everywhere: this is off.
 */
function CallButton({
  label, icon, onClick, danger, active, hangup
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
  hangup?: boolean;
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
 * Remote audio needs a real element to come out of.
 *
 * LiveKit does not create one: `Room.startAudio()` only replays tracks that are
 * already attached to something the app made. Without this component the call
 * connects, the tiles render, and nobody hears anybody.
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

function VideoTile({ tile, speaking }: { tile: Tile; speaking: boolean }) {
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
    <div className={`tile${tile.isScreen ? " screen" : ""}${speaking ? " speaking" : ""}`}>
      {tile.track ? (
        // The local preview is always muted: hearing yourself is feedback.
        <video ref={ref} autoPlay playsInline muted={tile.isLocal} />
      ) : (
        <div className="tile-avatar">{initials(tile.name)}</div>
      )}

      <span className="tile-name">
        {/* Muted is the state people most need to see: it is the difference
            between someone being quiet and someone shouting into a dead mic. */}
        {tile.muted && !tile.isScreen && (
          <span className="tile-muted" title="Microphone off">
            <IconMicOff size={13} />
          </span>
        )}
        {tile.name}
        {tile.isLocal && !tile.isScreen ? " (you)" : ""}
        {tile.isScreen ? " — screen" : ""}
      </span>

      {/* Connection quality only shows when it is bad. A green bar on everyone
          is noise; a yellow one on the person breaking up is information. */}
      {poor && !tile.isLocal && (
        <span className="tile-quality" title="Weak connection">
          <IconSignal size={14} />
        </span>
      )}
    </div>
  );
}
