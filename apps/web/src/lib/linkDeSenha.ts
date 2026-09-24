/**
 * Lê o token de "esqueci a senha" do endereço. Sem nenhum import, para o teste
 * em Node (`tests/senha.test.mts`) poder conferir.
 */

/**
 * O token de redefinição que veio no endereço, se houver.
 *
 * base64url, do tamanho que o servidor gera (32 bytes viram 43 caracteres), com
 * folga. Qualquer outra coisa é descartada aqui, antes de virar corpo de uma
 * chamada: o endereço é escrito por quem mandou o link, não por nós.
 */
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

export function tokenDeSenhaEm(busca: string): string | null {
  try {
    const params = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca);
    const bruto = (params.get("reset") ?? "").trim();
    return TOKEN.test(bruto) ? bruto : null;
  } catch {
    return null;
  }
}
