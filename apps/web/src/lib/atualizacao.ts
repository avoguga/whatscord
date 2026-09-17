/**
 * Atualização do app desktop — as decisões, sem nada em volta.
 *
 * Quem baixa e instala é `lib/atualizador.ts`, e quem desenha é
 * `ui/Atualizacao.tsx`. Aqui fica só o que dá para verificar sem navegador e
 * sem Tauri: em que ambiente a atualização existe, quando vale procurar de
 * novo, quanto do download já veio e que tipo de erro foi aquele.
 *
 * Por isso este arquivo não importa NADA — nem o macro do Lingui (explode em
 * Node, e já quebrou os testes duas vezes), nem React, nem o plugin do Tauri.
 * Os tipos do evento de download são repetidos à mão pelo mesmo motivo: o teste
 * roda sem o pacote do plugin ter o que fazer.
 */

/** Espera depois de abrir o app antes da verificação automática. */
/*
 * Tres segundos, e nao oito: a primeira verificacao e o que viabiliza atualizar
 * AO ABRIR, antes de a pessoa comecar a usar (o padrao do Discord). Oito
 * segundos ja e tempo de alguem ter clicado numa conversa.
 */
export const ESPERA_ANTES_DE_VERIFICAR_MS = 3_000;

/** Intervalo mínimo entre duas verificações automáticas. */
/*
 * Duas horas, e nao seis. O app vive dias na bandeja do Windows, e consultar
 * o `latest.json` custa um pedido pequeno a CDN do GitHub — nao a API, que tem
 * limite. Seis horas deixava quem nunca fecha o app quase um dia atras.
 */
export const INTERVALO_ENTRE_VERIFICACOES_MS = 2 * 60 * 60 * 1000;

const CHAVE_ULTIMA_VERIFICACAO = "whatscord.atualizacao.ultimaVerificacao";

/**
 * A atualização só existe no app instalado no computador.
 *
 * `__TAURI_INTERNALS__` separa o app do navegador comum — mas o APK também é
 * Tauri e também tem essa variável. O plugin de atualização não é registrado no
 * Android (lá quem atualiza é a loja, ou um APK novo), e chamar um comando que
 * não existe só renderia um erro na tela. Daí o segundo teste, pelo agente.
 */
export function ehAppDesktop(temTauri: boolean, userAgent: string): boolean {
  return temTauri && !/Android/i.test(userAgent);
}

/**
 * Já está na hora de procurar de novo?
 *
 * Uma marca ilegível ou ausente conta como "nunca verificou". Uma marca no
 * FUTURO também: o relógio do computador voltou (fuso trocado, bateria da BIOS),
 * e respeitá-la calaria a verificação por quanto tempo o relógio tivesse
 * andado para trás.
 */
export function deveVerificar(ultima: number | null, agora: number): boolean {
  if (ultima === null || !Number.isFinite(ultima)) return true;
  if (ultima > agora) return true;
  return agora - ultima >= INTERVALO_ENTRE_VERIFICACOES_MS;
}

