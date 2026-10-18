/**
 * O link de uma reunião: ler da barra de endereços e montar para mandar.
 *
 * Sem nenhum import, para o teste em Node (`tests/reuniao.test.ts`) poder
 * conferir. O formato é o mesmo que o servidor gera: abc-defg-hij.
 */

const CODIGO = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/** O código da reunião que veio no endereço (`?call=`), se houver. */
export function codigoDeReuniaoEm(busca: string): string | null {
  try {
    const params = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca);
    const bruto = (params.get("call") ?? "").trim().toLowerCase();
    return CODIGO.test(bruto) ? bruto : null;
  } catch {
    return null;
  }
}

/**
 * Lê um código colado à mão — o link inteiro, ou só o código.
 *
 * É o que a pessoa faz quando recebe o link por voz ou num print: cola o que
 * tem. Aceitar os dois evita a mensagem "link inválido" para quem colou certo.
 */
export function codigoColado(texto: string): string | null {
  const t = texto.trim().toLowerCase();
  if (CODIGO.test(t)) return t;
  const noLink = /[?&]call=([a-z]{3}-[a-z]{4}-[a-z]{3})\b/.exec(t);
  if (noLink) return noLink[1];
  // Sem os hífens, do jeito que alguém digita ouvindo: "abcdefghij".
  if (/^[a-z]{10}$/.test(t)) return `${t.slice(0, 3)}-${t.slice(3, 7)}-${t.slice(7)}`;
  return null;
}

/**
 * O nome que ficou da última vez que a pessoa entrou sem conta.
 *
 * Quem entra como convidado numa reunião costuma entrar em outra — digitar o
 * nome de novo toda vez é o tipo de atrito que faz desistir. Guardado só neste
 * navegador, e só o nome.
 */
const CHAVE_DO_NOME = "whatscord.nomeDeConvidado";

export function nomeLembrado(): string {
  try {
    return localStorage.getItem(CHAVE_DO_NOME) ?? "";
  } catch {
    return "";
  }
}

export function lembrarNome(nome: string): void {
  try {
    localStorage.setItem(CHAVE_DO_NOME, nome);
  } catch {
    /* sem armazenamento, a pessoa só digita de novo da próxima vez */
  }
}

/** Iniciais para o quadro de quem está sem câmera. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = [...partes[0]][0] ?? "";
  const ultima = partes.length > 1 ? [...partes[partes.length - 1]][0] ?? "" : "";
  return (primeira + ultima).toUpperCase();
}
