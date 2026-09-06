/**
 * Testes do parsing de links de convite.
 *
 *   npx tsx tests/deeplink.test.ts
 *
 * Isto merece teste próprio porque é a única entrada do app que vem do SISTEMA
 * OPERACIONAL: qualquer programa da máquina pode disparar `whatscord://...` com
 * o conteúdo que quiser, e o que sair daqui vira segmento de uma URL de API.
 *
 * Código de saída: 0 tudo passou · 1 houve FAIL.
 */
import { appLink, inviteCodeFrom, inviteLink, shareOrigin } from "../apps/web/src/lib/deeplink";

let passed = 0;
const failures: string[] = [];

function check(desc: string, ok: boolean, expected?: unknown, actual?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ok   ${desc}`);
  } else {
    failures.push(desc);
    console.log(`  FAIL ${desc}`);
    if (expected !== undefined) console.log(`         esperado: ${JSON.stringify(expected)}`);
    if (actual !== undefined) console.log(`         obtido  : ${JSON.stringify(actual)}`);
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

const CODIGO = "a1b2c3d4e5";

// ---------------------------------------------------------------------------
section("as formas válidas de um convite");

const aceitos: [string, string][] = [
  ["protocolo do app", `whatscord://join/${CODIGO}`],
  ["link web por parâmetro (o que geramos)", `https://whatscord.167.88.39.225.sslip.io/?join=${CODIGO}`],
  ["link web por caminho (ainda aceito)", `https://whatscord.167.88.39.225.sslip.io/join/${CODIGO}`],
  ["parâmetro num caminho qualquer", `https://exemplo.dev/qualquer?join=${CODIGO}`],
  ["link web sem TLS", `http://localhost:5173/join/${CODIGO}`],
  ["só o caminho", `/join/${CODIGO}`],
  ["código puro, digitado à mão", CODIGO],
  ["por parâmetro de busca", `whatscord://join?code=${CODIGO}`],
  ["com barra no fim", `https://exemplo.dev/join/${CODIGO}/`],
  ["com segmento extra depois", `whatscord://join/${CODIGO}/qualquer`],
  ["com espaços em volta", `  whatscord://join/${CODIGO}  `]
];

for (const [nome, entrada] of aceitos) {
  check(nome, inviteCodeFrom(entrada) === CODIGO, CODIGO, inviteCodeFrom(entrada));
}

check(
  "maiúsculas são normalizadas (o código é hex, e o servidor guarda minúsculo)",
  inviteCodeFrom(`whatscord://join/${CODIGO.toUpperCase()}`) === CODIGO,
  CODIGO,
  inviteCodeFrom(`whatscord://join/${CODIGO.toUpperCase()}`)
);

/*
 * O domínio do link NÃO é verificado de propósito: o código sozinho não dá
 * acesso a nada além do espaço a que pertence, e a entrada sempre é feita
 * contra a NOSSA API. Encurtadores e redirecionamentos continuam funcionando.
 */
check(
  "um host desconhecido ainda vale — o código é que manda",
  inviteCodeFrom(`https://bit.ly.exemplo/join/${CODIGO}`) === CODIGO
);

// ---------------------------------------------------------------------------
section("o que tem de ser recusado");

const recusados: [string, string][] = [
  ["vazio", ""],
  ["só espaços", "   "],
  ["link do app sem ser de convite", "whatscord://settings/audio"],
  ["caminho web que não é convite", "https://exemplo.dev/spaces/a1b2c3d4e5"],
  ["convite sem código", "whatscord://join"],
  ["convite com código vazio", "whatscord://join/"],
  ["código curto demais", "whatscord://join/abc"],
  ["código não hexadecimal", "whatscord://join/zzzzzzzzzz"],
  ["tentativa de script", "javascript:alert(1)"],
  ["tag html no lugar do código", "whatscord://join/<script>alert(1)</script>"],
  ["travessia de caminho", "whatscord://join/../../admin"],
  ["barra codificada", "whatscord://join/%2e%2e%2fadmin"],
  ["esquema alheio", "file:///c:/windows/system32"],
  ["outro app", "slack://join/a1b2c3d4e5"],
  ["texto solto", "vem pro meu espaço!"],
  ["quebra de linha no meio", `whatscord://join/${CODIGO}\ne mais coisa`]
];

for (const [nome, entrada] of recusados) {
  const r = inviteCodeFrom(entrada);
  check(nome, r === null, null, r);
}

// Um código absurdamente longo não pode passar: viraria uma URL de API gigante.
check(
  "código longo demais é recusado",
  inviteCodeFrom(`whatscord://join/${"a".repeat(65)}`) === null,
  null,
  inviteCodeFrom(`whatscord://join/${"a".repeat(65)}`)
);
check(
  "no limite de 64 ainda é aceito",
  inviteCodeFrom(`whatscord://join/${"a".repeat(64)}`) === "a".repeat(64)
);

// ---------------------------------------------------------------------------
section("os links que geramos voltam a ser lidos");

const web = inviteLink(CODIGO, "https://whatscord.167.88.39.225.sslip.io");
const app = appLink(CODIGO);

check(
  "o link web usa parâmetro, não caminho aninhado (senão o bundle não carrega)",
  web === `https://whatscord.167.88.39.225.sslip.io/?join=${CODIGO}`,
  `…/?join=${CODIGO}`,
  web
);
check("o link do app usa o esquema whatscord", app === `whatscord://join/${CODIGO}`, `whatscord://join/${CODIGO}`, app);
check(
  "uma barra sobrando na origem não vira barra dupla",
  inviteLink(CODIGO, "https://x.dev/") === `https://x.dev/?join=${CODIGO}`,
  `https://x.dev/?join=${CODIGO}`,
  inviteLink(CODIGO, "https://x.dev/")
);

// A ida e a volta têm que fechar, senão o link que o app mostra não é o mesmo
// que ele sabe ler.
check("o link web volta ao mesmo código", inviteCodeFrom(web) === CODIGO);
check("o link do app volta ao mesmo código", inviteCodeFrom(app) === CODIGO);

// ---------------------------------------------------------------------------
section("o link tem que ser compartilhável de dentro do app desktop");

/*
 * Dentro da WebView do Tauri a origem é `http://tauri.localhost`. Gerar o
 * convite com essa origem produz um link que não abre em nenhuma outra máquina —
 * o bug mais silencioso possível, porque na tela ele parece um link normal.
 */
const internas = [
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://[::1]:4173"
];
for (const origem of internas) {
  const gerado = inviteLink(CODIGO, origem);
  check(
    `origem interna ${origem} vira endereço público`,
    gerado.startsWith("https://") && !gerado.includes("localhost"),
    "um endereço público",
    gerado
  );
}

check(
  "uma origem pública de verdade é mantida",
  shareOrigin("https://chat.exemplo.dev") === "https://chat.exemplo.dev"
);
check(
  "um host que apenas CONTÉM localhost não é confundido",
  shareOrigin("https://localhost.exemplo.dev") === "https://localhost.exemplo.dev",
  "https://localhost.exemplo.dev",
  shareOrigin("https://localhost.exemplo.dev")
);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passaram, ${failures.length} falharam`);
if (failures.length) {
  console.log("\nfalhas:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
