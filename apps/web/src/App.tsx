import { useEffect, useState } from "react";
import { useStore } from "./store";
import { connectSocket, disconnectSocket } from "./lib/socket";
import { Auth } from "./ui/Auth";
import { Sidebar } from "./ui/Sidebar";
import { Chat } from "./ui/Chat";
import { CallSheet } from "./ui/Call";

export default function App() {
  const me = useStore((s) => s.me);
  const booting = useStore((s) => s.booting);
  const bootstrap = useStore((s) => s.bootstrap);
  const activeRoomId = useStore((s) => s.activeRoomId);

  const [call, setCall] = useState<{ roomId: string; video: boolean } | null>(null);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!me) {
      disconnectSocket();
      return;
    }
    connectSocket();
    return () => disconnectSocket();
  }, [me]);

  // Leaving a conversation should not silently drop the call you are on.
  useEffect(() => {
    if (call && activeRoomId !== call.roomId) setCall(null);
  }, [activeRoomId, call]);

  if (booting) {
    return (
      <div className="auth">
        <p style={{ color: "var(--text-dim)" }}>Opening WhatsCord…</p>
      </div>
    );
  }

  if (!me) return <Auth />;

  return (
    <div className="app">
      <Sidebar />
      <Chat onStartCall={(video) => activeRoomId && setCall({ roomId: activeRoomId, video })} />
      {call && (
        <CallSheet roomId={call.roomId} withVideo={call.video} onClose={() => setCall(null)} />
      )}
    </div>
  );
}
