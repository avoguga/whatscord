/**
 * Extrai de `apps/web/src/novidades.md` a seção de uma versão, para o
 * `latest.json`.
 *
 * É uma cópia da `secaoDaVersao` de `apps/web/src/lib/novidades.ts`: este
 * arquivo roda com `node` puro, que não importa `.ts`. Para as duas não
 * divergirem em silêncio, `tests/novidades.test.ts` roda ambas sobre o arquivo
 * real e exige o mesmo texto para cada versão. Mudou uma, mude a outra.
 */
const CABECALHO = /^##\s+v?(\d+\.\d+\.\d+)\s*$/;

export function secaoDaVersao(md, versao) {
  const alvo = String(versao).replace(/^v/, "");
  let dentro = false;
  const linhas = [];
  for (const linha of String(md).replace(/\r\n?/g, "\n").split("\n")) {
    const m = CABECALHO.exec(linha);
    if (m) {
      if (dentro) break;
      dentro = m[1] === alvo;
      continue;
    }
    if (/^#{1,2}\s/.test(linha)) {
      if (dentro) break;
      continue;
    }
    if (dentro) linhas.push(linha);
  }
  const texto = linhas.join("\n").trim();
  return texto || null;
}
