/** Line icons at WhatsApp's weight. One stroke width, one size, no fills. */
type P = { size?: number };
const base = (size = 22) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const
});

export const IconChats = ({ size }: P) => (
  <svg {...base(size)}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.6-4.7A8.4 8.4 0 0 1 3.6 11 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" /></svg>
);
export const IconPhone = ({ size }: P) => (
  <svg {...base(size)}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.7a2 2 0 0 1 1.7 2.1z" /></svg>
);
export const IconVideo = ({ size }: P) => (
  <svg {...base(size)}><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
);
export const IconSpaces = ({ size }: P) => (
  <svg {...base(size)}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></svg>
);
export const IconSearch = ({ size }: P) => (
  <svg {...base(size ?? 18)}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
);
export const IconNewChat = ({ size }: P) => (
  <svg {...base(size ?? 20)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconMenu = ({ size }: P) => (
  <svg {...base(size ?? 20)}><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></svg>
);
export const IconAttach = ({ size }: P) => (
  <svg {...base(size ?? 23)}><path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.19a3.67 3.67 0 0 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 0 1-2.6-2.6l8.5-8.48" /></svg>
);
export const IconEmoji = ({ size }: P) => (
  <svg {...base(size ?? 23)}><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" /><circle cx="9" cy="9.5" r="0.9" fill="currentColor" /><circle cx="15" cy="9.5" r="0.9" fill="currentColor" /></svg>
);
export const IconSend = ({ size }: P) => (
  <svg {...base(size ?? 22)}><path d="M22 2 11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
);
export const IconMic = ({ size }: P) => (
  <svg {...base(size ?? 22)}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" /></svg>
);
export const IconMicOff = ({ size }: P) => (
  <svg {...base(size ?? 22)}><path d="M2 2l20 20" /><path d="M15 9.3V5a3 3 0 0 0-5.9-.7M9 9v2a3 3 0 0 0 4.5 2.6" /><path d="M5 11a7 7 0 0 0 10.7 6M19 11a7 7 0 0 1-.4 2.3M12 18v4" /></svg>
);
export const IconScreen = ({ size }: P) => (
  <svg {...base(size ?? 22)}><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /><path d="M12 8v5M9.5 10.5 12 8l2.5 2.5" /></svg>
);
export const IconHangup = ({ size }: P) => (
  <svg {...base(size ?? 24)}><path d="M2.5 14.2c4.5-4.6 14.5-4.6 19 0l-2.6 2.6-3.4-1.3v-2.3a13.6 13.6 0 0 0-7 0v2.3l-3.4 1.3z" /></svg>
);
export const IconCheck = ({ size }: P) => (
  <svg {...base(size ?? 16)} strokeWidth={2}><path d="M20 6 9 17l-5-5" /></svg>
);
export const IconChecks = ({ size }: P) => (
  <svg width={size ?? 17} height={size ?? 17} viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 8.5 4.5 12 12 3" /><path d="M7.5 8.5 11 12l7.5-9" />
  </svg>
);
export const IconClock = ({ size }: P) => (
  <svg {...base(size ?? 15)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const IconMute = ({ size }: P) => (
  <svg {...base(size ?? 16)}><path d="M18 8a6 6 0 0 0-9.3-5M6 9v5l-2 3h13M2 2l20 20" /></svg>
);
export const IconReply = ({ size }: P) => (
  <svg {...base(size ?? 18)}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v4" /></svg>
);
export const IconClose = ({ size }: P) => (
  <svg {...base(size ?? 20)}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const IconFile = ({ size }: P) => (
  <svg {...base(size ?? 24)}><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" /><path d="M14 2v5h5" /></svg>
);
export const IconVoiceRoom = ({ size }: P) => (
  <svg {...base(size ?? 22)}><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>
);
export const IconSettings = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
);

export const IconCopy = ({ size }: P) => (
  <svg {...base(size ?? 18)}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
);
export const IconUserPlus = ({ size }: P) => (
  <svg {...base(size ?? 20)}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
);
export const IconHash = ({ size }: P) => (
  <svg {...base(size ?? 20)}><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></svg>
);
export const IconGroup = ({ size }: P) => (
  <svg {...base(size ?? 20)}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="19" cy="9" r="2.4" /><circle cx="5" cy="9" r="2.4" /></svg>
);
export const IconBack = ({ size }: P) => (
  <svg {...base(size ?? 22)}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
);

export const IconVideoOff = ({ size }: P) => (
  <svg {...base(size ?? 22)}><path d="M2 2l20 20" /><path d="M16 16H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1" /><path d="M8 5h6a2 2 0 0 1 2 2v3.5l7-4.5v11l-4-2.6" /></svg>
);
export const IconSignal = ({ size }: P) => (
  <svg {...base(size ?? 16)}><path d="M4 20v-3M9 20v-7M14 20v-11M19 20v-15" /></svg>
);
export const IconMinimize = ({ size }: P) => (
  <svg {...base(size ?? 20)}><path d="M4 14h6v6M20 10h-6V4" /></svg>
);
export const IconSpeaker = ({ size }: P) => (
  <svg {...base(size ?? 18)}><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" /></svg>
);
