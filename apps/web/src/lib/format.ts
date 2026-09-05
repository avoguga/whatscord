const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long" });

export const clock = (iso: string | Date) => timeFmt.format(new Date(iso));

/** WhatsApp's list rule: time today, "Yesterday", weekday this week, else date. */
export function listStamp(iso: string | Date) {
  const date = new Date(iso);
  const now = new Date();
  const days = daysApart(date, now);
  if (days === 0) return timeFmt.format(date);
  if (days === 1) return "Yesterday";
  if (days < 7) return weekdayFmt.format(date);
  return dayFmt.format(date);
}

export function daySeparator(iso: string | Date) {
  const date = new Date(iso);
  const days = daysApart(date, new Date());
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return weekdayFmt.format(date);
  return dayFmt.format(date);
}

function daysApart(a: Date, b: Date) {
  const midnightA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const midnightB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((midnightB - midnightA) / 86_400_000);
}

export const sameDay = (a: string | Date, b: string | Date) =>
  new Date(a).toDateString() === new Date(b).toDateString();

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Two letters for an avatar, skipping the small joining words.
 *
 * Taking the first two words blindly turned "Time de Produto" into "TD", which
 * is nobody's initials. Words of one or two letters are almost always
 * prepositions or articles, in any of the languages this is likely to see.
 */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => w.length > 2);
  const picked = (meaningful.length >= 2 ? meaningful : words).slice(0, 2);
  return picked.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export const isImage = (mime: string) => mime.startsWith("image/");
export const isVideo = (mime: string) => mime.startsWith("video/");
export const isAudio = (mime: string) => mime.startsWith("audio/");
