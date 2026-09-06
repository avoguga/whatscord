import { useState } from "react";
import { useStore } from "../store";
import { Scrim } from "./Scrim";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

/**
 * Nome e cor de uma pasta do rail, e o botão de apagá-la.
 *
 * A cor não é enfeite: com quatro pastas fechadas, todas mostrando quatro
 * miniaturas minúsculas, a cor é a única coisa que se distingue de relance.
 */

/*
 * A paleta fica em `msg` e é traduzida na hora de desenhar. Uma lista de nomes
 * já traduzidos no topo do módulo seria avaliada na importação, antes de o
 * catálogo existir, e ficaria em inglês para sempre.
 */
const CORES: { valor: string; nome: MessageDescriptor }[] = [
  { valor: "#5865f2", nome: msg`Blurple` },
  { valor: "#3ba55d", nome: msg`Green` },
  { valor: "#faa81a", nome: msg`Amber` },
  { valor: "#ed4245", nome: msg`Red` },
  { valor: "#eb459e", nome: msg`Pink` },
  { valor: "#7a818c", nome: msg`Grey` }
];

export function FolderModal({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const { t, i18n } = useLingui();
  const folders = useStore((s) => s.spaceFolders);
  const spaces = useStore((s) => s.spaces);
  const updateSpaceFolder = useStore((s) => s.updateSpaceFolder);
  const deleteSpaceFolder = useStore((s) => s.deleteSpaceFolder);
  const notify = useStore((s) => s.notify);

  const pasta = folders.find((f) => f.id === folderId);
  const dentro = spaces.filter((s) => s.folderId === folderId);

  const [nome, setNome] = useState(pasta?.name ?? "");
  const [cor, setCor] = useState<string | null>(pasta?.color ?? null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarApagar, setConfirmarApagar] = useState(false);

  if (!pasta) return null;

  async function salvar() {
    if (!nome.trim()) return;
    setBusy(true);
    setErro(null);
    try {
      await updateSpaceFolder(folderId, { name: nome.trim(), color: cor });
      notify(t`Folder saved.`);
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : t`That folder could not be saved.`);
      setBusy(false);
    }
  }

  async function apagar() {
    setBusy(true);
    setErro(null);
    try {
      await deleteSpaceFolder(folderId);
      notify(t`Folder deleted. The spaces are still here.`);
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : t`That folder could not be deleted.`);
      setBusy(false);
    }
  }

  return (
    <Scrim onClose={onClose}>
      <header>
        <Trans>Folder</Trans>
      </header>
      <div className="modal-body">
        {erro && <div className="form-error">{erro}</div>}

        <div className="field">
          <label htmlFor="folder-name">
            <Trans>Folder name</Trans>
          </label>
          <input
            id="folder-name"
            autoFocus
            value={nome}
            maxLength={40}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void salvar()}
          />
        </div>

        <p className="section-label" style={{ padding: 0, marginBottom: 8 }}>
          <Trans>Colour</Trans>
        </p>
        <div className="folder-colors" role="radiogroup" aria-label={t`Folder colour`}>
          {CORES.map((c) => (
            <button
              key={c.valor}
              className="folder-color"
              style={{ background: c.valor }}
              role="radio"
              aria-checked={cor === c.valor}
              aria-label={i18n._(c.nome)}
              title={i18n._(c.nome)}
              onClick={() => setCor(c.valor)}
            />
          ))}
          <button
            className="folder-color none"
            role="radio"
            aria-checked={cor === null}
            aria-label={t`No colour`}
            title={t`No colour`}
            onClick={() => setCor(null)}
          />
        </div>

        <p className="settings-note" style={{ margin: "16px 0 0" }}>
          {dentro.length === 0 ? (
            <Trans>Nothing is in this folder yet. Drag a space onto it to put it in.</Trans>
          ) : (
            <Trans>
              This folder holds {dentro.length} of your spaces. Deleting it puts them back on the
              bar on their own — it never deletes a space.
            </Trans>
          )}
        </p>

        <div style={{ height: 1, background: "var(--divider)", margin: "20px 0" }} />

        {confirmarApagar ? (
          <div className="leave-confirm">
            <p>
              <Trans>
                Delete <b>{pasta.name}</b>? The spaces inside go back to the bar on their own.
                Nothing is removed and nobody is told.
              </Trans>
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-ghost" onClick={() => setConfirmarApagar(false)}>
                <Trans>Cancel</Trans>
              </button>
              <button className="btn-outline danger" disabled={busy} onClick={() => void apagar()}>
                {busy ? <Trans>Deleting…</Trans> : <Trans>Yes, delete the folder</Trans>}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn-outline danger" onClick={() => setConfirmarApagar(true)}>
            <Trans>Delete this folder</Trans>
          </button>
        )}
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>
          <Trans>Cancel</Trans>
        </button>
        <button className="btn-ghost" disabled={busy || !nome.trim()} onClick={() => void salvar()}>
          {busy ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
        </button>
      </footer>
    </Scrim>
  );
}
