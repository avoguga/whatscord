import { useCallback, useEffect, useState } from "react";

/**
 * Which microphone, camera and speaker this machine should use.
 *
 * These are a property of the hardware in front of the person, not of the
 * account, so they live in localStorage and deliberately survive signing out:
 * plugging in a headset once should not have to be redone for every login, and
 * two accounts in two tabs on the same machine want the same headset.
 */

export type DeviceKind = "audioinput" | "videoinput" | "audiooutput";

export type DevicePrefs = {
  audioinput?: string;
  videoinput?: string;
  audiooutput?: string;
};

const KEY = "whatscord.devices";

/** Firefox has no setSinkId, so picking an output is not offered there. */
export const canChooseOutput =
  typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

export function loadDevicePrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DevicePrefs;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Private mode can refuse localStorage, and a half-written value should
    // never be the reason a call will not start.
    return {};
  }
}

export function saveDevicePrefs(prefs: DevicePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* nothing to do — the choice just will not outlive the tab */
  }
}

export function setDevicePref(kind: DeviceKind, deviceId: string | undefined): DevicePrefs {
  const next = { ...loadDevicePrefs() };
  if (deviceId) next[kind] = deviceId;
  else delete next[kind];
  saveDevicePrefs(next);
  return next;
}

/**
 * The device to actually use, given what was saved and what is plugged in now.
 *
 * A saved id can outlive the hardware — the headset gets unplugged, the browser
 * is reinstalled, or the person is on another machine sharing the same profile.
 * Falling back to the system default is always better than failing to open a
 * device, so a stale id is treated as "no preference" rather than an error.
 *
 * Kept free of browser globals so it can be tested directly.
 */
export function resolveDeviceId(
  saved: string | undefined,
  available: Pick<MediaDeviceInfo, "deviceId">[]
): string | undefined {
  if (!saved) return undefined;
  if (saved === "default") return "default";
  return available.some((d) => d.deviceId === saved) ? saved : undefined;
}

/**
 * Drops the placeholder entries the browser reports before permission.
 *
 * Chrome does not return an empty list when access has not been granted: it
 * returns one entry per kind with an empty id and an empty name. Offering those
 * in the list is worse than useless — picking one selects nothing, silently,
 * which reads as the app ignoring the choice.
 */
export function selectableDevices<T extends Pick<MediaDeviceInfo, "deviceId">>(list: T[]): T[] {
  return list.filter((d) => !!d.deviceId);
}

/**
 * Whether this *kind* of device is still waiting on permission.
 *
 * Asked per kind on purpose. Camera and microphone are granted separately, and
 * a machine that allowed the camera but not the microphone was showing no
 * prompt at all while the microphone stayed unusable — the browser had handed
 * us named cameras, and a single global "do we have labels" check believed it.
 */
export function needsPermission(raw: Pick<MediaDeviceInfo, "label">[]): boolean {
  return raw.length > 0 && !raw.some((d) => !!d.label);
}

/**
 * A readable name for a device, even before permission reveals the real one.
 *
 * Unlabelled devices all come back as "" — numbering them at least lets someone
 * tell "the second microphone" from the first while they decide whether to
 * grant access.
 */
export function deviceLabel(device: Pick<MediaDeviceInfo, "label" | "kind">, index: number): string {
  if (device.label) return device.label;
  const noun =
    device.kind === "audioinput" ? "Microphone"
    : device.kind === "videoinput" ? "Camera"
    : "Speaker";
  return `${noun} ${index + 1}`;
}

export type DeviceState = {
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
  /** Kinds still waiting on the browser's permission prompt. */
  micBlocked: boolean;
  camBlocked: boolean;
  /** enumerateDevices is unavailable (very old browser, or insecure origin). */
  unsupported: boolean;
  prefs: DevicePrefs;
  error: string | null;
  refresh: () => Promise<void>;
  /** Ask for camera/mic access purely to unlock the device names. */
  reveal: () => Promise<void>;
  choose: (kind: DeviceKind, deviceId: string | undefined) => void;
};

export function useDevices(): DeviceState {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [prefs, setPrefs] = useState<DevicePrefs>(() => loadDevicePrefs());
  const [error, setError] = useState<string | null>(null);
  const unsupported =
    typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices;

  const refresh = useCallback(async () => {
    if (unsupported) return;
    try {
      setDevices(await navigator.mediaDevices.enumerateDevices());
      setError(null);
    } catch {
      setError("The list of devices could not be read.");
    }
  }, [unsupported]);

  const reveal = useCallback(async () => {
    if (unsupported) return;
    let stream: MediaStream | undefined;
    try {
      // Ask for both, but settle for whichever is granted: a machine with a
      // microphone and no camera must still get its microphone named.
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Access was denied, so the device names stay hidden. Allow the microphone in the browser to pick a specific one."
          : "No microphone or camera could be opened."
      );
    } finally {
      // The stream existed only to unlock the labels — holding it would leave
      // the recording indicator lit for no reason.
      stream?.getTracks().forEach((t) => t.stop());
      await refresh();
    }
  }, [refresh, unsupported]);

  useEffect(() => {
    void refresh();
    if (unsupported) return;
    const onChange = () => void refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", onChange);
  }, [refresh, unsupported]);

  const choose = useCallback((kind: DeviceKind, deviceId: string | undefined) => {
    setPrefs(setDevicePref(kind, deviceId));
  }, []);

  const rawMics = devices.filter((d) => d.kind === "audioinput");
  const rawCams = devices.filter((d) => d.kind === "videoinput");
  const rawSpeakers = devices.filter((d) => d.kind === "audiooutput");

  return {
    microphones: selectableDevices(rawMics),
    cameras: selectableDevices(rawCams),
    speakers: selectableDevices(rawSpeakers),
    micBlocked: needsPermission(rawMics),
    camBlocked: needsPermission(rawCams),
    unsupported,
    prefs,
    error,
    refresh,
    reveal,
    choose
  };
}
