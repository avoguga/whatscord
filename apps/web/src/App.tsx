import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { connectSocket, disconnectSocket } from "./lib/socket";
import { watchSystemTheme } from "./lib/theme";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  inviteFromLocation,
  onDeepLink,
  stashPendingInvite,
  takePendingInvite
} from "./lib/deeplink";
import { Auth } from "./ui/Auth";
import { Sidebar } from "./ui/Sidebar";
import { Chat } from "./ui/Chat";
import { PainelDeMembros } from "./ui/Membros";
import { Toasts } from "./ui/Toasts";
import { InviteGate } from "./ui/InviteGate";
import { AvisosDoApp } from "./ui/Atualizacao";
import { iniciarVerificacaoAutomatica } from "./lib/atualizador";
import { reabrirVisivelSePreciso } from "./lib/inicializacao";
import { Home } from "./ui/Home";
import { codigoDaTransmissaoEm, transmissaoPeloCodigo } from "./lib/transmissoes";
import { ApiError } from "./lib/api";
import { tokenDeSenhaEm } from "./lib/senha";
import { RedefinirSenha } from "./ui/RedefinirSenha";

/*
 * A tela de chamada carrega sob demanda porque ela traz junto o livekit-client,
 * de longe a maior dependencia do app. No bundle unico ele era baixado e
 * interpretado por todo mundo que abre o WhatsCord, inclusive quem so vai ler
 * mensagem — e no celular isso e a diferenca entre abrir rapido e nao abrir.
 */
const CallSheet = lazy(() => import("./ui/Call").then((m) => ({ default: m.CallSheet })));

