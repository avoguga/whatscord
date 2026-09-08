/**
 * The two-note cues that say someone arrived or left a call.
 *
 * The tones are synthesised here rather than shipped as audio files. That keeps
 * a binary out of the repo, but the real reason is routing: a cue has to come
 * out of the speaker the person chose, and only a media element can be pointed
 * at a specific output with setSinkId. A WAV data URL feeds an <audio> element,
 * so the cue follows the same speaker as the call itself.
 *
 * Everything above `playCue` is pure and free of browser globals, so the
 * waveform can be checked without a browser.
 */

export type ToneStep = { freq: number; ms: number };

/** Rising for arrivals, falling for departures — the direction carries the meaning. */
export const CUES: Record<"join" | "leave", ToneStep[]> = {
  join: [
    { freq: 587.33, ms: 90 },
    { freq: 880.0, ms: 130 }
  ],
  leave: [
    { freq: 880.0, ms: 90 },
    { freq: 587.33, ms: 150 }
  ]
};

/**
 * Identidade sonora de uma conversa.
 *
 * A ideia não é "escolher um som bonito": é conseguir saber DE ONDE veio sem
 * olhar a tela. Com um timbre por grupo e por pessoa, o trabalho e o time de
 * futebol deixam de soar igual, e dá para ignorar um e atender o outro sem
 * trocar de janela.
 *
 * Por isso os timbres se distinguem pela ALTURA e pelo intervalo, não por
 * enfeite: agudo curto, médio, grave, e um arpejo. São diferenças que se
 * reconhecem de costas para o computador, que é o ponto.
 */
export type Timbre = "padrao" | "agudo" | "grave" | "arpejo" | "mudo";

export const TIMBRES: Timbre[] = ["padrao", "agudo", "grave", "arpejo", "mudo"];

export type TipoDeAviso = "join" | "leave" | "mensagem";

const VAZIO: ToneStep[] = [];

export const TOQUES: Record<Timbre, Record<TipoDeAviso, ToneStep[]>> = {
  padrao: {
    join: CUES.join,
    leave: CUES.leave,
    mensagem: [{ freq: 784.0, ms: 70 }, { freq: 1046.5, ms: 90 }]
  },
  agudo: {
    join: [{ freq: 987.77, ms: 70 }, { freq: 1318.51, ms: 110 }],
    leave: [{ freq: 1318.51, ms: 70 }, { freq: 987.77, ms: 130 }],
    mensagem: [{ freq: 1318.51, ms: 60 }, { freq: 1567.98, ms: 80 }]
  },
  grave: {
    join: [{ freq: 261.63, ms: 100 }, { freq: 392.0, ms: 150 }],
    leave: [{ freq: 392.0, ms: 100 }, { freq: 261.63, ms: 170 }],
    mensagem: [{ freq: 329.63, ms: 80 }, { freq: 440.0, ms: 110 }]
  },
  arpejo: {
    join: [{ freq: 523.25, ms: 60 }, { freq: 659.25, ms: 60 }, { freq: 783.99, ms: 120 }],
    leave: [{ freq: 783.99, ms: 60 }, { freq: 659.25, ms: 60 }, { freq: 523.25, ms: 140 }],
    mensagem: [{ freq: 659.25, ms: 55 }, { freq: 880.0, ms: 55 }, { freq: 1046.5, ms: 90 }]
  },
  /*
   * Silêncio de verdade, e não "volume zero": é a forma de dizer "esta conversa
   * não me interrompe" sem perder as mensagens. O silêncio vale para os três
   * tipos de aviso — não faria sentido silenciar a mensagem e continuar
   * anunciando quem entrou na chamada dali.
   */
  mudo: { join: VAZIO, leave: VAZIO, mensagem: VAZIO }
};

const TIMBRE_PREFIXO = "whatscord.timbre.";

export function ehTimbre(v: unknown): v is Timbre {
  return typeof v === "string" && (TIMBRES as string[]).includes(v);
}

/** O timbre escolhido para uma conversa, ou `null` quando segue o padrão. */
export function timbreDaSala(roomId: string): Timbre | null {
  try {
    const v = localStorage.getItem(TIMBRE_PREFIXO + roomId);
    return ehTimbre(v) ? v : null;
  } catch {
    return null;
  }
}

