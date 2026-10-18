import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useStore } from "../store";
import { Scrim } from "./Scrim";
import { IconCheck, IconCopy } from "./icons";
import { criarReuniao } from "../lib/reuniao";
import { codigoColado } from "../lib/linkDeReuniao";

/**
 * "Reunião por link": criar uma, ou entrar numa com um código.
 *
 * O link NÃO é criado ao abrir esta janela. Quem abriu pode só querer colar o
 * código que recebeu — criar uma reunião que ninguém vai usar a cada clique
 * encheria o banco de salas vazias. Por isso criar é um botão.
 */
export function NovaReuniao({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const abrir = useStore((s) => s.abrirReuniao);
  const [criando, setCriando] = useState(false);
  const [criada, setCriada] = useState<{ code: string; link: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [colado, setColado] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setCriando(true);
    setErro(null);
    try {
      const r = await criarReuniao();
      setCriada({ code: r.reuniao.code, link: r.link });
    } catch (e) {
      setErro(e instanceof Error ? e.message : t`The meeting could not be created.`);
    } finally {
      setCriando(false);
    }
  }

  async function copiar() {
    if (!criada) return;
    try {
      await navigator.clipboard.writeText(criada.link);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1800);
    } catch {
      setErro(t`The link could not be copied.`);
    }
  }

  function entrarColado() {
    const code = codigoColado(colado);
    if (!code) {
      setErro(t`That doesn't look like a meeting link or code.`);
      return;
    }
    abrir(code);
    onClose();
  }

  return (
    <Scrim onClose={onClose}>
      <header>
        <Trans>Meeting link</Trans>
      </header>
      <div className="modal-body">
        {erro && <div className="form-error">{erro}</div>}

        {criada ? (
          <>
            <p className="settings-note" style={{ marginTop: 0 }}>
              <Trans>
                Your meeting is ready. Send this link to whoever you want to call — people without an
                account can join just by typing their name.
              </Trans>
            </p>
            <div className="nova-reuniao-link">
              <code>{criada.link}</code>
              <button className="btn-ghost" onClick={() => void copiar()}>
                {copiado ? <IconCheck size={16} /> : <IconCopy size={16} />}
                {copiado ? <Trans>Copied</Trans> : <Trans>Copy</Trans>}
              </button>
            </div>
            <button
              className="btn-primary"
              style={{ marginTop: 14 }}
              onClick={() => {
                abrir(criada.code);
                onClose();
              }}
            >
              <Trans>Join now</Trans>
            </button>
          </>
        ) : (
          <>
            <p className="settings-note" style={{ marginTop: 0 }}>
              <Trans>
                Get a link you can send to anyone, like a video meeting. People without an account
                can join just by typing their name.
              </Trans>
            </p>
            <button className="btn-primary" disabled={criando} onClick={() => void criar()}>
              {criando ? <Trans>Creating…</Trans> : <Trans>Create a meeting link</Trans>}
            </button>
          </>
        )}

        <div className="espera-ou" style={{ margin: "20px 0 14px" }}>
          <span>
            <Trans>or join one</Trans>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="nova-reuniao-codigo"
            value={colado}
            placeholder={t`Paste a link or code (abc-defg-hij)`}
            onChange={(e) => setColado(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && entrarColado()}
          />
          <button className="btn-ghost" disabled={!colado.trim()} onClick={entrarColado}>
            <Trans>Join</Trans>
          </button>
        </div>
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>
          <Trans>Close</Trans>
        </button>
      </footer>
    </Scrim>
  );
}
