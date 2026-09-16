import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  canChooseOutput,
  deviceLabel,
  loadDevicePrefs,
  pedirPermissaoAdianta,
  resolveDeviceId,
  saveDevicePrefs,
  useDevices,
  type DeviceKind
} from "../lib/devices";
import { callSoundsEnabled, playCue, setCallSounds } from "../lib/sounds";
import { suportaAvancada, supressaoOuPadrao, type Supressao } from "../lib/ruido";
import { canShareScreen, loadQualidade, saveQualidade, type Qualidade } from "../lib/screenshare";
import { QualidadeDeTela } from "./ShareQuality";
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
  onChange,
  onNoise
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
  /** Aplica a supressao de ruido a uma chamada em andamento. Ausente fora dela. */
  onNoise?: (s: Supressao) => Promise<void>;
}) {
  const { microphones, cameras, speakers, micBlocked, camBlocked, unsupported, prefs, error, refresh, reveal, choose } =
    useDevices();
  /*
   * Uma track de microfone viva prova que a permissão existe. Com ela em mãos,
   * pedir de novo não muda nada — e o botão que promete resolver vira uma
   * promessa vazia.
   */
  const adiantaPedir = pedirPermissaoAdianta(true, Boolean(micTrack));
  const { t } = useLingui();
  const [sounds, setSounds] = useState(() => callSoundsEnabled());
  const [qualidade, setQualidade] = useState<Qualidade>(() => loadQualidade());
  const [supressao, setSupressao] = useState<Supressao>(() =>
    supressaoOuPadrao(loadDevicePrefs().noise)
  );
  const [aplicandoRuido, setAplicandoRuido] = useState(false);
  const avancadaDisponivel = suportaAvancada();

  async function escolherSupressao(s: Supressao) {
    setSupressao(s);
    saveDevicePrefs({ ...loadDevicePrefs(), noise: s });
    if (!onNoise) return;
    setAplicandoRuido(true);
    try {
      await onNoise(s);
    } catch {
      onNotice?.(t`The noise suppression could not be changed. Try again.`);
    } finally {
      setAplicandoRuido(false);
    }
  }

  /*
   * Relê a lista quando o microfone da chamada aparece.
   *
   * A primeira leitura pode ter acontecido antes de a chamada abrir o
   * microfone, e nesse instante o navegador ainda escondia os nomes. Sem esta
   * releitura, a tela ficaria mostrando a lista velha — vazia — mesmo depois de
   * a permissão passar a existir.
   */
  useEffect(() => {
    if (micTrack) void refresh();
  }, [micTrack, refresh]);
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
          ? t`That speaker could not be used. The call is still on the previous one.`
          : t`That device could not be opened — it may be in use by another app.`
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

      {(micBlocked || camBlocked) && adiantaPedir && (
        <div className="device-reveal">
          <p>
            {micBlocked && camBlocked
              ? t`The browser hides your microphones and cameras until it has been given access once.`
              : micBlocked
                ? t`Your cameras are visible, but the microphone still needs permission — until then it cannot be picked.`
                : t`Your microphones are visible, but the camera still needs permission — until then it cannot be picked.`}
          </p>
          <button className="btn-outline" onClick={() => void reveal()}>
            {micBlocked && camBlocked
              ? t`Allow microphone and camera`
              : micBlocked
                ? t`Allow the microphone`
                : t`Allow the camera`}
          </button>
        </div>
      )}

      {/*
        Microfone aberto e dispositivos sem nome ao mesmo tempo: a permissão
        existe — a track viva é a prova — e é a plataforma que se recusa a
        nomeá-los. Aqui não há botão, porque não há ação que resolva; o que a
        pessoa precisa é saber que não está fazendo nada errado.
      */}
      {micBlocked && !adiantaPedir && (
        <p className="device-note">
          {t`This app cannot read the device names on this system, so only the system default can be picked. The call still works, and the microphone in use is the one Windows is set to.`}
        </p>
      )}

      <Row
        icon={<IconMic size={16} />}
        label={t`Microphone`}
        vazio={t`No microphone was found — the system default will be used.`}
        kind="audioinput"
        devices={microphones}
        value={prefs.audioinput}
        busy={busy === "audioinput"}
        blocked={micBlocked}
        onPick={pick}
      />

      {/*
        Supressao de ruido — o "Padrao / Krisp" do Discord, com o motor que da
        para ter num servidor proprio. Fica logo abaixo do microfone porque e
        uma propriedade DELE: e o que sai do microfone que muda.
      */}
      <label className="device-choice">
        <span className="device-choice-text">
          <span>
            <Trans>Noise suppression</Trans>
          </span>
          <small>
            {supressao === "avancada"
              ? t`A small neural network cleans the microphone before sending. Best for keyboards, fans and background chatter.`
              : supressao === "desligada"
                ? t`Nothing is filtered. For instruments, or when you want the raw sound.`
                : t`The browser's own filter. Light on the CPU.`}
          </small>
        </span>
        <select
          value={supressao}
          disabled={aplicandoRuido}
          onChange={(e) => void escolherSupressao(supressaoOuPadrao(e.target.value))}
        >
          <option value="padrao">{t`Standard`}</option>
          <option value="avancada" disabled={!avancadaDisponivel}>
            {avancadaDisponivel ? t`Advanced` : t`Advanced (not available here)`}
          </option>
          <option value="desligada">{t`Off`}</option>
        </select>
      </label>

      <div className="device-level" aria-hidden={!liveMic && !testing}>
        <span className="device-level-label">
          <Trans>Input level</Trans>
        </span>
        <div className="level-track">
          <div className="level-fill" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
        {liveMic ? (
          <span className="device-hint">
            <Trans>Speak — the bar should move.</Trans>
          </span>
        ) : testing ? (
          <button className="btn-ghost small" onClick={stopProbe}>
            <Trans>Stop test</Trans>
          </button>
        ) : (
          <button className="btn-ghost small" onClick={() => void startProbe()}>
            <Trans>Test microphone</Trans>
          </button>
        )}
      </div>

      <Row
        icon={<IconVideo size={16} />}
        label={t`Camera`}
        vazio={t`No camera was found — the system default will be used.`}
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
            label={t`Speaker`}
            vazio={t`No speaker was found — the system default will be used.`}
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
            <Trans>Play a test sound</Trans>
          </button>
        </>
      ) : (
        <p className="device-note">
          <Trans>
            This browser always uses the system's default speaker; change it in the operating
            system's sound settings.
          </Trans>
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
        <span>
          <Trans>Play a sound when someone joins or leaves a call</Trans>
        </span>
      </label>

      {/*
        Aqui e nao so dentro da chamada: escolher a qualidade da tela no meio de
        uma apresentacao, com todo mundo olhando, e o pior momento possivel. O
        mesmo componente aparece no painel da chamada para quem so descobriu ali.
      */}
      {canShareScreen && (
        <>
          <h4 className="settings-head">
            <Trans>Screen sharing</Trans>
          </h4>
          <QualidadeDeTela
            valor={qualidade}
            onChange={(q) => {
              setQualidade(q);
              saveQualidade(q);
            }}
          />
        </>
      )}
    </div>
  );
}

