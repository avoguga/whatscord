import { useEffect, useMemo, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type Participant,
  type TrackPublication
} from "livekit-client";
import { api } from "../lib/api";
import { useStore } from "../store";
import { getSocket } from "../lib/socket";
import { initials } from "../lib/format";
import { IconMic, IconMicOff, IconVideo, IconScreen, IconHangup, IconClose } from "./icons";

type Tile = {
  key: string;
  participantId: string;
  name: string;
  track: Track | null;
  isScreen: boolean;
  isLocal: boolean;
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

  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [status, setStatus] = useState("Connecting…");
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(withVideo);
  const [sharing, setSharing] = useState(false);
  const [speakers, setSpeakers] = useState<Set<string>>(new Set());
  const [, forceRender] = useState(0);
  const bump = () => forceRender((n) => n + 1);

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
          .on(RoomEvent.ActiveSpeakersChanged, (list: Participant[]) => {
            setSpeakers(new Set(list.map((p) => p.identity)));
          })
          .on(RoomEvent.Disconnected, () => {
            setStatus("Call ended");
            onClose();
          })
          .on(RoomEvent.Reconnecting, () => setStatus("Reconnecting…"))
          .on(RoomEvent.Reconnected, () => setStatus("Connected"));

        await room.connect(res.url, res.token);
        if (cancelled) return;

        await room.localParticipant.setMicrophoneEnabled(true);
        if (withVideo) await room.localParticipant.setCameraEnabled(true);
        setStatus("Connected");
        bump();
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "The call could not connect. Check that the server is reachable."
        );
        setStatus("Not connected");
      }
    })();

    return () => {
      cancelled = true;
      getSocket()?.emit("call:leave", { roomId });
      room.disconnect().catch(() => undefined);
    };
  }, [roomId, withVideo, room, onClose]);

  const tiles = useMemo<Tile[]>(() => {
    const out: Tile[] = [];

    const push = (participant: Participant, isLocal: boolean) => {
      const pubs = [...participant.trackPublications.values()] as TrackPublication[];
      const screen = pubs.find((p) => p.source === Track.Source.ScreenShare && p.track);
      const cam = pubs.find((p) => p.source === Track.Source.Camera && p.track);

      if (screen?.track) {
        out.push({
          key: `${participant.identity}-screen`,
          participantId: participant.identity,
          name: `${participant.name || participant.identity} — screen`,
          track: screen.track,
          isScreen: true,
          isLocal
        });
      }
      out.push({
        key: `${participant.identity}-cam`,
        participantId: participant.identity,
        name: participant.name || participant.identity,
        track: cam?.track ?? null,
        isScreen: false,
        isLocal
      });
    };

    push(room.localParticipant, true);
    room.remoteParticipants.forEach((p) => push(p, false));

    // A shared screen is the thing everyone is looking at — it goes first.
    return out.sort((a, b) => Number(b.isScreen) - Number(a.isScreen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, status, sharing, camOn, micOn, forceRender]);

  async function toggleMic() {
    const next = !micOn;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }

  async function toggleCam() {
    const next = !camOn;
    await room.localParticipant.setCameraEnabled(next);
    setCamOn(next);
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
      // The user dismissing the picker throws too — that is not an error worth showing.
      if (err instanceof Error && err.name !== "NotAllowedError") {
        setError("Screen sharing could not start.");
      }
    }
  }

  return (
    <div className="call-sheet">
      <div className="call-status">
        {error ?? `${roomMeta?.name ?? roomMeta?.counterpart?.displayName ?? "Call"} · ${status}`}
      </div>

      <div className="call-stage">
        {tiles.map((tile) => (
          <VideoTile key={tile.key} tile={tile} speaking={speakers.has(tile.participantId)} />
        ))}
      </div>

      <div className="call-bar">
        <button className="call-btn" aria-pressed={!micOn} onClick={toggleMic} title={micOn ? "Mute" : "Unmute"}>
          {micOn ? <IconMic /> : <IconMicOff />}
        </button>
        <button className="call-btn" aria-pressed={camOn} onClick={toggleCam} title={camOn ? "Turn camera off" : "Turn camera on"}>
          <IconVideo />
        </button>
        <button
          className={`call-btn${sharing ? " sharing" : ""}`}
          onClick={toggleShare}
          title={sharing ? "Stop sharing" : "Share your screen"}
        >
          <IconScreen />
        </button>
        <button className="call-btn hangup" onClick={onClose} title="Leave the call">
          <IconHangup />
        </button>
      </div>

      <button
        className="icon-btn"
        style={{ position: "absolute", top: 10, right: 12 }}
        onClick={onClose}
        title="Back to the conversation"
      >
        <IconClose />
      </button>
    </div>
  );
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

  return (
    <div className={`tile${tile.isScreen ? " screen" : ""}${speaking ? " speaking" : ""}`}>
      {tile.track ? (
        <video ref={ref} autoPlay playsInline muted={tile.isLocal} />
      ) : (
        <div className="tile-avatar">{initials(tile.name)}</div>
      )}
      <span className="tile-name">
        {tile.name}
        {tile.isLocal && !tile.isScreen ? " (you)" : ""}
      </span>
    </div>
  );
}