export function salvarTimbreDaSala(roomId: string, timbre: Timbre | null): void {
  try {
    if (timbre === null) localStorage.removeItem(TIMBRE_PREFIXO + roomId);
    else localStorage.setItem(TIMBRE_PREFIXO + roomId, timbre);
  } catch {
    /* a escolha só não sobrevive à aba */
  }
}

const RATE = 44100;

/**
 * Renders the steps to mono samples in -1..1.
 *
 * Each step gets a short fade in and a fade out to silence. Without them the
 * waveform would start and stop mid-cycle, and the step change would be heard
 * as a click louder than the note itself.
 */
export function renderTone(steps: ToneStep[], rate = RATE): Float32Array {
  const total = steps.reduce((n, s) => n + Math.round((s.ms / 1000) * rate), 0);
  const out = new Float32Array(total);

  let at = 0;
  for (const step of steps) {
    const len = Math.round((step.ms / 1000) * rate);
    const fade = Math.min(Math.round(0.008 * rate), Math.floor(len / 2));
    for (let i = 0; i < len; i++) {
      const attack = i < fade ? i / fade : 1;
      const release = i > len - fade ? (len - i) / fade : 1;
      // Kept well below full scale: a notification that makes people flinch
      // gets muted, and then it stops doing its job.
      const gain = 0.22 * attack * release;
      out[at + i] = Math.sin((2 * Math.PI * step.freq * i) / rate) * gain;
    }
    at += len;
  }
  return out;
}

/** Wraps mono samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, rate = RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);

  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // format: uncompressed PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  // One character at a time in chunks: spreading 20k arguments into
  // String.fromCharCode overflows the call stack in some engines.
  let binary = "";
  const CHUNK = 0x2000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function cueDataUrl(kind: "join" | "leave"): string {
  return toDataUrl(CUES[kind]);
}

/** Um WAV pronto para um `<audio>`, a partir de qualquer sequência de notas. */
export function toDataUrl(passos: ToneStep[]): string {
  return `data:audio/wav;base64,${toBase64(encodeWav(renderTone(passos)))}`;
}

const SOUND_KEY = "whatscord.callSounds";

export function callSoundsEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setCallSounds(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* the preference just will not outlive the tab */
  }
}

/** Elements are reused so the WAV is decoded once, not on every arrival. */
const players = new Map<string, HTMLAudioElement>();

function playerFor(timbre: Timbre, tipo: TipoDeAviso): HTMLAudioElement | null {
  const passos = TOQUES[timbre][tipo];
  // Timbre mudo não tem forma de onda; devolver um elemento vazio faria um
  // `play()` inútil a cada mensagem.
  if (passos.length === 0) return null;

  const chave = `${timbre}:${tipo}`;
  let el = players.get(chave);
  if (!el) {
    el = new Audio(toDataUrl(passos));
    el.preload = "auto";
    players.set(chave, el);
  }
  return el;
}

/**
 * Plays a cue on the chosen speaker.
 *
 * `force` is for the "test sound" button, which has to work even when cues are
 * switched off — that is how someone checks the speaker they just picked.
 */
export async function playCue(
  kind: TipoDeAviso,
  sinkId?: string,
  force = false,
  /*
   * A conversa de onde o aviso veio. Sem ela cai no timbre padrão — que é o
   * caso de quase todo aviso, e por isso o parâmetro é o último e opcional.
   */
  roomId?: string
): Promise<void> {
  if (!force && !callSoundsEnabled()) return;
  try {
    const timbre = (roomId ? timbreDaSala(roomId) : null) ?? "padrao";
    const el = playerFor(timbre, kind);
    if (!el) return;
    const sinkable = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (sinkId && sinkable.setSinkId) {
      await sinkable.setSinkId(sinkId).catch(() => undefined);
    }
    el.currentTime = 0;
    await el.play();
  } catch {
    // Autoplay policy can refuse before the first interaction, and a cue is
    // never worth surfacing an error for.
  }
}
