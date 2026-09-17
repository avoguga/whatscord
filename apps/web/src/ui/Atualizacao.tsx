import { useEffect, useState, useSyncExternalStore } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { porcentagem, type TipoDeErro } from "../lib/atualizacao";
import {
  adiarAtualizacao,
  assinarAtualizacao,
  atualizacaoDisponivelAqui,
  carregarVersaoAtual,
  definirAtualizacaoAutomatica,
  estadoDaAtualizacao,
  instalarAtualizacao,
  procurarAtualizacao,
  type EstadoDaAtualizacao
} from "../lib/atualizador";
import { IconClose } from "./icons";

/**
 * O que a pessoa vê da atualização do app desktop.
 *
 * O desenho segue uma regra: o app baixa sozinho e instala num momento seguro,
 * então o aviso existe para três coisas — dizer que está pronto e deixar
 * reiniciar já, avisar antes de reiniciar sozinho (com como adiar), e explicar
 * por que está esperando quando há uma chamada. Fechar o aviso ADIA uma hora;
 * ele volta. Um aviso que some para sempre com um clique é um aviso que
 * ninguém vê duas vezes.
 *
 * Nada disto aparece no navegador nem no Android.
 */

function useAtualizacao(): EstadoDaAtualizacao {
  return useSyncExternalStore(assinarAtualizacao, estadoDaAtualizacao, estadoDaAtualizacao);
}

/*
 * `msg` + `i18n._()`, e não uma função que recebe `t`: um `t` vindo por
 * parâmetro faz a extração ignorar a mensagem em silêncio.
 */
const ERROS: Record<TipoDeErro, MessageDescriptor> = {
  offline: msg`Could not reach the update server. Check your internet connection and try again.`,
  "sem-versao-publicada": msg`No update has been published yet. Try again later.`,
  assinatura: msg`The update could not be verified, so it was not installed. Try again later.`,
  outro: msg`Something went wrong with the update. Try again later.`
};

