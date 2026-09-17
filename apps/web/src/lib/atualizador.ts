import type { Update } from "@tauri-apps/plugin-updater";
import { useStore } from "../store";
import {
  CONTAGEM_MS,
  ESPERA_ANTES_DE_VERIFICAR_MS,
  PROGRESSO_INICIAL,
  adiadoAte,
  adiar,
  aplicarEvento,
  atualizarAutomaticamente,
  decidirInstalacao,
  deveVerificar,
  ehAppDesktop,
  haRascunho,
  instalarAoSair,
  limparAdiamento,
  marcarVerificacao,
  porcentagem,
  salvarAtualizarAutomaticamente,
  tipoDeErro,
  ultimaVerificacao,
  vistaPelaPrimeiraVez,
  type Momento,
  type Progresso,
  type TipoDeErro
} from "./atualizacao";

/**
 * A atualização do app desktop, do lado que conversa com o plugin.
 *
 * A regra que organiza tudo: BAIXAR na hora, em silêncio; INSTALAR só num
 * momento seguro — ao abrir, antes de a pessoa começar; ao sair; ou quando
 * ninguém está usando. Quem decide é `decidirInstalacao`, pura e testada em
 * `atualizacao.ts`; aqui só se coleta o momento e se obedece.
 *
 * O estado mora fora do React para o aviso, o indicador e as Configurações
 * mostrarem a mesma coisa, e para o agendamento seguir com a tela fechada.
 */

export type FaseDaAtualizacao =
  | "parado" // ninguém procurou ainda nesta sessão
  | "procurando"
  | "em-dia"
  | "disponivel" // achou; com o automático desligado, espera a pessoa
  | "baixando"
  | "pronta" // baixada, esperando um momento seguro
  | "contagem" // vai instalar em segundos; dá para adiar
  | "reiniciando" // instalando; o app fecha e volta sozinho
  | "reabrir" // instalou, mas não conseguiu voltar sozinho
  | "erro";

export type EstadoDaAtualizacao = {
  fase: FaseDaAtualizacao;
  versaoAtual: string | null;
  versaoNova: string | null;
  notas: string | null;
  progresso: Progresso;
  erro: TipoDeErro | null;
  automatico: boolean;
  /** A instalação está segurada por uma chamada em andamento. */
  seguradaPelaChamada: boolean;
  contagemAte: number | null;
  adiadoAte: number | null;
  /** Quando esta versão foi vista pela primeira vez — base do escalonamento. */
  vistaEm: number | null;
  /** O download/erro em curso foi pedido pela pessoa (os automáticos são silenciosos). */
  pedidoPelaPessoa: boolean;
};

let estado: EstadoDaAtualizacao = {
  fase: "parado",
  versaoAtual: null,
  versaoNova: null,
  notas: null,
  progresso: PROGRESSO_INICIAL,
  erro: null,
  automatico: atualizarAutomaticamente(),
  seguradaPelaChamada: false,
  contagemAte: null,
  adiadoAte: adiadoAte(),
  vistaEm: null,
  pedidoPelaPessoa: false
};

/** O `Update` do plugin. Depois de `download()`, os bytes vivem nele. */
let pendente: Update | null = null;
let procurandoAgora: Promise<void> | null = null;
let temporizadorDaContagem: ReturnType<typeof setInterval> | null = null;

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

export const atualizacaoDisponivelAqui: boolean =
  typeof window !== "undefined" &&
  typeof navigator !== "undefined" &&
  ehAppDesktop("__TAURI_INTERNALS__" in window, navigator.userAgent);

/** Há uma versão nova esperando — é o que acende o indicador na barra. */
export function temAtualizacaoPendente(e: EstadoDaAtualizacao): boolean {
  return (
    e.versaoNova !== null &&
    (e.fase === "disponivel" || e.fase === "pronta" || e.fase === "contagem" || e.fase === "baixando")
  );
}

/* ------------------------------------------------------------ o momento */

const abriuEm = Date.now();
let ultimaInteracao = Date.now();
let interagiu = false;

function momento(): Momento {
  const agora = Date.now();
  return {
    emChamada: useStore.getState().call !== null,
    temRascunho: haRascunho(
      document.querySelector<HTMLTextAreaElement>(".composer textarea"),
      document.activeElement as HTMLInputElement | null
    ),
    janelaVisivel: document.visibilityState === "visible",
    ociosoMs: agora - ultimaInteracao,
    desdeQueAbriuMs: agora - abriuEm,
    interagiuDesdeQueAbriu: interagiu,
    pendenteHaMs: estado.vistaEm === null ? 0 : agora - estado.vistaEm,
    automatico: estado.automatico,
    adiadoAte: estado.adiadoAte,
    agora
  };
}

/* ---------------------------------------------------------------- versão */

