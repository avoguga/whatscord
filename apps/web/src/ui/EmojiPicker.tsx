import { useEffect, useRef } from "react";

/**
 * A small, deliberate set rather than a full emoji keyboard.
 *
 * The composer button used to open nothing at all, and reacting always applied
 * a thumbs-up no matter which of the six declared emoji you meant — the code
 * only ever read the first one.
 */
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const GROUPS: { label: string; emoji: string[] }[] = [
  { label: "Reactions", emoji: REACTIONS },
  { label: "Faces", emoji: ["😀", "😅", "😉", "🙂", "😍", "🤔", "😴", "😭", "😡", "🥳", "😎", "🤝"] },
  { label: "Hands", emoji: ["👋", "👌", "✌️", "🤞", "💪", "👏", "🙌", "🫡"] },
  { label: "Things", emoji: ["🔥", "✅", "❌", "⚠️", "⭐", "🎉", "☕", "🚀", "💡", "📌", "🐛", "📎"] }
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
          <button key={e} className="emoji-cell" onClick={() => onPick(e)} title={`React with ${e}`}>
            {e}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="emoji-pop" ref={ref}>
      {GROUPS.map((g) => (
        <div key={g.label} className="emoji-group">
          <p className="emoji-label">{g.label}</p>
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