function Row({
  icon,
  label,
  vazio,
  kind,
  devices,
  value,
  busy,
  blocked,
  onPick
}: {
  icon: React.ReactNode;
  label: string;
  /** A frase de "nenhum encontrado", já traduzida e por extenso. */
  vazio: string;
  kind: DeviceKind;
  devices: MediaDeviceInfo[];
  value: string | undefined;
  busy: boolean;
  /** Waiting on the browser's permission, as opposed to genuinely absent. */
  blocked: boolean;
  onPick: (kind: DeviceKind, deviceId: string) => void | Promise<void>;
}) {
  const { t } = useLingui();
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
      {/*
        O seletor NUNCA fica desabilitado por não termos conseguido enumerar.
        "System default" é uma escolha legítima — é exatamente o que o app usa
        quando não há preferência — e desabilitar aqui produzia um controle
        morto, sem nada que a pessoa pudesse fazer a respeito. O motivo de não
        haver mais opções vai na linha de baixo, em texto, não dentro da caixa.
      */}
      <select
        id={id}
        value={current}
        disabled={busy}
        onChange={(e) => void onPick(kind, e.target.value)}
      >
        <option value="">{t`System default`}</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {deviceLabel(d, i)}
          </option>
        ))}
      </select>

      {devices.length === 0 && (
        <p className="device-hint">
          {/*
            A frase de "não encontrei nenhum" vem PRONTA de cima, e não montada
            com o rótulo em minúscula. "No microphone"/"No camera" têm gênero
            diferente em português e espanhol, e `No ${label}` obrigaria a
            tradução a escolher um só e errar o outro.
          */}
          {blocked ? t`Allow access above to choose a specific one.` : vazio}
        </p>
      )}
    </div>
  );
}
