import { useEffect, useRef } from "react";
import { useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";

/**
 * A small, deliberate set rather than a full emoji keyboard.
 *
 * The composer button used to open nothing at all, and reacting always applied
 * a thumbs-up no matter which of the six declared emoji you meant — the code
 * only ever read the first one.
 */
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/*
 * `msg` guarda a mensagem sem traduzir; o `i18n._()` traduz na hora de
 * desenhar. Uma lista de rótulos já traduzidos aqui em cima seria avaliada na
 * importação, antes de o catálogo carregar, e ficaria congelada.
 */
const GRUPOS = [
  { label: msg`Reactions`, emoji: REACTIONS },
  { label: msg`Faces`, emoji: ["😀", "😅", "😉", "🙂", "😍", "🤔", "😴", "😭", "😡", "🥳", "😎", "🤝"] },
  { label: msg`Hands`, emoji: ["👋", "👌", "✌️", "🤞", "💪", "👏", "🙌", "🫡"] },
  { label: msg`Things`, emoji: ["🔥", "✅", "❌", "⚠️", "⭐", "🎉", "☕", "🚀", "💡", "📌", "🐛", "📎"] }
];

export function EmojiPicker({
  onPick,
  onClose,
  compact
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Reaction mode: just the six, in one row. */
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { t, i18n } = useLingui();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Deferred: the click that opened the picker would otherwise close it.
    const id = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      clearTimeout(id);
    };
  }, [onClose]);

  if (compact) {
    return (
      <div className="emoji-pop compact" ref={ref}>
        {REACTIONS.map((e) => (
          <button key={e} className="emoji-cell" onClick={() => onPick(e)} title={t`React with ${e}`}>
            {e}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="emoji-pop" ref={ref}>
      {GRUPOS.map((g) => (
        <div key={g.label.id ?? g.label.message} className="emoji-group">
          <p className="emoji-label">{i18n._(g.label)}</p>
          <div className="emoji-grid">
            {g.emoji.map((e) => (
              <button key={e} className="emoji-cell" onClick={() => onPick(e)} title={e}>
                {e}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
