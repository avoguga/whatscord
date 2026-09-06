import { useEffect, useRef, useState } from "react";
import {
  canChooseOutput,
  deviceLabel,
  resolveDeviceId,
  useDevices,
  type DeviceKind
} from "../lib/devices";
import { callSoundsEnabled, playCue, setCallSounds } from "../lib/sounds";
import { IconMic, IconSpeaker, IconVideo } from "./icons";

/**
 * Reads the loudness of a microphone track, 0..1, for the level meter.
 *
 * A list of device names does not tell anyone which one is actually picking up
 * their voice — several machines here report three microphones with names that
 * say nothing. Watching the bar move while you talk does tell you.
 */
function useMicLevel(track: MediaStreamTrack | null): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!track) {
      setLevel(0);
      return;
    }

    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    let raf = 0;
    let stopped = false;
    const ctx = new Ctor();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    void ctx.resume().catch(() => undefined);

    const tick = () => {
      if (stopped) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      // Speech sits low in a linear scale; the curve lifts it into a range
      // where the bar visibly reacts to a normal speaking voice.
      setLevel(Math.min(1, Math.pow(rms, 0.5) * 3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close().catch(() => undefined);
    };
  }, [track]);

  return level;
}

/**
 * The microphone, camera and speaker picker.
 *
 * Shown both in the account panel — so the choice can be made before ever
 * ringing anyone — and inside a live call, where switching has to take effect
 * without dropping the call.
 */
