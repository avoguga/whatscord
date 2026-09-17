/**
 * Atualização do app desktop — a parte que conversa com o Tauri.
 *
 * O plugin entra por `import()` dinâmico, e só depois de `ehAppDesktop` dizer
 * que sim. Assim o Vite o põe num pedaço separado do bundle, e quem abre o
 * WhatsCord no navegador ou no celular nunca baixa uma linha dele. Um `import`
 * estático no topo deste arquivo desfaria isso sem erro nenhum — o bundle só
 * ficaria maior para todo mundo.
 *
 * O estado mora aqui, fora do React, porque dois lugares olham para ele: o
 * aviso que aparece sozinho e a seção de Configurações. Se a verificação
 * automática achou uma versão, Configurações já abre sabendo; se o download
 * começou por um, o outro mostra o progresso.
 *
 * Nenhum texto é traduzido aqui (sem Lingui): o estado diz O QUE aconteceu, e
 * a tela escolhe as palavras.
 */
import type { Update } from "@tauri-apps/plugin-updater";
import {
  ESPERA_ANTES_DE_VERIFICAR_MS,
  PROGRESSO_INICIAL,
  aplicarEvento,
  deveVerificar,
  ehAppDesktop,
  marcarVerificacao,
  porcentagem,
  tipoDeErro,
  ultimaVerificacao,
  type Progresso,
  type TipoDeErro
} from "./atualizacao";

export type FaseDaAtualizacao =
  | "parado" // ninguém procurou ainda nesta sessão
  | "procurando"
  | "em-dia"
  | "disponivel"
  | "baixando"
  | "reiniciando" // instalou; falta o app voltar
  | "reabrir" // instalou, mas não conseguiu reiniciar sozinho
  | "erro";

export type EstadoDaAtualizacao = {
  fase: FaseDaAtualizacao;
  versaoAtual: string | null;
  versaoNova: string | null;
  notas: string | null;
  progresso: Progresso;
  erro: TipoDeErro | null;
  /** Versão cujo aviso a pessoa fechou. Só nesta sessão. */
  avisoFechado: string | null;
};

let estado: EstadoDaAtualizacao = {
  fase: "parado",
  versaoAtual: null,
  versaoNova: null,
  notas: null,
  progresso: PROGRESSO_INICIAL,
  erro: null,
  avisoFechado: null
};
let pendente: Update | null = null;
let procurandoAgora: Promise<void> | null = null;
const ouvintes = new Set<() => void>();

function mudar(parcial: Partial<EstadoDaAtualizacao>) {
  estado = { ...estado, ...parcial };
  for (const o of ouvintes) o();
}

export function estadoDaAtualizacao(): EstadoDaAtualizacao {
  return estado;
}

export function assinarAtualizacao(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

/** Calculado uma vez: nem a janela nem o agente mudam com o app aberto. */
export const atualizacaoDisponivelAqui: boolean =
  typeof window !== "undefined" &&
  typeof navigator !== "undefined" &&
  ehAppDesktop("__TAURI_INTERNALS__" in window, navigator.userAgent);

export async function carregarVersaoAtual(): Promise<void> {
  if (!atualizacaoDisponivelAqui || estado.versaoAtual) return;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    mudar({ versaoAtual: await getVersion() });
  } catch {
    // Sem a versão a seção só não mostra o número; não é motivo de erro.
  }
}

/**
 * Procura uma versão nova.
 *
 * `silencioso` é a verificação automática: se falhar (sem internet, nenhuma
 * release publicada ainda, assinatura que não bate), ninguém fica sabendo e o
 * estado volta ao que era. Na manual, a pessoa pediu — então ela vê o motivo.
 *
 * A marca das 6 horas só é gravada quando a pergunta teve RESPOSTA. Marcar uma
 * tentativa que falhou por falta de rede adiaria a próxima por 6 horas à toa.
 */
