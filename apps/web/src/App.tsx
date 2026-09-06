import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { connectSocket, disconnectSocket } from "./lib/socket";
import { watchSystemTheme } from "./lib/theme";
import {
  inviteFromLocation,
  onDeepLink,
  stashPendingInvite,
  takePendingInvite
} from "./lib/deeplink";
import { Auth } from "./ui/Auth";
import { Sidebar } from "./ui/Sidebar";
import { Chat } from "./ui/Chat";
import { Toasts } from "./ui/Toasts";
import { InviteGate } from "./ui/InviteGate";

/*
 * A tela de chamada carrega sob demanda porque ela traz junto o livekit-client,
 * de longe a maior dependencia do app. No bundle unico ele era baixado e
 * interpretado por todo mundo que abre o WhatsCord, inclusive quem so vai ler
 * mensagem — e no celular isso e a diferenca entre abrir rapido e nao abrir.
 */
const CallSheet = lazy(() => import("./ui/Call").then((m) => ({ default: m.CallSheet })));

export default function App() {
  const me = useStore((s) => s.me);
  const booting = useStore((s) => s.booting);
  const bootstrap = useStore((s) => s.bootstrap);
  const activeRoomId = useStore((s) => s.activeRoomId);

  const joinSpaceByCode = useStore((s) => s.joinSpaceByCode);
  const notify = useStore((s) => s.notify);

  const [call, setCall] = useState<{ roomId: string; video: boolean } | null>(null);
  /** Convite chegado pela web, esperando a pessoa escolher app ou navegador. */
  const [gate, setGate] = useState<string | null>(null);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  /*
   * Convites.
   *
   * Um link chega por dois caminhos — o endereço com que a página abriu, ou o
   * app desktop entregando `whatscord://join/...` com a janela já aberta — e os
   * dois passam por aqui.
   */
  const meRef = useRef(me);
  meRef.current = me;

  const accept = useCallback(
    async (code: string) => {
      // Sem sessão o convite espera: aceitar exige token, e mandar a pessoa
      // fazer login perdendo o convite no caminho é o mesmo que não ter link.
      if (!meRef.current) {
        stashPendingInvite(code);
        return;
      }
      try {
        const space = await joinSpaceByCode(code);
        notify(`You joined ${space.name}.`);
      } catch (err) {
        notify(err instanceof Error ? err.message : "That invite did not work.", "bad");
      }
    },
    [joinSpaceByCode, notify]
  );

  // Links entregues com o app já aberto.
  useEffect(() => onDeepLink((code) => void accept(code)), [accept]);

  /*
   * Repinta quando o SISTEMA troca de tema, e só quando a preferência é
   * "igual ao dispositivo". Sem isto o Windows entra no modo noturno às 18h e
   * o app segue claro até alguém recarregar.
   *
   * Lê o tema por `getState()` em vez de por dependência: assinar a mudança de
   * novo a cada troca de tema derrubaria o listener no momento exato em que ele
   * importa.
   */
  useEffect(() => watchSystemTheme(() => useStore.getState().theme), []);

  /*
   * O endereço com que a página abriu, uma vez só.
   *
   * Aqui NÃO se entra direto: o navegador não sabe se o app está instalado, e
   * quem tem o app espera que o link o abra. A escolha é da pessoa. Já um link
   * entregue pelo próprio app (o efeito acima) entra direto — ela já está nele.
   */
  useEffect(() => {
    const code = inviteFromLocation();
    if (code) setGate(code);
  }, []);

  // E o convite que ficou esperando alguém entrar.
  useEffect(() => {
    if (!me) return;
    const code = takePendingInvite();
    if (code) void accept(code);
  }, [me, accept]);

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

  if (gate) {
    return (
      <InviteGate
        code={gate}
        onBrowser={() => {
          const code = gate;
          setGate(null);
          void accept(code);
        }}
      />
    );
  }

  if (booting) {
    return (
      <div className="auth">
        <p style={{ color: "var(--text-dim)" }}>Opening WhatsCord…</p>
      </div>
    );
  }

  if (!me) return <Auth />;

  return (
    // On a narrow screen only one pane is on screen at a time, and this is what
    // says which: the list until a conversation is opened, the conversation
    // after that. On a wide screen it has no effect.
    <div className="app" data-room-open={activeRoomId ? "true" : "false"}>
      <Sidebar />
      <Chat onStartCall={(video) => activeRoomId && setCall({ roomId: activeRoomId, video })} />
      {call && (
        <Suspense fallback={<div className="call-sheet call-loading">Opening the call…</div>}>
          <CallSheet roomId={call.roomId} withVideo={call.video} onClose={() => setCall(null)} />
        </Suspense>
      )}
      <Toasts />
    </div>
  );
}