export function DevicePicker({
  micTrack,
  onSwitch,
  onNotice,
  onChange
}: {
  /**
   * The microphone already open in a call, if there is one, so the meter reads
   * the very track the other side hears.
   *
   * Passed in rather than pulled from a Room on purpose: importing livekit-client
   * here would drag the whole SDK — 1.4 MB of source — into the settings screen,
   * and from there into the first chunk the app loads.
   */
  micTrack?: MediaStreamTrack | null;
  /** Applies the choice to a live call. Absent outside a call. */
  onSwitch?: (kind: DeviceKind, deviceId: string) => Promise<void>;
  onNotice?: (text: string) => void;
  /** Lets the call follow the speaker choice without re-reading storage. */
  onChange?: (kind: DeviceKind, deviceId: string | undefined) => void;
}) {
  const { microphones, cameras, speakers, micBlocked, camBlocked, unsupported, prefs, error, reveal, choose } =
    useDevices();
  const [sounds, setSounds] = useState(() => callSoundsEnabled());
  const [busy, setBusy] = useState<DeviceKind | null>(null);
  const [probe, setProbe] = useState<MediaStream | null>(null);

  // Out of a call there is nothing to read until the person asks for it.
  const liveMic = micTrack ?? null;
  const probeMic = probe?.getAudioTracks()[0] ?? null;
  const level = useMicLevel(liveMic ?? probeMic);

  // A test stream must never outlive the panel that opened it.
  const probeRef = useRef<MediaStream | null>(null);
  probeRef.current = probe;
  useEffect(
    () => () => {
      probeRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  async function pick(kind: DeviceKind, deviceId: string) {
    const id = deviceId || undefined;
    choose(kind, id);
    onChange?.(kind, id);
    if (!onSwitch || !id) return;
    setBusy(kind);
    try {
      await onSwitch(kind, id);
    } catch {
      onNotice?.(
        kind === "audiooutput"
          ? "That speaker could not be used. The call is still on the previous one."
          : "That device could not be opened — it may be in use by another app."
      );
    } finally {
      setBusy(null);
    }
  }

  async function startProbe() {
    try {
      const wanted = resolveDeviceId(prefs.audioinput, microphones);
      setProbe(
        await navigator.mediaDevices.getUserMedia({
          audio: wanted ? { deviceId: { exact: wanted } } : true
        })
      );
    } catch {
      onNotice?.("The microphone could not be opened. Check the browser's permission.");
    }
  }

  function stopProbe() {
    probe?.getTracks().forEach((t) => t.stop());
    setProbe(null);
  }

  if (unsupported) {
    return (
      <p className="device-note">
        This browser cannot list audio and video devices, so the system default is used.
      </p>
    );
  }

  const testing = !!probe;

  return (
    <div className="device-picker">
      {error && <p className="device-note bad">{error}</p>}

      {(micBlocked || camBlocked) && (
        <div className="device-reveal">
          <p>
            {micBlocked && camBlocked
              ? "The browser hides your microphones and cameras until it has been given access once."
              : micBlocked
                ? "Your cameras are visible, but the microphone still needs permission — until then it cannot be picked."
                : "Your microphones are visible, but the camera still needs permission — until then it cannot be picked."}
          </p>
          <button className="btn-outline" onClick={() => void reveal()}>
            {micBlocked ? "Allow the microphone" : "Allow the camera"}
          </button>
        </div>
      )}

      <Row
        icon={<IconMic size={16} />}
        label="Microphone"
        kind="audioinput"
        devices={microphones}
        value={prefs.audioinput}
        busy={busy === "audioinput"}
        blocked={micBlocked}
        onPick={pick}
      />

      <div className="device-level" aria-hidden={!liveMic && !testing}>
        <span className="device-level-label">Input level</span>
        <div className="level-track">
          <div className="level-fill" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
        {liveMic ? (
          <span className="device-hint">Speak — the bar should move.</span>
        ) : testing ? (
          <button className="btn-ghost small" onClick={stopProbe}>
            Stop test
          </button>
        ) : (
          <button className="btn-ghost small" onClick={() => void startProbe()}>
            Test microphone
          </button>
        )}
      </div>

      <Row
        icon={<IconVideo size={16} />}
        label="Camera"
        kind="videoinput"
        devices={cameras}
        value={prefs.videoinput}
        busy={busy === "videoinput"}
        blocked={camBlocked}
        onPick={pick}
      />

      {canChooseOutput ? (
        <>
          <Row
            icon={<IconSpeaker size={16} />}
            label="Speaker"
            kind="audiooutput"
            devices={speakers}
            value={prefs.audiooutput}
            busy={busy === "audiooutput"}
            blocked={micBlocked}
            onPick={pick}
          />
          <button
            className="btn-ghost small"
            onClick={() => void playCue("join", resolveDeviceId(prefs.audiooutput, speakers), true)}
          >
            Play a test sound
          </button>
        </>
      ) : (
        <p className="device-note">
          This browser always uses the system's default speaker; change it in the operating
          system's sound settings.
        </p>
      )}

      <label className="device-toggle">
        <input
          type="checkbox"
          checked={sounds}
          onChange={(e) => {
            setSounds(e.target.checked);
            setCallSounds(e.target.checked);
          }}
        />
        <span>Play a sound when someone joins or leaves a call</span>
      </label>
    </div>
  );
}

function Row({
  icon,
  label,
  kind,
  devices,
  value,
  busy,
  blocked,
  onPick
}: {
  icon: React.ReactNode;
  label: string;
  kind: DeviceKind;
  devices: MediaDeviceInfo[];
  value: string | undefined;
  busy: boolean;
  /** Waiting on the browser's permission, as opposed to genuinely absent. */
  blocked: boolean;
  onPick: (kind: DeviceKind, deviceId: string) => void | Promise<void>;
}) {
  const id = `dev-${kind}`;
  /*
   * A saved id can point at hardware that is no longer here. Resolving it back
   * to "system default" keeps the select honest instead of showing a blank box
   * that silently means something else.
   */
  const current = resolveDeviceId(value, devices) ?? "";

  return (
    <div className="device-field">
      <label htmlFor={id}>
        <span className="device-icon">{icon}</span>
        {label}
      </label>
      <select
        id={id}
        value={current}
        disabled={busy || devices.length === 0}
        onChange={(e) => void onPick(kind, e.target.value)}
      >
        <option value="">
          {devices.length > 0
            ? "System default"
            : blocked
              ? "Waiting for permission"
              : `No ${label.toLowerCase()} found`}
        </option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {deviceLabel(d, i)}
          </option>
        ))}
      </select>
    </div>
  );
}
