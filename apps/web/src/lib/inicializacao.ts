/**
 * Abrir o WhatsCord quando o Windows inicia — o lado da tela.
 *
 * O registro do Windows é tratado no Rust (`src-tauri/src/inicializacao.rs`);
 * aqui só se pergunta o estado, se pede para ligar ou desligar, e se resolve um
 * detalhe da interação com a atualização automática (ver `deveReabrirVisivel`).
 *
 * Sem imports estáticos de nada que exista só no navegador ou no build: o
 * `invoke` do Tauri entra por `import()` dinâmico. É o que deixa as funções
 * puras deste arquivo testáveis em Node.
 */

export type EstadoDaInicializacao = {
  /** Existe nesta plataforma (só o app instalado no Windows). */
  disponivel: boolean;
  /** Ligada DE VERDADE: a entrada existe e o Windows não a desativou. */
  ligada: boolean;
  /** Foi ligada por padrão nesta abertura — o app avisa uma vez. */
  ligadaAgoraPorPadrao: boolean;
};

/**
 * Só no app de desktop, e só no Windows. No navegador não há o que abrir com o
 * sistema; no Android, o próprio sistema cuida de manter o app vivo.
 */
export function inicializacaoPossivel(temTauri: boolean, userAgent: string): boolean {
  return temTauri && /Windows/i.test(userAgent) && !/Android/i.test(userAgent);
}

export const inicializacaoPossivelAqui: boolean =
  typeof window !== "undefined" &&
  typeof navigator !== "undefined" &&
  inicializacaoPossivel("__TAURI_INTERNALS__" in window, navigator.userAgent);

async function invocar<T>(comando: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(comando, args);
}

export async function lerInicializacao(): Promise<EstadoDaInicializacao | null> {
  if (!inicializacaoPossivelAqui) return null;
  try {
    return await invocar<EstadoDaInicializacao>("inicializacao_estado");
  } catch {
    return null;
  }
}

/** Liga ou desliga. Devolve o estado REAL depois, não o pedido. */
export async function definirInicializacao(ligada: boolean): Promise<boolean> {
  return invocar<boolean>("inicializacao_definir", { ligada });
}

/* ---------------------------------------------- depois de uma atualização */

const CHAVE_REABRIR = "whatscord.reabrirVisivelEm";

/** Janela de validade da marca: o reinício de uma atualização leva segundos. */
export const VALIDADE_DA_MARCA_MS = 2 * 60_000;

/**
 * Se o app deve mostrar a janela ao abrir, apesar de ter vindo `--oculto`.
 *
 * O caso: o Windows abriu o app na bandeja ao ligar o computador. Depois a
 * pessoa abriu a janela e clicou em "Reiniciar agora". O instalador reabre o
 * app com os MESMOS argumentos de antes — `--oculto` incluído —, e ele voltaria
 * escondido. Quem acabou de clicar em reiniciar veria o app sumir.
 *
 * A marca expira em 2 minutos: se a instalação falhou e o app só foi aberto de
 * novo no dia seguinte, pelo Windows, ele tem de nascer na bandeja como sempre.
 * Uma marca do futuro (relógio mexido) não vale.
 */
export function deveReabrirVisivel(marca: number | null, agora: number): boolean {
  if (marca === null || !Number.isFinite(marca)) return false;
  const idade = agora - marca;
  return idade >= 0 && idade <= VALIDADE_DA_MARCA_MS;
}

export function marcarReabrirVisivel(agora: number): void {
  try {
    localStorage.setItem(CHAVE_REABRIR, String(agora));
  } catch {
    /* sem armazenamento, a janela só não volta sozinha */
  }
}

export function lerMarcaDeReabrir(): number | null {
  try {
    const cru = localStorage.getItem(CHAVE_REABRIR);
    if (cru === null || cru.trim() === "") return null;
    const v = Number(cru);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Ao abrir: mostra a janela se a marca pedir, e apaga a marca de qualquer jeito. */
export async function reabrirVisivelSePreciso(): Promise<void> {
  if (!inicializacaoPossivelAqui) return;
  const marca = lerMarcaDeReabrir();
  try {
    localStorage.removeItem(CHAVE_REABRIR);
  } catch {
    /* nada a fazer */
  }
  if (!deveReabrirVisivel(marca, Date.now())) return;
  try {
    await invocar<void>("janela_mostrar");
  } catch {
    /* a janela continua na bandeja; o ícone perto do relógio abre */
  }
}
