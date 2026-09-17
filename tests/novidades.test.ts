/**
 * As notas de versão: leitura de `novidades.md` e a regra de quando mostrar.
 * Roda sem navegador e sem API:
 *
 *   npx tsx tests/novidades.test.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compararVersoes,
  itensDasNotas,
  novidadesNaoVistas,
  secaoDaVersao
} from "../apps/web/src/lib/novidades.ts";
import { secaoDaVersao as secaoDoScript } from "../scripts/novidades.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

let passou = 0;
const falhas: string[] = [];
function check(desc: string, ok: boolean, esperado?: unknown, obtido?: unknown) {
  if (ok) {
    passou++;
    console.log("  ok   " + desc);
  } else {
    falhas.push(desc);
    console.log("  FAIL " + desc);
    console.log("         esperado: " + JSON.stringify(esperado));
    console.log("         obtido  : " + JSON.stringify(obtido));
  }
}
function section(nome: string) {
  console.log("\n" + nome);
}

const MD = `# Novidades

Texto de introdução.
- item fora de seção, não pode entrar

## 0.3.0

- Terceira
- Outra da terceira

## 0.2.9

* Com asterisco
   -   Com espaço sobrando

## 0.2.8

## 0.2.7
- Sétima
`;

section("secaoDaVersao");
check("pega só a seção pedida", secaoDaVersao(MD, "0.3.0") === "- Terceira\n- Outra da terceira", "- Terceira\\n- Outra da terceira", secaoDaVersao(MD, "0.3.0"));
check("aceita v na frente", secaoDaVersao(MD, "v0.2.7") === "- Sétima");
check("versão sem seção → null", secaoDaVersao(MD, "9.9.9") === null);
check("seção vazia → null (não publica aviso vazio)", secaoDaVersao(MD, "0.2.8") === null);
check("texto de introdução não vaza para a primeira versão", !String(secaoDaVersao(MD, "0.3.0")).includes("fora de seção"));
check("CRLF do Windows não atrapalha", secaoDaVersao(MD.replace(/\n/g, "\r\n"), "0.2.9") !== null);

section("itensDasNotas");
check("tira marcador e espaço", JSON.stringify(itensDasNotas(secaoDaVersao(MD, "0.2.9"))) === JSON.stringify(["Com asterisco", "Com espaço sobrando"]), ["Com asterisco", "Com espaço sobrando"], itensDasNotas(secaoDaVersao(MD, "0.2.9")));
check("nota de uma linha só, sem marcador (--notes antigo)", JSON.stringify(itensDasNotas("Foto abre grande.")) === JSON.stringify(["Foto abre grande."]));
check("null e vazio → lista vazia", itensDasNotas(null).length === 0 && itensDasNotas("  \n ").length === 0);
check("HTML continua texto (o React escapa; aqui não se interpreta nada)", itensDasNotas("- <img src=x onerror=alert(1)>")[0] === "<img src=x onerror=alert(1)>");

section("compararVersoes");
check("0.2.10 é mais nova que 0.2.9 (número, não texto)", compararVersoes("0.2.10", "0.2.9") > 0);
check("iguais → 0", compararVersoes("v1.2.3", "1.2.3") === 0);
check("mais velha → negativo", compararVersoes("0.2.2", "0.3.0") < 0);

section("novidadesNaoVistas — quando mostrar");
const versoes = (l: { versao: string }[]) => l.map((n) => n.versao).join(",");

check(
  "instalação nova (nada visto, sem uso anterior) → nada",
  novidadesNaoVistas(MD, { atual: "0.3.0", vista: null, usavaAntes: false }).length === 0
);
check(
  "veio de versão sem este aviso (nada visto, mas já usava) → só a atual",
  versoes(novidadesNaoVistas(MD, { atual: "0.3.0", vista: null, usavaAntes: true })) === "0.3.0",
  "0.3.0",
  versoes(novidadesNaoVistas(MD, { atual: "0.3.0", vista: null, usavaAntes: true }))
);
check(
  "atualizou uma versão → só ela",
  versoes(novidadesNaoVistas(MD, { atual: "0.3.0", vista: "0.2.9", usavaAntes: true })) === "0.3.0"
);
check(
  "pulou versões → todas as perdidas, mais nova primeiro, sem a vazia",
  versoes(novidadesNaoVistas(MD, { atual: "0.3.0", vista: "0.2.7", usavaAntes: true })) === "0.3.0,0.2.9",
  "0.3.0,0.2.9",
  versoes(novidadesNaoVistas(MD, { atual: "0.3.0", vista: "0.2.7", usavaAntes: true }))
);
check(
  "já viu esta → nada (não volta a cada abertura)",
  novidadesNaoVistas(MD, { atual: "0.3.0", vista: "0.3.0", usavaAntes: true }).length === 0
);
check(
  "voltou para versão mais velha → nada",
  novidadesNaoVistas(MD, { atual: "0.2.9", vista: "0.3.0", usavaAntes: true }).length === 0
);
check(
  "versão instalada mais velha que seções futuras não mostra o futuro",
  versoes(novidadesNaoVistas(MD, { atual: "0.2.9", vista: "0.2.7", usavaAntes: true })) === "0.2.9"
);
check("sem versão atual (fora do Tauri) → nada", novidadesNaoVistas(MD, { atual: null, vista: null, usavaAntes: true }).length === 0);

section("o arquivo real");
const real = readFileSync(join(RAIZ, "apps/web/src/novidades.md"), "utf8");
const conf = JSON.parse(readFileSync(join(RAIZ, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"));
const versaoDoApp: string = conf.version;
check(
  `tem notas para a versão do tauri.conf.json (${versaoDoApp}) — sem isso o script não publica`,
  itensDasNotas(secaoDaVersao(real, versaoDoApp)).length > 0
);
const cabecalhos = [...real.matchAll(/^##\s+v?(\d+\.\d+\.\d+)\s*$/gm)].map((m) => m[1]);
check(
  "versões em ordem decrescente (a mais nova em cima)",
  cabecalhos.every((v, i) => i === 0 || compararVersoes(cabecalhos[i - 1], v) > 0),
  "decrescente",
  cabecalhos
);
check("nenhuma versão repetida", new Set(cabecalhos).size === cabecalhos.length);

section("script de publicação e app extraem o mesmo texto");
for (const v of [...cabecalhos, "9.9.9"]) {
  const doApp = secaoDaVersao(real, v);
  const doScript = secaoDoScript(real, v);
  check(`${v}: iguais`, doApp === doScript, doApp, doScript);
}
for (const v of ["0.3.0", "0.2.9", "0.2.8", "0.2.7", "1.0.0"]) {
  check(`exemplo ${v}: iguais`, secaoDaVersao(MD, v) === secaoDoScript(MD, v), secaoDaVersao(MD, v), secaoDoScript(MD, v));
}

console.log(`\n${passou} passaram, ${falhas.length} falharam`);
for (const f of falhas) console.log("  · " + f);
process.exit(falhas.length ? 1 : 0);
