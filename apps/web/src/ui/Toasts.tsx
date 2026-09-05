import { useEffect } from "react";
import { useStore } from "../store";
import { IconCheck, IconClose } from "./icons";

/**
 * Confirmation that something worked.
 *
 * Nothing in the app used to say so: you created a channel, added people or
 * joined a space and the modal simply closed. The result appeared behind the
 * dialog you were still looking at, so it read as nothing having happened.
 */
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} id={t.id} text={t.text} kind={t.kind} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function Toast({
  id, text, kind, onDismiss
}: {
  id: string;
  text: string;
  kind: "ok" | "bad";
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), kind === "bad" ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [id, kind, onDismiss]);

  return (
    <div className={`toast${kind === "bad" ? " bad" : ""}`}>
      {kind === "ok" && <IconCheck size={16} />}
      <span>{text}</span>
      <button onClick={() => onDismiss(id)} title="Dismiss">
        <IconClose size={15} />
      </button>
    </div>
  );
}
