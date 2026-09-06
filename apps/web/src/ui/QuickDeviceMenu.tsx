import { useEffect, useRef } from "react";
import {
  deviceLabel,
  resolveDeviceId,
  useDevices,
  type DeviceKind
} from "../lib/devices";

/**
 * O menu curto que a seta ao lado do microfone e da câmera abre.
 *
 * Existe porque o único acesso às configurações era um painel cheio: para trocar
 * de microfone no meio de uma chamada a pessoa abria tudo, procurava, e fechava.
 * A referência é o menu que o Discord pôs atrás das setas dos botões de mudo e
 * de fone (patch notes de 04/11/2025).
 *
 * Deliberadamente curto: escolher o aparelho e ir para as configurações
 * completas. Tudo o mais mora no painel.
 */
export function QuickDeviceMenu({
  kind,
  onSwitch,
  onNotice,
  onClose,
  onFullSettings
}: {
  kind: Extract<DeviceKind, "audioinput" | "videoinput">;
  onSwitch?: (kind: DeviceKind, deviceId: string) => Promise<void>;
  onNotice?: (text: string) => void;
  onClose: () => void;
  onFullSettings: () => void;
}) {
  const { microphones, cameras, micBlocked, camBlocked, prefs, reveal, choose } = useDevices();
  const ref = useRef<HTMLDivElement>(null);

  const isMic = kind === "audioinput";
  const devices = isMic ? microphones : cameras;
  const blocked = isMic ? micBlocked : camBlocked;
  const saved = isMic ? prefs.audioinput : prefs.videoinput;
  const current = resolveDeviceId(saved, devices) ?? "";

  /*
   * Fechar clicando fora e com Esc. Um popover que só fecha pelo próprio botão
   * é uma armadilha no celular, onde não há "clicar fora" óbvio — mas há toque
   * fora, que é o mesmo evento.
   */
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // `capture` para pegar o clique antes de qualquer handler da página.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("touchstart", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function pick(deviceId: string) {
    const id = deviceId || undefined;
    choose(kind, id);
    if (!onSwitch || !id) return;
    try {
      await onSwitch(kind, id);
    } catch {
      onNotice?.("That device could not be opened — it may be in use by another app.");
    }
  }

  return (
    <div className="quick-menu" ref={ref} role="menu" aria-label={isMic ? "Microphone" : "Camera"}>
      <p className="quick-head">{isMic ? "Input device" : "Camera"}</p>

      {blocked ? (
        <div className="quick-blocked">
          <p>The browser has not given access yet, so the devices have no names.</p>
          <button className="btn-ghost small" onClick={() => void reveal()}>
            {isMic ? "Allow the microphone" : "Allow the camera"}
          </button>
        </div>
      ) : (
        <div className="quick-list">
          <button
            className={`quick-item${current === "" ? " on" : ""}`}
            role="menuitemradio"
            aria-checked={current === ""}
            onClick={() => void pick("")}
          >
            System default
          </button>
          {devices.map((d, i) => (
            <button
              key={d.deviceId}
              className={`quick-item${current === d.deviceId ? " on" : ""}`}
              role="menuitemradio"
              aria-checked={current === d.deviceId}
              onClick={() => void pick(d.deviceId)}
            >
              {deviceLabel(d, i)}
            </button>
          ))}
          {devices.length === 0 && (
            <p className="quick-empty">
              No {isMic ? "microphone" : "camera"} was found — the system default will be used.
            </p>
          )}
        </div>
      )}

      <button className="quick-full" onClick={onFullSettings}>
        {isMic ? "Voice settings" : "Video settings"}
      </button>
    </div>
  );
}