function megas(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

function Progresso({ estado }: { estado: EstadoDaAtualizacao }) {
  const { t } = useLingui();
  const pct = porcentagem(estado.progresso);
  const baixado = megas(estado.progresso.baixado);
  return (
    <div className="update-progress">
      <div
        className="update-bar"
        role="progressbar"
        aria-label={t`Download progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        data-indeterminado={pct === null ? "true" : undefined}
      >
        <span style={{ width: pct === null ? undefined : `${pct}%` }} />
      </div>
      <small>{pct === null ? t`Downloading… ${baixado} MB` : t`Downloading… ${pct}%`}</small>
    </div>
  );
}

/** Segundos que faltam na contagem, re-renderizando a cada segundo. */
function useSegundosRestantes(ate: number | null): number | null {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (ate === null) return;
    const id = setInterval(() => setAgora(Date.now()), 250);
    return () => clearInterval(id);
  }, [ate]);
  if (ate === null) return null;
  return Math.max(0, Math.ceil((ate - agora) / 1000));
}

/** Se o aviso está adiado agora. Re-avalia sozinho quando o adiamento vence. */
function useAdiado(ate: number | null): boolean {
  const [, forcar] = useState(0);
  useEffect(() => {
    if (ate === null) return;
    const falta = ate - Date.now();
    if (falta <= 0) return;
    const id = setTimeout(() => forcar((n) => n + 1), falta + 50);
    return () => clearTimeout(id);
  }, [ate]);
  return ate !== null && Date.now() < ate;
}

/* ------------------------------------------------------------------ aviso */

export function AvisoDeAtualizacao() {
  const { t, i18n } = useLingui();
  const estado = useAtualizacao();
  const segundos = useSegundosRestantes(estado.fase === "contagem" ? estado.contagemAte : null);
  const adiado = useAdiado(estado.adiadoAte);

  if (!atualizacaoDisponivelAqui || !estado.versaoNova) return null;
  const versao = estado.versaoNova;

  /*
   * O que aparece, por fase. O download automático é silencioso (sem barra
   * surgindo do nada), e "adiado" esconde o aviso de "pronta" — mas NUNCA a
   * contagem: se o app vai reiniciar, a pessoa tem de ver.
   */
  const fase = estado.fase;
  const mostra =
    fase === "contagem" ||
    fase === "reiniciando" ||
    fase === "reabrir" ||
    (fase === "baixando" && estado.pedidoPelaPessoa) ||
    (fase === "erro" && estado.pedidoPelaPessoa) ||
    ((fase === "pronta" || fase === "disponivel") && !adiado);
  if (!mostra) return null;

  const podeFechar = fase === "pronta" || fase === "disponivel" || fase === "erro";

  return (
    <div className="update-notice" role="status" aria-live="polite">
      <div className="update-notice-text">
        {fase === "contagem" ? (
          <>
            <strong>{t`Restarting to update in ${segundos ?? 0} s`}</strong>
            <small>{t`WhatsCord ${versao} is ready. It only takes a few seconds.`}</small>
            <div className="update-actions">
              <button className="btn-link" onClick={() => void instalarAtualizacao()}>
                <Trans>Restart now</Trans>
              </button>
              <button className="btn-link" onClick={adiarAtualizacao}>
                <Trans>Postpone</Trans>
              </button>
            </div>
          </>
        ) : fase === "pronta" && estado.seguradaPelaChamada ? (
          <>
            <strong>{t`WhatsCord ${versao} is ready`}</strong>
            <small>
              <Trans>It will be installed when your call ends — never during one.</Trans>
            </small>
          </>
        ) : fase === "pronta" ? (
          <>
            <strong>{t`WhatsCord ${versao} is ready`}</strong>
            <small>
              {estado.automatico ? (
                <Trans>It will install on its own when you're not using the app. Or restart now.</Trans>
              ) : (
                <Trans>Restart to finish updating.</Trans>
              )}
            </small>
            <div className="update-actions">
              <button className="btn-link" onClick={() => void instalarAtualizacao()}>
                <Trans>Restart now</Trans>
              </button>
              <button className="btn-link" onClick={adiarAtualizacao}>
                <Trans>Later</Trans>
              </button>
            </div>
          </>
        ) : (
          <>
            <strong>{t`WhatsCord ${versao} is available`}</strong>
            {fase === "baixando" && <Progresso estado={estado} />}
            {fase === "reiniciando" && <small>{t`Installing… WhatsCord will restart.`}</small>}
            {fase === "reabrir" && <small>{t`Update installed. Close and reopen WhatsCord to finish.`}</small>}
            {fase === "erro" && estado.erro && (
              <small className="update-error">{i18n._(ERROS[estado.erro])}</small>
            )}
            {(fase === "disponivel" || fase === "erro") && (
              <div className="update-actions">
                <button className="btn-link" onClick={() => void instalarAtualizacao()}>
                  {fase === "erro" ? <Trans>Try again</Trans> : <Trans>Update now</Trans>}
                </button>
                <button className="btn-link" onClick={adiarAtualizacao}>
                  <Trans>Later</Trans>
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {podeFechar && (
        <button
          className="update-notice-close"
          onClick={adiarAtualizacao}
          title={t`Remind me in an hour`}
          aria-label={t`Remind me in an hour`}
        >
          <IconClose size={15} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------ em Configurações */

export function SecaoAtualizacao() {
  const { t, i18n } = useLingui();
  const estado = useAtualizacao();

  useEffect(() => {
    void carregarVersaoAtual();
  }, []);

  if (!atualizacaoDisponivelAqui) return null;

  const { versaoAtual, versaoNova, fase } = estado;
  const ocupado = fase === "procurando" || fase === "baixando" || fase === "reiniciando";
  const temVersaoNova =
    versaoNova !== null &&
    (fase === "disponivel" || fase === "baixando" || fase === "pronta" || fase === "contagem" ||
      fase === "reiniciando" || fase === "reabrir" || (fase === "erro" && estado.erro !== null));

  return (
    <>
      <h4 className="settings-head">
        <Trans>WhatsCord for desktop</Trans>
      </h4>
      <p className="settings-note">
        {versaoAtual ? t`You are using version ${versaoAtual}.` : t`Updates are checked automatically every few hours.`}
      </p>

      {/*
        O interruptor. Ligado por padrão: quem não mexe em nada fica em dia. A
        frase diz a regra que importa para confiar nele — nunca durante uma
        chamada, nunca com uma mensagem pela metade.
      */}
      <label className="device-toggle update-auto">
        <input
          type="checkbox"
          checked={estado.automatico}
          onChange={(e) => definirAtualizacaoAutomatica(e.target.checked)}
        />
        <span>
          <Trans>Update automatically</Trans>
          <small>
            <Trans>
              Downloads in the background and installs when you're not using the app — never during a call or while
              you're typing.
            </Trans>
          </small>
        </span>
      </label>

      {fase === "procurando" && (
        <p className="settings-note">
          <Trans>Checking for updates…</Trans>
        </p>
      )}
      {fase === "em-dia" && (
        <p className="settings-note update-ok">
          <Trans>You're up to date.</Trans>
        </p>
      )}
      {temVersaoNova && versaoNova && (
        <p className="settings-note update-ok">
          {fase === "pronta" || fase === "contagem"
            ? t`Version ${versaoNova} is downloaded and ready to install.`
            : t`Version ${versaoNova} is available.`}
        </p>
      )}
      {fase === "pronta" && estado.seguradaPelaChamada && (
        <p className="settings-note">
          <Trans>It will be installed when your call ends — never during one.</Trans>
        </p>
      )}
      {fase === "baixando" && <Progresso estado={estado} />}
      {fase === "reiniciando" && (
        <p className="settings-note">
          <Trans>Installing… WhatsCord will restart.</Trans>
        </p>
      )}
      {fase === "reabrir" && (
        <p className="settings-note">
          <Trans>Update installed. Close and reopen WhatsCord to finish.</Trans>
        </p>
      )}
      {fase === "erro" && estado.erro && <div className="form-error">{i18n._(ERROS[estado.erro])}</div>}

      {(fase === "pronta" || fase === "contagem") && !estado.seguradaPelaChamada ? (
        <button className="btn-primary" onClick={() => void instalarAtualizacao()}>
          <Trans>Restart and update</Trans>
        </button>
      ) : versaoNova && (fase === "disponivel" || fase === "erro") ? (
        <button className="btn-primary" onClick={() => void instalarAtualizacao()}>
          <Trans>Update now</Trans>
        </button>
      ) : (
        <button
          className="btn-outline update-check"
          disabled={ocupado || fase === "reabrir" || fase === "pronta" || fase === "contagem"}
          onClick={() => void procurarAtualizacao({ silencioso: false })}
        >
          <Trans>Check for updates</Trans>
        </button>
      )}
    </>
  );
}
