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
  fecharNovidades,
  instalarAtualizacao,
  itensDaVersaoNova,
  novidadesDaVersao,
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

/**
 * As notas de uma versão como lista. Texto puro: as notas do `latest.json` não
 * são assinadas, então nunca viram HTML.
 */
function ListaDeNotas({ itens }: { itens: string[] }) {
  if (itens.length === 0) return null;
  return (
    <ul className="update-notes">
      {itens.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
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
  const notas = itensDaVersaoNova(estado);

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
            {/*
              "Reinicie para atualizar" em cima, e não "versão X pronta": o que
              a pessoa precisa decidir é se reinicia. As notas vêm logo abaixo,
              porque é o que faz valer a pena reiniciar agora e não depois.
            */}
            <strong>{t`Restart to update`}</strong>
            <small>
              {t`WhatsCord ${versao} is ready`}
              {" · "}
              {estado.automatico ? (
                <Trans>It will install on its own when you're not using the app. Or restart now.</Trans>
              ) : (
                <Trans>Restart to finish updating.</Trans>
              )}
            </small>
            {notas.length > 0 && <span className="update-notes-label">{t`What's new`}</span>}
            <ListaDeNotas itens={notas} />
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
            {fase === "disponivel" && <ListaDeNotas itens={notas} />}
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

/* ------------------------------------------------- depois de atualizar */

/**
 * "O WhatsCord foi atualizado": aparece na primeira abertura depois de uma
 * versão nova, com o que mudou.
 *
 * Existe porque a atualização costuma instalar SEM ninguém ver — ao abrir, ou
 * com o app parado na bandeja. Sem isto, a pessoa só percebe a mudança quando
 * tropeça nela.
 *
 * Opcional por desenho: não bloqueia nada, fecha com um clique e não volta até
 * a próxima versão. Quem pulou versões vê as que perdeu, da mais nova para a
 * mais velha.
 */
export function NovidadesDaVersao() {
  const { t } = useLingui();
  const estado = useAtualizacao();
  if (!atualizacaoDisponivelAqui || estado.novidades.length === 0) return null;

  const [maisNova, ...anteriores] = estado.novidades;
  const versao = maisNova.versao;
  return (
    <div className="update-notice novidades" role="status" aria-live="polite">
      <div className="update-notice-text">
        <strong>{t`WhatsCord updated to ${versao}`}</strong>
        <span className="update-notes-label">{t`What's new`}</span>
        <div className="update-notes-scroll">
          <ListaDeNotas itens={maisNova.itens} />
          {anteriores.map(({ versao: anterior, itens }) => (
            <div key={anterior}>
              <span className="update-notes-label">{t`Version ${anterior}`}</span>
              <ListaDeNotas itens={itens} />
            </div>
          ))}
        </div>
        <div className="update-actions">
          <button className="btn-link" onClick={fecharNovidades}>
            <Trans>Got it</Trans>
          </button>
        </div>
      </div>
      <button className="update-notice-close" onClick={fecharNovidades} title={t`Close`} aria-label={t`Close`}>
        <IconClose size={15} />
      </button>
    </div>
  );
}

/**
 * Os avisos do app, empilhados no canto. Uma pilha e não dois `position: fixed`
 * independentes: logo depois de atualizar pode haver as novidades E, dias
 * depois, uma versão nova pronta ao mesmo tempo — soltos, um cobriria o outro.
 */
export function AvisosDoApp() {
  return (
    <div className="update-stack">
      <NovidadesDaVersao />
      <AvisoDeAtualizacao />
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
  const novidadesAtuais = novidadesDaVersao(versaoAtual);
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
        As novidades da versão instalada continuam aqui depois que o aviso some.
        Fechado por padrão: quem abre Atualizações quase sempre veio procurar
        versão nova, não reler o que já leu.
      */}
      {novidadesAtuais.length > 0 && (
        <details className="update-notes-details">
          <summary>{t`What's new in version ${versaoAtual}`}</summary>
          <ListaDeNotas itens={novidadesAtuais} />
        </details>
      )}

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
        <>
          <p className="settings-note update-ok">
            {fase === "pronta" || fase === "contagem"
              ? t`Version ${versaoNova} is downloaded and ready to install.`
              : t`Version ${versaoNova} is available.`}
          </p>
          <ListaDeNotas itens={itensDaVersaoNova(estado)} />
        </>
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