export async function carregarVersaoAtual(): Promise<void> {
  if (!atualizacaoDisponivelAqui || estado.versaoAtual) return;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    mudar({ versaoAtual: await getVersion() });
  } catch {
    /* sem versão, a tela só não mostra o número */
  }
}

/* -------------------------------------------------------------- procurar */

function ocupadaComVersaoNova(): boolean {
  return (
    estado.fase === "baixando" ||
    estado.fase === "pronta" ||
    estado.fase === "contagem" ||
    estado.fase === "reiniciando"
  );
}

export function procurarAtualizacao({ silencioso }: { silencioso: boolean }): Promise<void> {
  if (!atualizacaoDisponivelAqui) return Promise.resolve();
  // Uma versão já baixada não pode ser trocada: os bytes vivem no `Update` antigo.
  if (ocupadaComVersaoNova()) return Promise.resolve();
  if (procurandoAgora) return procurandoAgora;

  const anterior = estado.fase;
  if (!silencioso) mudar({ fase: "procurando", erro: null });

  procurandoAgora = (async () => {
    try {
      void carregarVersaoAtual();
      const { check } = await import("@tauri-apps/plugin-updater");
      const achada = await check({ timeout: 30_000 });
      marcarVerificacao(Date.now());

      const velho = pendente;
      pendente = achada;
      if (velho && velho !== achada) void velho.close().catch(() => {});

      if (!achada) {
        mudar({ fase: "em-dia", versaoNova: null, notas: null, erro: null, vistaEm: null });
        return;
      }
      mudar({
        fase: "disponivel",
        versaoAtual: achada.currentVersion || estado.versaoAtual,
        versaoNova: achada.version,
        notas: achada.body?.trim() || null,
        vistaEm: vistaPelaPrimeiraVez(achada.version, Date.now()),
        erro: null
      });
      if (estado.automatico) void baixar({ pedidoPelaPessoa: false });
    } catch (err) {
      const tipo = tipoDeErro(err, navigator.onLine);
      if (silencioso) {
        console.warn("[atualizacao] verificação automática falhou:", err);
        if (estado.fase === "procurando") mudar({ fase: anterior });
      } else {
        console.warn("[atualizacao] verificação falhou:", err);
        mudar({ fase: "erro", erro: tipo, pedidoPelaPessoa: true });
      }
    } finally {
      procurandoAgora = null;
    }
  })();

  return procurandoAgora;
}

/* ---------------------------------------------------------------- baixar */

async function baixar({ pedidoPelaPessoa }: { pedidoPelaPessoa: boolean }): Promise<boolean> {
  const update = pendente;
  if (!update || estado.fase === "baixando") return false;

  let progresso = PROGRESSO_INICIAL;
  mudar({ fase: "baixando", progresso, erro: null, pedidoPelaPessoa });
  try {
    await update.download((evento) => {
      const antes = progresso;
      progresso = aplicarEvento(progresso, evento);
      // Centenas de eventos por segundo: só avisa a tela quando algo VISÍVEL mudou.
      const mudouAlgo =
        evento.event !== "Progress" ||
        porcentagem(antes) !== porcentagem(progresso) ||
        (progresso.total === null &&
          Math.floor(antes.baixado / 100_000) !== Math.floor(progresso.baixado / 100_000));
      if (mudouAlgo) mudar({ progresso });
    });
  } catch (err) {
    console.warn("[atualizacao] download falhou:", err);
    if (pedidoPelaPessoa) mudar({ fase: "erro", erro: tipoDeErro(err, navigator.onLine) });
    else mudar({ fase: "disponivel", progresso: PROGRESSO_INICIAL });
    return false;
  }
  mudar({ fase: "pronta", progresso: { ...progresso, terminou: true } });
  avaliar();
  return true;
}

/* -------------------------------------------------------------- instalar */

function pararContagem() {
  if (temporizadorDaContagem) clearInterval(temporizadorDaContagem);
  temporizadorDaContagem = null;
}

/**
 * Instala. No Windows o instalador roda em modo silencioso (`quiet`, sem
 * janela) e o próprio plugin ENCERRA o app — então a linha seguinte
 * normalmente nunca roda lá. Com `reabrir`, o instalador abre o WhatsCord de
 * novo ao terminar; ao sair, não.
 */
async function instalar({ reabrir }: { reabrir: boolean }): Promise<void> {
  const update = pendente;
  if (!update) return;
  pararContagem();
  mudar({ fase: "reiniciando", contagemAte: null });
  try {
    await update.install({ restartAfterInstall: reabrir });
  } catch (err) {
    console.warn("[atualizacao] instalação falhou:", err);
    mudar({ fase: "erro", erro: tipoDeErro(err, navigator.onLine), pedidoPelaPessoa: true });
    return;
  }
  limparAdiamento();
  if (!reabrir) return;
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    console.warn("[atualizacao] não foi possível reiniciar:", err);
    mudar({ fase: "reabrir" });
  }
}

