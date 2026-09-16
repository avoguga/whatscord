/**
 * O volume de cada um, separado.
 *
 * Por que isso existe: numa chamada o volume não é um número só. A transmissão
 * de tela de alguém chega com o áudio do jogo no talo enquanto as vozes estão
 * baixas, e o único remédio hoje é mexer no volume do sistema — que abaixa tudo
 * junto, inclusive a pessoa que você está tentando ouvir. É o mesmo motivo pelo
 * qual o Discord tem volume por participante.
 *
 * Fica por APARELHO, não por conta: "esse aí sempre chega alto demais" é uma
 * observação de quem escuta, e a pessoa do outro lado não tem nada a ver com
 * isso — nem deve ficar sabendo.
 *
 * Guardado por participante E por fonte, porque são coisas diferentes: baixar a
 * transmissão de alguém não pode abaixar a voz da mesma pessoa. É justamente a
 * separação que o volume do sistema não sabe fazer.
 */

const PREFIXO = "whatscord.volume.";

/**
 * O teto é 100%, e não o dobro como no Discord.
 *
 * Não é preferência: `HTMLMediaElement.volume` só aceita de 0 a 1, e acima
 * disso ele LANÇA. Medido no Chromium, contra um `<audio>` de verdade:
 *
 *     a.volume = 0.3   ->  0.3
 *     a.volume = 0     ->  0
 *     a.volume = 1.5   ->  IndexSizeError
 *
 * Então uma barra que passasse de 100% não seria só inerte — jogaria exceção a
 * cada passo do arrasto.
 *
 * Passar de 100% de verdade exigiria tirar o som do elemento e mandá-lo por um
 * `GainNode` do WebAudio. Isso custaria a escolha de alto-falante: `setSinkId`
 * vive no elemento, e embora o Chromium também o tenha no `AudioContext` (foi
 * verificado junto), Firefox e Safari não têm. Trocar "escolher a caixa de som
 * certa" — que funciona hoje e já custou trabalho — por um ganho a mais seria um
 * péssimo negócio.
 */
export const VOLUME_MAX = 1;
export const VOLUME_PADRAO = 1;

/** A chave de uma fonte de áudio: quem está falando, e por qual caminho. */
export function chaveDeAudio(identidade: string, fonte: string): string {
  return `${identidade}:${fonte}`;
}

export function limitarVolume(v: number): number {
  if (!Number.isFinite(v)) return VOLUME_PADRAO;
  return Math.min(VOLUME_MAX, Math.max(0, v));
}

export function volumeDe(chave: string): number {
  try {
    const cru = localStorage.getItem(PREFIXO + chave);
    /*
     * Texto em branco sai daqui antes de chegar ao `Number`, e isso nao e
     * preciosismo: `Number("")` e `Number(" ")` valem ZERO, e zero e um volume
     * perfeitamente valido. Sem esta linha, uma entrada vazia — escrita por
     * engano, truncada, ou deixada por outra versao — calaria a pessoa em
     * silencio. Foi um teste que apontou isto.
     */
    if (cru === null || cru.trim() === "") return VOLUME_PADRAO;
    const v = Number(cru);
    /*
     * Um valor ilegível volta ao padrão em vez de virar 0. Silêncio por acidente
     * é o pior fracasso possível aqui: a pessoa não ouve ninguém, não fez nada
     * para isso e não tem como desconfiar de onde veio.
     */
    return Number.isFinite(v) ? limitarVolume(v) : VOLUME_PADRAO;
  } catch {
    return VOLUME_PADRAO;
  }
}

export function salvarVolume(chave: string, v: number): void {
  try {
    const limitado = limitarVolume(v);
    /*
     * O padrão não fica guardado. Assim a lista não cresce para sempre com
     * gente que você ouviu uma vez e nunca mais, e "nunca mexi nisso" continua
     * significando exatamente isso.
     */
    if (limitado === VOLUME_PADRAO) localStorage.removeItem(PREFIXO + chave);
    else localStorage.setItem(PREFIXO + chave, String(limitado));
  } catch {
    /* a escolha só não sobrevive à aba */
  }
}

/** Um rótulo curto, do tipo "120%" — e "mudo" quando é zero. */
export function rotuloDeVolume(v: number, mudo: string): string {
  return v === 0 ? mudo : `${Math.round(v * 100)}%`;
}
