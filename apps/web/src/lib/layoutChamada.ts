/**
 * Como a chamada ocupa a tela, e de que lado fica quem está nela.
 *
 * Três preferências pequenas que só existem porque a resposta certa depende de
 * quem está usando: numa tela larga, cobrir tudo com a chamada esconde os
 * outros espaços e grupos sem necessidade; numa tela pequena, não cobrir não
 * deixa nada visível.
 */

export type LadoDoRoster = "direita" | "esquerda";

const K_EXPANDIDA = "whatscord.chamadaExpandida";
const K_LADO = "whatscord.rosterLado";
const K_ABERTO = "whatscord.rosterAberto";

function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    // Modo privado com armazenamento bloqueado. Nunca vale derrubar a chamada
    // por causa de uma preferência de layout.
    return null;
  }
}

function gravar(chave: string, valor: string): void {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* a escolha só não sobrevive à aba */
  }
}

/**
 * Se a chamada cobre a janela inteira.
 *
 * O padrão é NÃO cobrir. A chamada cobria tudo, e com isso trocar de espaço ou
 * ler outro grupo exigia minimizá-la — o que a reduz a uma tarja. Deixando a
 * barra de espaços e a lista de conversas visíveis, a chamada vira mais uma
 * parte do app em vez de um modo à parte.
 */
export function chamadaExpandida(): boolean {
  return ler(K_EXPANDIDA) === "sim";
}

export function salvarChamadaExpandida(v: boolean): void {
  gravar(K_EXPANDIDA, v ? "sim" : "nao");
}

/**
 * De que lado fica a lista de quem está na chamada.
 *
 * Direita por padrão, que é onde Discord e Teams põem. Poder trocar não é
 * capricho: quem usa a lista de conversas o tempo todo prefere a chamada
 * encostada nela, e isso depende de qual lado a pessoa lê primeiro.
 */
export function ladoDoRoster(): LadoDoRoster {
  return ler(K_LADO) === "esquerda" ? "esquerda" : "direita";
}

export function salvarLadoDoRoster(lado: LadoDoRoster): void {
  gravar(K_LADO, lado);
}

/** Se a lista de participantes está aberta. Aberta por padrão. */
export function rosterAberto(): boolean {
  return ler(K_ABERTO) !== "nao";
}

export function salvarRosterAberto(v: boolean): void {
  gravar(K_ABERTO, v ? "sim" : "nao");
}
