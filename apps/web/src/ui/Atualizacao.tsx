import { useEffect, useSyncExternalStore } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { porcentagem, type TipoDeErro } from "../lib/atualizacao";
import {
  assinarAtualizacao,
  atualizacaoDisponivelAqui,
  carregarVersaoAtual,
  estadoDaAtualizacao,
  fecharAviso,
  instalarAtualizacao,
  procurarAtualizacao,
  type EstadoDaAtualizacao
} from "../lib/atualizador";
import { IconClose } from "./icons";

/**
 * O que a pessoa vê da atualização do app desktop: um aviso discreto quando há
 * versão nova, e uma seção em Configurações para procurar na hora.
 *
 * Nada disto aparece no navegador nem no Android — os dois componentes saem
 * `null` quando `atualizacaoDisponivelAqui` é falso, e a seção nem entra na
 * lista de Configurações.
 */

function useAtualizacao(): EstadoDaAtualizacao {
  return useSyncExternalStore(assinarAtualizacao, estadoDaAtualizacao, estadoDaAtualizacao);
}

/*
 * `msg` + `i18n._()`, e não uma função que recebe `t`: um `t` vindo por
 * parâmetro faz a extração ignorar a mensagem em silêncio (ver Settings.tsx).
 */
const ERROS: Record<TipoDeErro, MessageDescriptor> = {
  offline: msg`Could not reach the update server. Check your internet connection and try again.`,
  "sem-versao-publicada": msg`No update has been published yet. Try again later.`,
  assinatura: msg`The update could not be verified, so it was not installed. Try again later.`,
  outro: msg`Something went wrong with the update. Try again later.`
};

/** Tamanho baixado quando o servidor não disse o total, em MB com uma casa. */
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

/* ------------------------------------------------------------------ aviso */

export function AvisoDeAtualizacao() {
  const { t, i18n } = useLingui();
  const estado = useAtualizacao();

  if (!atualizacaoDisponivelAqui || !estado.versaoNova) return null;
  if (estado.avisoFechado === estado.versaoNova) return null;
  const visivel =
    estado.fase === "disponivel" ||
    estado.fase === "baixando" ||
    estado.fase === "reiniciando" ||
    estado.fase === "reabrir" ||
    estado.fase === "erro";
  if (!visivel) return null;

  const versao = estado.versaoNova;
  const ocupado = estado.fase === "baixando" || estado.fase === "reiniciando";

  return (
    <div className="update-notice" role="status" aria-live="polite">
      <div className="update-notice-text">
        <strong>{t`WhatsCord ${versao} is available`}</strong>
        {estado.fase === "baixando" && <Progresso estado={estado} />}
        {estado.fase === "reiniciando" && <small>{t`Installing… WhatsCord will restart.`}</small>}
        {estado.fase === "reabrir" && (
          <small>{t`Update installed. Close and reopen WhatsCord to finish.`}</small>
        )}
        {estado.fase === "erro" && estado.erro && <small className="update-error">{i18n._(ERROS[estado.erro])}</small>}
        {(estado.fase === "disponivel" || estado.fase === "erro") && (
          <button className="btn-link" onClick={() => void instalarAtualizacao()}>
            {estado.fase === "erro" ? <Trans>Try again</Trans> : <Trans>Update now</Trans>}
          </button>
        )}
      </div>
      {!ocupado && (
        <button className="update-notice-close" onClick={fecharAviso} title={t`Dismiss`} aria-label={t`Dismiss`}>
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

  const versaoAtual = estado.versaoAtual;
  const versaoNova = estado.versaoNova;
  const ocupado =
    estado.fase === "procurando" || estado.fase === "baixando" || estado.fase === "reiniciando";

  return (
    <>
      <h4 className="settings-head">
        <Trans>WhatsCord for desktop</Trans>
      </h4>
      <p className="settings-note">
        {versaoAtual ? t`You are using version ${versaoAtual}.` : t`Updates are checked automatically every few hours.`}
      </p>

      {estado.fase === "procurando" && (
        <p className="settings-note">
          <Trans>Checking for updates…</Trans>
        </p>
      )}
      {estado.fase === "em-dia" && (
        <p className="settings-note update-ok">
          <Trans>You're up to date.</Trans>
        </p>
      )}
      {versaoNova &&
        (estado.fase === "disponivel" ||
          estado.fase === "baixando" ||
          estado.fase === "reiniciando" ||
          estado.fase === "reabrir" ||
          (estado.fase === "erro" && estado.erro !== null)) && (
          <p className="settings-note update-ok">{t`Version ${versaoNova} is available.`}</p>
        )}
      {estado.fase === "baixando" && <Progresso estado={estado} />}
      {estado.fase === "reiniciando" && (
        <p className="settings-note">
          <Trans>Installing… WhatsCord will restart.</Trans>
        </p>
      )}
      {estado.fase === "reabrir" && (
        <p className="settings-note">
          <Trans>Update installed. Close and reopen WhatsCord to finish.</Trans>
        </p>
      )}
      {estado.fase === "erro" && estado.erro && <div className="form-error">{i18n._(ERROS[estado.erro])}</div>}

      {versaoNova && (estado.fase === "disponivel" || estado.fase === "erro") ? (
        <button className="btn-primary" onClick={() => void instalarAtualizacao()}>
          <Trans>Update now</Trans>
        </button>
      ) : (
        <button
          className="btn-outline update-check"
          disabled={ocupado || estado.fase === "reabrir"}
          onClick={() => void procurarAtualizacao({ silencioso: false })}
        >
          <Trans>Check for updates</Trans>
        </button>
      )}
      {versaoNova && estado.fase === "erro" && (
        <button
          className="btn-link update-recheck"
          onClick={() => void procurarAtualizacao({ silencioso: false })}
        >
          <Trans>Check again</Trans>
        </button>
      )}
    </>
  );
}