/** "Atualizar agora" / "Reiniciar agora": pedido explícito. Mesmo assim, nunca numa chamada. */
export async function instalarAtualizacao(): Promise<void> {
  if (useStore.getState().call !== null) return;
  if (estado.fase === "baixando" || estado.fase === "reiniciando") return;
  if (estado.fase === "pronta" || estado.fase === "contagem") {
    await instalar({ reabrir: true });
    return;
  }
  if (await baixar({ pedidoPelaPessoa: true })) await instalar({ reabrir: true });
}

/* ------------------------------------------------------------ agendamento */

function comecarContagem() {
  if (estado.fase === "contagem") return;
  mudar({ fase: "contagem", contagemAte: Date.now() + CONTAGEM_MS });
  temporizadorDaContagem = setInterval(() => {
    // A cada segundo a decisão é refeita: chamada ou rascunho no meio cancelam.
    const d = decidirInstalacao(momento());
    if (d !== "instalar-com-contagem" && d !== "instalar-ja") {
      pararContagem();
      mudar({ fase: "pronta", contagemAte: null });
      return;
    }
    if (estado.contagemAte !== null && Date.now() >= estado.contagemAte) void instalar({ reabrir: true });
  }, 1000);
}

function avaliar() {
  if (estado.fase !== "pronta") return;
  const m = momento();
  mudar({ seguradaPelaChamada: m.emChamada });
  const decisao = decidirInstalacao(m);
  if (decisao === "instalar-ja") void instalar({ reabrir: true });
  else if (decisao === "instalar-com-contagem") comecarContagem();
}

/** "Mais tarde" / "Adiar": o prazo encurta conforme a versão envelhece. */
export function adiarAtualizacao(): void {
  pararContagem();
  const agora = Date.now();
  const ate = adiar(agora, estado.vistaEm === null ? 0 : agora - estado.vistaEm);
  mudar({
    adiadoAte: ate,
    contagemAte: null,
    fase: estado.fase === "contagem" ? "pronta" : estado.fase
  });
}

export function definirAtualizacaoAutomatica(ligado: boolean): void {
  salvarAtualizarAutomaticamente(ligado);
  mudar({ automatico: ligado });
  if (!ligado && estado.fase === "contagem") {
    pararContagem();
    mudar({ fase: "pronta", contagemAte: null });
  }
  if (ligado && estado.fase === "disponivel") void baixar({ pedidoPelaPessoa: false });
  avaliar();
}

/**
 * O "Sair" da bandeja avisa por este evento antes de encerrar (ver
 * `montar_bandeja` em lib.rs, que também encerra sozinho em 5 s se ninguém
 * responder — "Sair" nunca pode deixar de sair).
 *
 * Com versão baixada, instala em silêncio SEM reabrir: é o padrão do
 * electron-updater e o que o Chrome faz. Sem nada a instalar, sai na hora.
 */
async function aoSair(): Promise<void> {
  if (instalarAoSair(estado.fase, estado.automatico) && pendente) {
    await instalar({ reabrir: false });
    return;
  }
  try {
    const { exit } = await import("@tauri-apps/plugin-process");
    await exit(0);
  } catch {
    /* o lado nativo encerra sozinho em instantes */
  }
}

export function iniciarVerificacaoAutomatica(): () => void {
  if (!atualizacaoDisponivelAqui) return () => {};

  const talvez = () => {
    if (deveVerificar(ultimaVerificacao(), Date.now())) void procurarAtualizacao({ silencioso: true });
  };
  const primeira = setTimeout(talvez, ESPERA_ANTES_DE_VERIFICAR_MS);
  const repetir = setInterval(talvez, 30 * 60 * 1000);
  const olhar = setInterval(avaliar, 30 * 1000);

  const mexeu = () => {
    ultimaInteracao = Date.now();
    interagiu = true;
  };
  const gestos = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
  for (const g of gestos) window.addEventListener(g, mexeu, { passive: true });

  document.addEventListener("visibilitychange", avaliar);
  const soltarStore = useStore.subscribe((s, antes) => {
    if (s.call !== antes.call) avaliar();
  });

  let soltarSaida: (() => void) | null = null;
  let desligado = false;
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen("whatscord://saindo", () => void aoSair()))
    .then((soltar) => {
      if (desligado) soltar();
      else soltarSaida = soltar;
    })
    .catch(() => {
      /* sem o evento, "Sair" continua saindo pelo lado nativo */
    });

  return () => {
    desligado = true;
    clearTimeout(primeira);
    clearInterval(repetir);
    clearInterval(olhar);
    pararContagem();
    for (const g of gestos) window.removeEventListener(g, mexeu);
    document.removeEventListener("visibilitychange", avaliar);
    soltarStore();
    soltarSaida?.();
  };
}
