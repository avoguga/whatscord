/**
 * Supressão de ruído do microfone: o que a pessoa escolhe e o que isso vira.
 *
 * Três níveis, como o Discord ("Padrão" / "Krisp"), com nomes que dizem de onde
 * vem cada um:
 *
 * - `padrao`    — a supressão do próprio navegador (WebRTC). É o que o SDK do
 *                 LiveKit já pede por padrão (`noiseSuppression: true`,
 *                 `voiceIsolation: true`), então "padrão" é literalmente o que
 *                 o app fazia antes de esta tela existir. Quase gratuita em CPU.
 * - `avancada`  — uma rede neural (GTCRN) rodando em WebAssembly num
 *                 AudioWorklet, entre o microfone e a publicação. Remove
 *                 teclado, ventilador, conversa ao fundo — coisas que a
 *                 supressão clássica deixa passar. Custa CPU (pouca: 23,7 mil
 *                 parâmetros, ~40 MMAC/s) e ~200 KB de download na primeira vez.
 * - `desligada` — nada. Existe para quem toca instrumento ou quer o som cru;
 *                 supressor nenhum sabe a diferença entre um violão e um ruído.
 *
 * Por que NÃO o Krisp, que é o que o Discord usa: o pacote do LiveKit
 * (`@livekit/krisp-noise-filter`) só funciona com LiveKit Cloud — o nosso
 * servidor é próprio. Tem 12,4 MB e licença proprietária. Confirmado na issue
 * livekit/client-sdk-js#1510 e na comunidade do LiveKit.
 *
 * Puro, sem imports: é isto que permite testar em Node o mapeamento de escolha
 * para restrição de captura.
 */

export type Supressao = "padrao" | "avancada" | "desligada";

export const SUPRESSOES: Supressao[] = ["padrao", "avancada", "desligada"];

export const SUPRESSAO_PADRAO: Supressao = "padrao";

export function ehSupressao(v: unknown): v is Supressao {
  return typeof v === "string" && (SUPRESSOES as string[]).includes(v);
}

/** Lê um valor guardado, caindo no padrão para qualquer coisa que não reconheça. */
export function supressaoOuPadrao(v: unknown): Supressao {
  return ehSupressao(v) ? v : SUPRESSAO_PADRAO;
}

/**
 * O que pedir ao navegador na captura, para cada escolha.
 *
 * O ponto que não é óbvio: com a AVANÇADA ligada, a supressão do navegador tem
 * de ser DESLIGADA. Dois supressores em cadeia não somam — o segundo recebe um
 * sinal já mastigado, com os artefatos do primeiro, e piora. É exatamente o que
 * o filtro Krisp do LiveKit faz ao entrar (`applyConstraints({ noiseSuppression:
 * false, voiceIsolation: false })`); aqui a regra fica explícita e testável.
 *
 * `echoCancellation` e `autoGainControl` não entram nesta decisão: eco e ganho
 * são problemas diferentes de ruído, e ficam sempre ligados.
 */
export function restricoesDeCaptura(s: Supressao): {
  noiseSuppression: boolean;
  voiceIsolation: boolean;
} {
  const doNavegador = s === "padrao";
  return { noiseSuppression: doNavegador, voiceIsolation: doNavegador };
}

/** Se a escolha pede o processador neural no caminho do microfone. */
export function usaProcessador(s: Supressao): boolean {
  return s === "avancada";
}

/**
 * Este aparelho consegue rodar a avançada?
 *
 * Precisa de AudioWorklet e de WebAssembly. Todo Chromium dos últimos anos tem
 * os dois — inclusive a WebView2 — mas a checagem existe porque oferecer uma
 * opção que vai falhar em silêncio é pior do que não oferecer.
 */
export function suportaAvancada(): boolean {
  try {
    return (
      typeof AudioContext !== "undefined" &&
      typeof AudioWorkletNode !== "undefined" &&
      typeof WebAssembly !== "undefined" &&
      typeof WebAssembly.instantiate === "function"
    );
  } catch {
    return false;
  }
}