export default function App() {
  const { t } = useLingui();
  const startCall = useStore((s) => s.startCall);
  const me = useStore((s) => s.me);
  const booting = useStore((s) => s.booting);
  const bootstrap = useStore((s) => s.bootstrap);
  const activeRoomId = useStore((s) => s.activeRoomId);
  const superficie = useStore((s) => s.superficie);
  const abrirTransmissao = useStore((s) => s.abrirTransmissao);

  const joinSpaceByCode = useStore((s) => s.joinSpaceByCode);
  const notify = useStore((s) => s.notify);

  const call = useStore((s) => s.call);
  const endCall = useStore((s) => s.endCall);
  /** Convite chegado pela web, esperando a pessoa escolher app ou navegador. */
  const [gate, setGate] = useState<string | null>(null);
  /*
   * O link de "esqueci a senha". Lido no PRIMEIRO render — antes de qualquer
   * efeito — porque outro efeito limpa a barra de endereços ao procurar convite.
   */
  const [tokenDeSenha, setTokenDeSenha] = useState<string | null>(() =>
    tokenDeSenhaEm(window.location.search)
  );
  /** O código de transmissão que veio no endereço, esperando a sessão. */
  const [convidadoAoVivo, setConvidadoAoVivo] = useState<string | null>(null);

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
        notify(err instanceof Error ? err.message : t`That invite did not work.`, "bad");
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
   * Procura versão nova do app desktop alguns segundos depois de abrir, sem
   * segurar a abertura. Mora aqui, e não no aviso, porque o aviso troca de lugar
   * quando a pessoa entra na conta — e cada remontagem reiniciaria a espera.
   * No navegador e no Android a função não faz nada.
   */
  useEffect(() => iniciarVerificacaoAutomatica(), []);
  // Depois de uma atualizacao pedida com a janela aberta: volta com a janela aberta.
  useEffect(() => void reabrirVisivelSePreciso(), []);

  /*
   * O endereço com que a página abriu, uma vez só.
   *
   * Aqui NÃO se entra direto: o navegador não sabe se o app está instalado, e
   * quem tem o app espera que o link o abra. A escolha é da pessoa. Já um link
   * entregue pelo próprio app (o efeito acima) entra direto — ela já está nele.
   */
  useEffect(() => {
    /*
     * Duas portas diferentes no mesmo endereço: `?join=` leva a um espaço e
     * `?live=` a uma transmissão. A da transmissão é lida ANTES porque
     * `inviteFromLocation` limpa a barra de endereços ao ler — se viesse
     * depois, encontraria a URL já apagada.
     */
    const aoVivo = codigoDaTransmissaoEm(window.location.search);
    if (aoVivo) setConvidadoAoVivo(aoVivo);
    const code = inviteFromLocation();
    if (code) setGate(code);
  }, []);

  /*
   * O link de uma transmissão, depois de a pessoa estar na conta.
   *
   * Sem sessão não dá para abrir — nem para saber se ela pode — então o código
   * espera aqui até `me` existir, igual ao convite de espaço faz com o dele.
   */
  useEffect(() => {
    if (!me || !convidadoAoVivo) return;
    let vivo = true;
    (async () => {
      try {
        const t = await transmissaoPeloCodigo(convidadoAoVivo);
        if (vivo) await abrirTransmissao(t.id, convidadoAoVivo);
      } catch (err) {
        /*
         * "Não existe" e "não é para você" respondem 404 pelos dois lados, e
         * repetir isso na tela contaria que existe. Esses dois são silêncio.
         *
         * "Está fora do ar" é outra coisa: é uma transmissão que a pessoa PODE
         * ver e que simplesmente ainda não começou — ou já acabou. Cair na tela
         * de conversas sem uma palavra, depois de clicar num link que alguém
         * mandou, parece o app engolindo o clique. Foi o que aconteceu num teste
         * com um link real.
         */
        if (err instanceof ApiError && err.status === 409) {
          useStore.getState().notify(err.message, "bad");
        }
      } finally {
        if (vivo) setConvidadoAoVivo(null);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [me, convidadoAoVivo, abrirTransmissao]);

  /*
   * O token sai da barra de endereços assim que é lido. Ele é uma chave da conta
   * por meia hora: não pode ficar no histórico do navegador, num print de tela ou
   * num "copiar link" feito sem pensar.
   */
  useEffect(() => {
    if (tokenDeSenha) window.history.replaceState(null, "", "/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /*
   * Trocar de conversa NÃO derruba mais a chamada.
   *
   * O que existia aqui fechava a chamada assim que a pessoa abria outro canal —
   * e o comentário que acompanhava dizia justamente o contrário do que o código
   * fazia. Na prática, minimizar a chamada e clicar em qualquer conversa
   * desligava o áudio de todo mundo sem aviso.
   *
   * Sair de uma chamada é uma decisão, não um efeito colateral de navegar. Agora
   * só o botão de sair encerra, e a tarja de chamada em andamento continua
   * visível enquanto se lê outro canal.
   */

  // Quem clicou no link do e-mail veio para isto, com ou sem sessão.
  if (tokenDeSenha) {
    return <RedefinirSenha token={tokenDeSenha} onFim={() => setTokenDeSenha(null)} />;
  }

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
        <p style={{ color: "var(--text-dim)" }}>
          <Trans>Opening WhatsCord…</Trans>
        </p>
      </div>
    );
  }

  /*
   * O aviso de versão nova aparece também na tela de entrada: se o problema que
   * impede alguém de entrar foi corrigido numa versão nova, é justamente ali
   * que a pessoa precisa saber. Ele não desenha nada fora do app desktop.
   */
  if (!me)
    return (
      <>
        <Auth />
        <AvisosDoApp />
      </>
    );

  return (
    // On a narrow screen only one pane is on screen at a time, and this is what
    // says which: the list until a conversation is opened, the conversation
    // after that. On a wide screen it has no effect.
    <div className="app" data-room-open={activeRoomId ? "true" : "false"}>
      <Sidebar />
      {/*
        Duas superfícies, uma de cada vez. A tela de início ocupa o lugar da
        conversa — e não o da barra lateral — para o rail continuar à vista: dá
        para estar assistindo e trocar de espaço sem sair do ar.
      */}
      {superficie === "inicio" ? (
        <Home />
      ) : (
        <Chat onStartCall={(video) => activeRoomId && startCall(activeRoomId, video)} />
      )}
      {superficie === "conversas" && <PainelDeMembros />}
      {call && (
        <Suspense
          fallback={
            <div className="call-sheet call-loading">
              <Trans>Opening the call…</Trans>
            </div>
          }
        >
          <CallSheet roomId={call.roomId} withVideo={call.video} onClose={endCall} />
        </Suspense>
      )}
      <Toasts />
      <AvisosDoApp />
    </div>
  );
}