export function procurarAtualizacao({ silencioso }: { silencioso: boolean }): Promise<void> {
  if (!atualizacaoDisponivelAqui) return Promise.resolve();
  // Baixando ou já instalado: procurar de novo trocaria o `Update` no meio.
  if (estado.fase === "baixando" || estado.fase === "reiniciando") return Promise.resolve();
  if (procurandoAgora) return procurandoAgora;

  const anterior = estado.fase;
  if (!silencioso) mudar({ fase: "procurando", erro: null });

  procurandoAgora = (async () => {
    try {
      void carregarVersaoAtual();
      const { check } = await import("@tauri-apps/plugin-updater");
      const achada = await check({ timeout: 30_000 });
      marcarVerificacao(Date.now());

      // O `Update` é um recurso do lado Rust; o antigo precisa ser solto.
      const velho = pendente;
      pendente = achada;
      if (velho && velho !== achada) void velho.close().catch(() => {});

      if (achada) {
        mudar({
          fase: "disponivel",
          versaoAtual: achada.currentVersion || estado.versaoAtual,
          versaoNova: achada.version,
          notas: achada.body?.trim() || null,
          erro: null
        });
      } else {
        mudar({ fase: "em-dia", versaoNova: null, notas: null, erro: null });
      }
    } catch (err) {
      const tipo = tipoDeErro(err, typeof navigator === "undefined" ? true : navigator.onLine);
      if (silencioso) {
        console.warn("[atualizacao] verificação automática falhou:", err);
        if (estado.fase === "procurando") mudar({ fase: anterior });
      } else {
        console.warn("[atualizacao] verificação falhou:", err);
        mudar({ fase: "erro", erro: tipo });
      }
    } finally {
      procurandoAgora = null;
    }
  })();
  return procurandoAgora;
}

/**
 * Baixa, instala e reinicia.
 *
 * No Windows quem termina a história é o próprio plugin: depois de abrir o
 * instalador ele ENCERRA o app (está na documentação de `downloadAndInstall`),
 * e com o NSIS em modo "passive" o instalador reabre o WhatsCord ao final.
 * Então, no Windows, a linha depois de `downloadAndInstall` normalmente nunca
 * roda. O `relaunch()` fica para macOS e Linux, onde a instalação volta e o app
 * continua aberto na versão velha até reiniciar.
 *
 * Se o reinício falhar, a instalação já aconteceu: não é erro, é pedir para a
 * pessoa fechar e abrir.
 */
export async function instalarAtualizacao(): Promise<void> {
  const update = pendente;
  if (!update || estado.fase === "baixando" || estado.fase === "reiniciando") return;

  let progresso = PROGRESSO_INICIAL;
  mudar({ fase: "baixando", progresso, erro: null });

  try {
    await update.downloadAndInstall((evento) => {
      const antes = progresso;
      progresso = aplicarEvento(progresso, evento);
      /*
       * Um evento por pedaço do download são centenas por segundo. Só avisa a
       * tela quando algo VISÍVEL mudou: a porcentagem, ou — quando o servidor
       * não disse o tamanho — cada 100 KB a mais.
       */
      const mudouAlgo =
        evento.event !== "Progress" ||
        porcentagem(antes) !== porcentagem(progresso) ||
        (progresso.total === null &&
          Math.floor(antes.baixado / 100_000) !== Math.floor(progresso.baixado / 100_000));
      if (mudouAlgo) mudar({ progresso });
    });
  } catch (err) {
    console.warn("[atualizacao] download/instalação falhou:", err);
    mudar({ fase: "erro", erro: tipoDeErro(err, navigator.onLine) });
    return;
  }

  mudar({ fase: "reiniciando", progresso: { ...progresso, terminou: true } });
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    console.warn("[atualizacao] não foi possível reiniciar:", err);
    mudar({ fase: "reabrir" });
  }
}

export function fecharAviso(): void {
  mudar({ avisoFechado: estado.versaoNova });
}

/**
 * A verificação automática: alguns segundos depois de abrir, e de novo a cada
 * hora enquanto o app segue aberto — mas só procura de fato quando já passaram
 * 6 horas da última resposta. O app vive na bandeja do Windows por dias; sem a
 * repetição, quem nunca fecha nunca veria uma versão nova.
 *
 * Devolve a função que desliga os temporizadores.
 */
export function iniciarVerificacaoAutomatica(): () => void {
  if (!atualizacaoDisponivelAqui) return () => {};

  const talvez = () => {
    if (deveVerificar(ultimaVerificacao(), Date.now())) void procurarAtualizacao({ silencioso: true });
  };
  const primeira = setTimeout(talvez, ESPERA_ANTES_DE_VERIFICAR_MS);
  const repetir = setInterval(talvez, 60 * 60 * 1000);
  return () => {
    clearTimeout(primeira);
    clearInterval(repetir);
  };
}