export function ultimaVerificacao(): number | null {
  try {
    const cru = localStorage.getItem(CHAVE_ULTIMA_VERIFICACAO);
    // Mesmo cuidado de `volumeDaChamada.ts`: `Number("")` vale zero, e zero é
    // um instante válido (1970) — leria como "verificou há muito tempo", o que
    // aqui por acaso dá certo, mas é por acaso.
    if (cru === null || cru.trim() === "") return null;
    const n = Number(cru);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function marcarVerificacao(agora: number): void {
  try {
    localStorage.setItem(CHAVE_ULTIMA_VERIFICACAO, String(agora));
  } catch {
    // Modo privado ou armazenamento cheio: verifica de novo na próxima abertura.
  }
}

/* --------------------------------------------------------------- download */

/** O mesmo formato do `DownloadEvent` de `@tauri-apps/plugin-updater`. */
export type EventoDeDownload =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export type Progresso = {
  /** Tamanho anunciado pelo servidor; `null` quando ele não disse. */
  total: number | null;
  baixado: number;
  terminou: boolean;
};

export const PROGRESSO_INICIAL: Progresso = { total: null, baixado: 0, terminou: false };

export function aplicarEvento(p: Progresso, e: EventoDeDownload): Progresso {
  switch (e.event) {
    case "Started": {
      /*
       * `contentLength` é opcional no plugin: vem do cabeçalho da resposta, e
       * nem todo servidor manda. Zero também não serve de total — dividiria
       * por zero.
       */
      const n = e.data.contentLength;
      return { total: typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null, baixado: 0, terminou: false };
    }
    case "Progress": {
      const n = e.data.chunkLength;
      return { ...p, baixado: p.baixado + (Number.isFinite(n) && n > 0 ? n : 0) };
    }
    case "Finished":
      return { ...p, terminou: true };
  }
}

/**
 * Porcentagem inteira de 0 a 100, ou `null` quando não há como saber.
 *
 * Arredonda para BAIXO e só diz 100 quando o download terminou de fato: "100%"
 * parado na tela enquanto o último pedaço ainda chega parece travado.
 */
export function porcentagem(p: Progresso): number | null {
  if (p.terminou) return 100;
  if (p.total === null) return null;
  return Math.max(0, Math.min(99, Math.floor((p.baixado / p.total) * 100)));
}

/* ------------------------------------------------------------------ erros */

export type TipoDeErro = "offline" | "sem-versao-publicada" | "assinatura" | "outro";

/**
 * Traduz o erro do plugin para uma de quatro situações que a pessoa entende.
 *
 * O plugin devolve texto, não código. As frases vêm de `error.rs` do
 * tauri-plugin-updater (branch v2): "Could not fetch a valid release JSON from
 * the remote" é o que sai quando o endereço de versões não responde com um JSON
 * válido — é o caso de nenhuma release publicada ainda (o GitHub devolve 404);
 * o erro de rede do reqwest chega como "error sending request for url (…)"; e
 * as falhas de assinatura mencionam "signature". Se o texto mudar numa versão
 * nova, o pior que acontece é cair em "outro", que tem mensagem genérica.
 */
export function tipoDeErro(erro: unknown, online = true): TipoDeErro {
  if (!online) return "offline";
  const texto =
    typeof erro === "string" ? erro : erro instanceof Error ? erro.message : String(erro ?? "");
  if (/signature/i.test(texto)) return "assinatura";
  if (/valid release JSON|not found in the response|platforms/i.test(texto)) return "sem-versao-publicada";
  if (/error sending request|dns|timed? ?out|connect|network|offline|failed to fetch/i.test(texto)) {
    return "offline";
  }
  return "outro";
}

/* ------------------------------------------------------------------------ */
/* QUANDO instalar                                                            */
/* ------------------------------------------------------------------------ */

/*
 * O desenho vem de como os apps de desktop maduros fazem, pesquisado com
 * fontes em 17/09/2026 (docs/decisoes.md, "Atualizacao automatica"):
 *
 * - Zoom e Teams nunca reiniciam durante uma reuniao; Teams instala quando o
 *   app esta ocioso.
 * - O Discord atualiza ao ABRIR, antes de a pessoa comecar a usar.
 * - O electron-updater, por padrao, instala ao SAIR — em silencio, sem reabrir.
 * - VS Code, Slack e Discord mantem um indicador de "atualizacao pronta" que
 *   nao some; nenhum deles reinicia sozinho no meio do uso.
 * - O Chrome escala com o tempo (2, 4 e 7 dias) em vez de deixar adiar para
 *   sempre.
 *
 * O Windows FECHA o app para instalar. Por isso a primeira pergunta nunca e
 * "tem versao nova?", e sim "reiniciar agora estragaria alguma coisa?".
 */

export type Momento = {
  /** Numa chamada de voz ou video. */
  emChamada: boolean;
  /** Ha texto na caixa de mensagem (com ou sem foco) ou num campo com foco. */
  temRascunho: boolean;
  /** A janela esta a vista (nao minimizada nem escondida na bandeja). */
  janelaVisivel: boolean;
  /** Ha quanto tempo ninguem mexe no app. */
  ociosoMs: number;
  /** Ha quanto tempo o app abriu. */
  desdeQueAbriuMs: number;
  /** Se houve QUALQUER gesto desde que o app abriu. */
  interagiuDesdeQueAbriu: boolean;
  /** Ha quanto tempo esta versao nova esta pendente (desde a primeira vez vista). */
  pendenteHaMs: number;
  /** A preferencia "Atualizar automaticamente". */
  automatico: boolean;
  /** Ate quando a pessoa pediu para adiar (epoch ms), ou null. */
  adiadoAte: number | null;
  agora: number;
};

export type Decisao =
  /** Instalar ja, sem contagem: ninguem esta usando (acabou de abrir, ou escondido e parado). */
  | "instalar-ja"
  /** Instalar depois de uma contagem com "Adiar": ha chance de alguem estar olhando. */
  | "instalar-com-contagem"
  /** So o indicador e o aviso. */
  | "avisar"
  /** Nem instalar nem oferecer botao: algo acontecendo seria estragado. */
  | "esperar";

/** Logo depois de abrir, se ninguem tocou em nada: o padrao do Discord. */
export const JANELA_DE_ABERTURA_MS = 90_000;
/** Escondido na bandeja e parado ha este tempo: ninguem esta olhando. */
export const OCIOSO_ESCONDIDO_MS = 2 * 60_000;
/** A vista, mas sem ninguem mexer ha este tempo: a pessoa saiu. */
export const OCIOSO_VISIVEL_MS = 10 * 60_000;
/** Contagem antes de reiniciar com a janela a vista. */
export const CONTAGEM_MS = 10_000;

/** Escalonamento, no espirito do Chrome: a partir daqui o adiamento encurta. */
export const PENDENTE_ESCALA_MS = 2 * 24 * 60 * 60_000;
/** A partir daqui, instala no proximo momento seguro, sem esperar ociosidade. */
export const PENDENTE_LIMITE_MS = 7 * 24 * 60 * 60_000;

/** Quanto "Mais tarde" adia: uma hora no comeco; quinze minutos depois de dois dias. */
export function adiarPorMs(pendenteHaMs: number): number {
  return pendenteHaMs >= PENDENTE_ESCALA_MS ? 15 * 60_000 : 60 * 60_000;
}

export function decidirInstalacao(m: Momento): Decisao {
  // 1. Chamada e sagrada — nem botao, que um clique distraido derrubaria.
  if (m.emChamada) return "esperar";

  // 2. Quem desligou o automatico so quer saber que existe.
  if (!m.automatico) return "avisar";

  // 3. Mensagem pela metade: reiniciar a apagaria.
  if (m.temRascunho) return "avisar";

  // 4. Acabou de abrir e ninguem tocou em nada: o reinicio leva segundos e
  //    ninguem comecou coisa alguma. Sem contagem — seria interromper para
  //    pedir licenca para interromper.
  if (m.desdeQueAbriuMs <= JANELA_DE_ABERTURA_MS && !m.interagiuDesdeQueAbriu) return "instalar-ja";

  // 5. Escondido na bandeja e parado: ninguem olhando, ninguem a quem avisar.
  //    Vale mesmo depois de "Mais tarde" — adiar e sobre nao interromper o uso,
  //    e aqui nao ha uso.
  if (!m.janelaVisivel && m.ociosoMs >= OCIOSO_ESCONDIDO_MS) return "instalar-ja";

  // 6. Adiado e ainda no prazo: respeitar.
  if (m.adiadoAte !== null && m.agora < m.adiadoAte) return "avisar";

  // 7. Pendente ha uma semana: no proximo momento seguro, sem esperar ociosidade.
  if (m.pendenteHaMs >= PENDENTE_LIMITE_MS) return "instalar-com-contagem";

  // 8. A vista, mas a pessoa saiu.
  if (m.janelaVisivel && m.ociosoMs >= OCIOSO_VISIVEL_MS) return "instalar-com-contagem";

  return "avisar";
}

/**
 * Ao SAIR pelo menu da bandeja: instalar em silencio, sem reabrir.
 *
 * E o padrao do electron-updater e o que o Chrome faz ("atualiza quando voce
 * fecha e reabre"). Nao depende de ociosidade — a pessoa esta indo embora. So
 * exige a versao ja baixada; baixar na saida faria o "Sair" demorar.
 */
export function instalarAoSair(faseAtual: string, automatico: boolean): boolean {
  return automatico && faseAtual === "pronta";
}

/**
 * Se ha rascunho. Recebe os elementos ja resolvidos para ser testavel sem DOM:
 * a caixa de mensagem (que pode ter texto SEM foco — a pessoa digitou e clicou
 * em outro lugar) e o elemento com foco.
 */
export function haRascunho(
  caixaDeMensagem: { value?: unknown } | null,
  focado: { tagName?: string; value?: unknown } | null
): boolean {
  const comTexto = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (caixaDeMensagem && comTexto(caixaDeMensagem.value)) return true;
  if (!focado) return false;
  const tag = (focado.tagName ?? "").toUpperCase();
  return (tag === "TEXTAREA" || tag === "INPUT") && comTexto(focado.value);
}

const CHAVE_AUTOMATICO = "whatscord.atualizarSozinho";
const CHAVE_ADIADO = "whatscord.atualizacaoAdiadaAte";
const CHAVE_VISTA = "whatscord.atualizacaoVistaEm";

/** Padrao LIGADO: quem nao mexe em nada fica atualizado. */
export function atualizarAutomaticamente(): boolean {
  try {
    return localStorage.getItem(CHAVE_AUTOMATICO) !== "nao";
  } catch {
    return true;
  }
}

export function salvarAtualizarAutomaticamente(ligado: boolean): void {
  try {
    if (ligado) localStorage.removeItem(CHAVE_AUTOMATICO);
    else localStorage.setItem(CHAVE_AUTOMATICO, "nao");
  } catch {
    /* a escolha so nao sobrevive a sessao */
  }
}

export function adiadoAte(): number | null {
  try {
    const v = Number(localStorage.getItem(CHAVE_ADIADO));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function adiar(agora: number, pendenteHaMs: number): number {
  const ate = agora + adiarPorMs(pendenteHaMs);
  try {
    localStorage.setItem(CHAVE_ADIADO, String(ate));
  } catch {
    /* sem armazenamento, o adiamento vale so nesta sessao */
  }
  return ate;
}

export function limparAdiamento(): void {
  try {
    localStorage.removeItem(CHAVE_ADIADO);
  } catch {
    /* nada a fazer */
  }
}

/**
 * Desde quando ESTA versao esta pendente. Sobrevive a reinicios — sem isso o
 * escalonamento zeraria toda vez que o app abrisse, e nunca escalaria.
 * Uma versao diferente reinicia a contagem.
 */
export function vistaPelaPrimeiraVez(versao: string, agora: number): number {
  try {
    const cru = localStorage.getItem(CHAVE_VISTA);
    const salvo = cru ? (JSON.parse(cru) as { versao?: unknown; em?: unknown }) : null;
    if (salvo && salvo.versao === versao && typeof salvo.em === "number" && salvo.em <= agora) {
      return salvo.em;
    }
    localStorage.setItem(CHAVE_VISTA, JSON.stringify({ versao, em: agora }));
  } catch {
    /* sem armazenamento, conta desde agora */
  }
  return agora;
}
