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

/* ------------------------------------------------------------------------ *
 * Virar a câmera (frontal ⇄ traseira)
 * ------------------------------------------------------------------------ */

export type FacingMode = "user" | "environment";

/** O outro lado. Só há dois, e virar duas vezes tem de voltar ao começo. */
export function proximoFacingMode(atual: FacingMode): FacingMode {
  return atual === "user" ? "environment" : "user";
}

/**
 * Que lado um rótulo de câmera anuncia, se anunciar algum.
 *
 * O Android nomeia "camera2 0, facing back"; o iOS, "Front Camera"/"Back Dual
 * Wide Camera". Uma webcam de mesa não fala de lado nenhum — ela não tem lado.
 * Por isso este é um sinal POSITIVO de aparelho de mão, e não um palpite sobre
 * o user-agent.
 *
 * "user"/"environment" de propósito NÃO entram na busca: são valores da API,
 * não palavras de rótulo, e "user" apareceria dentro de nomes como
 * "User's Webcam".
 */
export function facingDoRotulo(label: string | undefined): FacingMode | null {
  const l = (label ?? "").toLowerCase();
  if (/\b(front|frontal|selfie|delantera)\b/.test(l)) return "user";
  if (/\b(back|rear|traseira|trasera|posterior)\b/.test(l)) return "environment";
  return null;
}

/**
 * Se a troca de câmera aqui deve pedir `facingMode` em vez de `deviceId`.
 *
 * CRITÉRIO, e por que ele e não o user-agent: um user-agent é uma string que
 * qualquer navegador pode mentir, e a WebView do Tauri no Android nem se
 * apresenta como um telefone. O que decide de verdade é se dá para escolher uma
 * câmera POR IDENTIDADE. Então olhamos o que `enumerateDevices` devolveu:
 *
 *  a) alguma câmera sem `deviceId` — não há id para passar ao
 *     `switchActiveDevice`, então só resta descrever o lado;
 *  b) mais de uma câmera e NENHUMA com rótulo, mesmo já tendo id (o id só
 *     aparece depois da permissão, então id sem nome quer dizer que a
 *     plataforma se recusa a nomear — é o caso da WebView do Android);
 *  c) algum rótulo que anuncia o lado ("facing back", "Front Camera") — o
 *     próprio aparelho está dizendo que as câmeras diferem pelo lado.
 *
 * E, em todos os casos, é preciso haver MAIS DE UMA câmera: com uma só não há
 * para onde virar, e o botão seria um controle morto.
 *
 * O caso (b) pode dar falso positivo num navegador de mesa que esconda rótulos
 * (Firefox com anti-impressão-digital, por exemplo). Aceitamos: quem tem duas
 * webcams sem nome também não conseguiria escolher pelo seletor, e a troca cai
 * no plano B por `deviceId` se o `facingMode` não pegar.
 *
 * Recebe a lista CRUA, antes de `selectableDevices`: é justamente a entrada sem
 * `deviceId` que o critério (a) precisa enxergar.
 */
export function deveUsarFacingMode(
  cameras: Pick<MediaDeviceInfo, "deviceId" | "label">[]
): boolean {
  if (cameras.length < 2) return false;
  const semId = cameras.some((c) => !c.deviceId);
  const semRotulo = cameras.every((c) => !c.label);
  const anunciaLado = cameras.some((c) => facingDoRotulo(c.label) !== null);
  return semId || semRotulo || anunciaLado;
}

/**
 * Plano B: qual `deviceId` tentar quando o `facingMode` não deu certo.
 *
 * Primeiro a câmera cujo rótulo anuncia o lado pedido. Sem rótulo que ajude,
 * qualquer outra que não seja a de agora — em aparelho de duas câmeras "a
 * outra" é exatamente a certa, e em aparelho de três é ao menos uma mudança
 * visível, que a pessoa pode repetir até chegar onde quer.
 */
export function cameraParaFacing(
  cameras: Pick<MediaDeviceInfo, "deviceId" | "label">[],
  alvo: FacingMode,
  atualId?: string
): string | undefined {
  const usaveis = cameras.filter((c) => !!c.deviceId);
  const peloRotulo = usaveis.find((c) => facingDoRotulo(c.label) === alvo);
  if (peloRotulo) return peloRotulo.deviceId;
  return usaveis.find((c) => c.deviceId !== atualId)?.deviceId;
}

/**
 * Se a câmera realmente mudou depois de um `restartTrack`.
 *
 * ARMADILHA MEDIDA NO SDK: `restartTrack({ facingMode })` não chega ao navegador
 * como uma exigência. O `constraintsForOptions` do livekit-client injeta
 * `deviceId ??= { ideal: "default" }` e o `facingMode` vai como valor nu — os
 * dois são "ideal", não "exact". Ou seja: a promessa resolve com sucesso mesmo
 * quando o navegador devolveu a MESMA câmera. Sem esta checagem, o plano B
 * nunca rodaria nos aparelhos em que ele é necessário.
 *
 * Quando não dá para saber (nenhuma das duas pistas veio), respondemos que
 * mudou: reabrir a câmera à toa é pior do que não confirmar.
 */
export function trocouDeCamera(
  antes: { deviceId?: string; facingMode?: string },
  depois: { deviceId?: string; facingMode?: string },
  alvo: FacingMode
): boolean {
  if (depois.facingMode === "user" || depois.facingMode === "environment") {
    return depois.facingMode === alvo;
  }
  if (antes.deviceId && depois.deviceId) return antes.deviceId !== depois.deviceId;
  return true;
}

export type DeviceState = {
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  /**
   * As câmeras como o navegador as devolveu, placeholders inclusive.
   *
   * `deveUsarFacingMode` precisa ver a entrada sem `deviceId` que
   * `selectableDevices` joga fora — é ela que denuncia a plataforma em que a
   * troca por id não funciona.
   */
  rawCameras: MediaDeviceInfo[];
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
    rawCameras: rawCams,
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
