import { useEffect } from "react";

/** The dimmed backdrop every dialog sits on. Escape and a click outside both close. */
export function Scrim({
  children,
  onClose,
  className = ""
}: {
  children: React.ReactNode;
  onClose: () => void;
  /** Variante de largura. As configurações precisam de duas colunas. */
  className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`.trim()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
