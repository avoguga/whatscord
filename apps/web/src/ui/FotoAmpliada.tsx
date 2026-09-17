import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLingui } from "@lingui/react/macro";
import { fileUrl } from "../lib/api";
import { IconClose } from "./icons";

/**
 * A foto de alguém em tamanho grande, por cima de tudo.
 *
 * Existia só a bolinha de 40 px do cabeçalho, e não havia como ver a foto de
 * perto. É o gesto do WhatsApp: tocar na foto abre a foto.
 *
 * Vai por portal para o `body` porque o cabeçalho da conversa pode estar dentro
 * de um ancestral com `transform` (o painel da chamada recolhido), e aí
 * `position: fixed` passaria a ser relativo a ele em vez da janela.
 *
 * Fecha com Esc, com o botão, ou clicando fora da foto. Clicar NA foto não
 * fecha: quem está olhando de perto costuma clicar sem querer.
 */
export function FotoAmpliada({
  url,
  nome,
  onClose
}: {
  url: string;
  nome: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fechar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // O foco vai para o fechar, então Enter/Espaço também fecham e o leitor de
    // tela anuncia o diálogo.
    fechar.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="foto-ampliada"
      role="dialog"
      aria-modal="true"
      aria-label={t`Photo of ${nome}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <header className="foto-ampliada-topo">
        <strong>{nome}</strong>
        <button ref={fechar} className="icon-btn" onClick={onClose} aria-label={t`Close`} data-tip={t`Close`} data-tip-pos="baixo">
          <IconClose />
        </button>
      </header>
      <img src={fileUrl(url)} alt={t`Photo of ${nome}`} />
    </div>,
    document.body
  );
}
