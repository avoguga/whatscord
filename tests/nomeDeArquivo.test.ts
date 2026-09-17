/**
 * O nome do arquivo baixado. Roda sem API:
 *
 *   npx tsx tests/nomeDeArquivo.test.ts
 */
import { contentDisposition } from "../apps/api/src/lib/nomeDeArquivo.ts";

let falhas = 0;
function ok(nome: string, cond: boolean, visto?: unknown) {
  if (cond) console.log("  ok  " + nome);
  else {
    falhas++;
    console.log("  FALHOU  " + nome + "  →  " + JSON.stringify(visto));
  }
}

const h = (n: string | null | undefined) => contentDisposition(n);

// O caso que motivou: o instalador chegava com o nome da chave de armazenamento.
const exe = h("WhatsCord_0.2.1_x64-setup.exe");
ok("nome simples vai nos dois campos", exe === `attachment; filename="WhatsCord_0.2.1_x64-setup.exe"; filename*=UTF-8''WhatsCord_0.2.1_x64-setup.exe`, exe);

const acento = h("relatório de férias.pdf");
ok("acento preservado em filename*", acento.includes("filename*=UTF-8''relat%C3%B3rio%20de%20f%C3%A9rias.pdf"), acento);
ok("acento vira _ na reserva ASCII", acento.includes('filename="relat_rio de f_rias.pdf"'), acento);

// Nada que venha no nome pode abrir cabeçalho novo nem virar caminho.
const injecao = h('a"b\r\nX-Evil: 1.txt');
ok("sem CR/LF no cabeçalho", !/[\r\n]/.test(injecao), injecao);
ok("aspas não fecham o filename", (injecao.match(/"/g) ?? []).length === 2, injecao);

const travessia = h("../../etc/passwd");
ok("barra não vira pasta", !injecaoDeCaminho(travessia), travessia);
ok("barra invertida não vira pasta", !injecaoDeCaminho(h("..\\..\\win.ini")), h("..\\..\\win.ini"));
ok("nome de unidade do Windows neutralizado", !h("C:\\x\\y.zip").includes(":\\"), h("C:\\x\\y.zip"));

function injecaoDeCaminho(v: string) {
  const ascii = /filename="([^"]*)"/.exec(v)?.[1] ?? "";
  const utf8 = decodeURIComponent(/filename\*=UTF-8''(.*)$/.exec(v)?.[1] ?? "");
  return /[\\/]/.test(ascii) || /[\\/]/.test(utf8);
}

// Sem nome aproveitável, cai no comportamento antigo em vez de mandar vazio.
ok("vazio → attachment puro", h("") === "attachment");
ok("null → attachment puro", h(null) === "attachment");
ok("só pontos → attachment puro", h("...") === "attachment");

ok("nome gigante cortado", h("a".repeat(500) + ".exe").length < 500);

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
