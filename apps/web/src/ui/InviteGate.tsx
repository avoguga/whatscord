import { useEffect, useState } from "react";
import { appLink } from "../lib/deeplink";
import { Trans } from "@lingui/react/macro";

/**
 * A escolha que aparece quando alguém abre um link de convite no navegador.
 *
 * Sem isto o link entrava direto pela web, e quem tem o app instalado nunca
 * chegava a usá-lo — que é justamente o jeito como as pessoas esperam usar
 * este tipo de app hoje.
 *
 * O botão do app é o principal, mas a saída pelo navegador fica ao lado e não
 * escondida: não dá para o navegador saber se o app está instalado, então
 * empurrar todo mundo para `whatscord://` deixaria quem não tem o app olhando
 * para uma página que não faz nada.
 */
export function InviteGate({
  code,
  onBrowser
}: {
  code: string;
  onBrowser: () => void;
}) {
  const [tentou, setTentou] = useState(false);

  // Depois de mandar para o app, a aba fica parada. Uma mensagem honesta é
  // melhor do que uma tela vazia com um botão já clicado.
  useEffect(() => {
    if (!tentou) return;
    const id = window.setTimeout(() => setTentou(false), 6000);
    return () => window.clearTimeout(id);
  }, [tentou]);

  return (
    <div className="auth">
      <div className="auth-card invite-gate">
        <h1>WhatsCord</h1>
        <p className="sub">
          <Trans>You have been invited to a space.</Trans>
        </p>

        <button
          className="btn-primary"
          onClick={() => {
            setTentou(true);
            // Navegar para o esquema é o que dispara o app registrado. Se nada
            // estiver registrado, o navegador simplesmente não faz nada — daí
            // a mensagem de fallback logo abaixo.
            window.location.href = appLink(code);
          }}
        >
          <Trans>Open in the WhatsCord app</Trans>
        </button>

        {tentou && (
          <p className="gate-note">
            <Trans>
              Nothing happened? The app is probably not installed on this machine — use the browser
              below, or install it first.
            </Trans>
          </p>
        )}

        <button className="btn-outline" onClick={onBrowser}>
          <Trans>Continue in the browser</Trans>
        </button>

        <p className="gate-foot">
          {/*
            O link vai DENTRO da frase traduzida, e não colado depois dela: em
            português e espanhol o "baixe para Windows" não cai no fim da frase,
            e um link costurado por fora não teria como se mover junto.
          */}
          <Trans>
            Don't have the desktop app yet?{" "}
            <a
              href="https://github.com/avoguga/whatscord/releases/latest"
              target="_blank"
              rel="noreferrer noopener"
            >
              Download it for Windows
            </a>
          </Trans>
        </p>
      </div>
    </div>
  );
}
