/**
 * Testes de idioma.
 *
 *   npx tsx tests/i18n.test.mts
 *
 * Duas metades:
 *
 *  1. A CASCATA — quem decide o idioma na primeira abertura. A ordem importa e
 *     tem um passo que só existe por causa de um defeito de plataforma (a
 *     WebView2 do Windows não conta o idioma do sistema ao JavaScript), então
 *     vale travar o comportamento aqui.
 *
 *  2. OS CATÁLOGOS — onde mora o defeito que passa despercebido. Uma tradução
 *     que perde um `{0}` não quebra o build nem o TypeScript: quebra na tela de
 *     um usuário espanhol, meses depois. Cada mensagem é conferida marcador a
 *     marcador contra o original.
 *
 * Código de saída: 0 tudo passou · 1 houve FAIL.
 */
import { readFileSync } from "node:fs";

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

// ---------------------------------------------------------------------------
// Globais falsos, montados antes de importar o módulo.
// ---------------------------------------------------------------------------

let idiomasDoNavegador: string[] = [];
let localeDoSO: string | undefined;
let armazenamento: Record<string, string> = {};
let armazenamentoQuebrado = false;

(globalThis as any).window = {
  get __WC_LOCALE__() {
    return localeDoSO;
  }
};
(globalThis as any).document = { documentElement: { lang: "" } };
/*
 * `navigator` já existe no Node e é só-leitura, então precisa ser redefinido em
 * vez de atribuído.
 */
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  get: () => ({ languages: idiomasDoNavegador })
});
(globalThis as any).localStorage = {
  getItem(k: string) {
    if (armazenamentoQuebrado) throw new Error("bloqueado");
    return k in armazenamento ? armazenamento[k] : null;
  },
  setItem(k: string, v: string) {
    if (armazenamentoQuebrado) throw new Error("bloqueado");
    armazenamento[k] = v;
  }
};

const { IDIOMAS, NOMES_DE_IDIOMA, idiomaDe, idiomaDoSistema, isIdioma, preferenciaSalva, resolverIdioma } =
  await import("../apps/web/src/lib/i18n");

// ---------------------------------------------------------------------------
section("idiomaDe — reduzir uma etiqueta BCP 47 ao que existe aqui");

check("pt-BR é português", idiomaDe("pt-BR") === "pt", "pt", idiomaDe("pt-BR"));
check("pt-PT também é português", idiomaDe("pt-PT") === "pt");
check("pt puro é português", idiomaDe("pt") === "pt");
check("es-419 é espanhol", idiomaDe("es-419") === "es");
check("en-GB é inglês", idiomaDe("en-GB") === "en");
check("sublinhado também vale (pt_BR vem de alguns sistemas)", idiomaDe("pt_BR") === "pt");
check("maiúscula não atrapalha", idiomaDe("PT-br") === "pt");
check("idioma que não existe aqui devolve null", idiomaDe("fr-FR") === null);
check("string vazia devolve null", idiomaDe("") === null);
check("undefined devolve null", idiomaDe(undefined) === null);
check("null devolve null", idiomaDe(null) === null);
check(
  "não confunde um prefixo parecido: 'ptx' não é português",
  idiomaDe("ptx") === null,
  null,
  idiomaDe("ptx")
);

// ---------------------------------------------------------------------------
section("isIdioma");

for (const i of IDIOMAS) check(`aceita ${i}`, isIdioma(i));
check("recusa 'fr'", !isIdioma("fr"));
check("recusa 'system' (é preferência, não idioma)", !isIdioma("system"));
check("recusa null", !isIdioma(null));

// ---------------------------------------------------------------------------
section("idiomaDoSistema — a cascata");

localeDoSO = undefined;
idiomasDoNavegador = [];
check("sem nada, é inglês", idiomaDoSistema() === "en");

idiomasDoNavegador = ["pt-BR", "en-US"];
check("usa o primeiro idioma do navegador que conhecemos", idiomaDoSistema() === "pt");

idiomasDoNavegador = ["fr-FR", "de-DE", "es-ES"];
check(
  "pula os que não existem aqui em vez de desistir no primeiro",
  idiomaDoSistema() === "es",
  "es",
  idiomaDoSistema()
);

idiomasDoNavegador = ["fr-FR", "de-DE"];
check("nenhum reconhecido, cai para inglês", idiomaDoSistema() === "en");

/*
 * O ponto do passo nativo: o SO manda, mesmo quando o navegador diz outra
 * coisa. É o caso real da WebView2, que reporta um idioma que não é o do
 * Windows.
 */
localeDoSO = "pt-BR";
idiomasDoNavegador = ["en-US"];
check(
  "o que o SO informou vence o navegador",
  idiomaDoSistema() === "pt",
  "pt",
  idiomaDoSistema()
);

localeDoSO = "fr-FR";
idiomasDoNavegador = ["es-ES"];
check(
  "SO com idioma que não existe aqui não bloqueia o navegador",
  idiomaDoSistema() === "es",
  "es",
  idiomaDoSistema()
);

localeDoSO = undefined;

// ---------------------------------------------------------------------------
section("preferenciaSalva e resolverIdioma");

armazenamento = {};
check("sem escolha salva, é 'igual ao dispositivo'", preferenciaSalva() === "system");

armazenamento = { "whatscord.locale": "es" };
check("lê a escolha salva", preferenciaSalva() === "es");

armazenamento = { "whatscord.locale": "klingon" };
check("valor corrompido vira 'system'", preferenciaSalva() === "system");

armazenamentoQuebrado = true;
check("armazenamento bloqueado não derruba a leitura", preferenciaSalva() === "system");
armazenamentoQuebrado = false;

idiomasDoNavegador = ["pt-BR"];
check("'system' resolve pelo sistema", resolverIdioma("system") === "pt");
check("escolha explícita ignora o sistema", resolverIdioma("en") === "en");

check(
  "cada idioma tem nome escrito nele mesmo",
  IDIOMAS.every((i) => !!NOMES_DE_IDIOMA[i]),
  [],
  IDIOMAS.filter((i) => !NOMES_DE_IDIOMA[i])
);
check("o português aparece como 'Português', não 'Portuguese'", NOMES_DE_IDIOMA.pt === "Português");
check("o espanhol aparece como 'Español'", NOMES_DE_IDIOMA.es === "Español");

// ---------------------------------------------------------------------------
// OS CATÁLOGOS
// ---------------------------------------------------------------------------

type Entrada = { id: string; str: string };

/** Lê um `.po` de forma suficiente para conferir mensagens. */
function lerPo(locale: string): Entrada[] {
  const texto = readFileSync(
    new URL(`../apps/web/src/locales/${locale}.po`, import.meta.url),
    "utf8"
  );
  const entradas: Entrada[] = [];
  for (const bloco of texto.split("\n\n")) {
    const pega = (campo: string) => {
      const m = bloco.match(new RegExp(`^${campo} ((?:"[^"]*"\\n?)+)`, "m"));
      if (!m) return null;
      return [...m[1].matchAll(/"([^"]*)"/g)]
        .map((x) => x[1])
        .join("")
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"');
    };
    const id = pega("msgid");
    if (!id) continue;
    entradas.push({ id, str: pega("msgstr") ?? "" });
  }
  return entradas;
}

const en = lerPo("en");
const pt = lerPo("pt");
const es = lerPo("es");

section("catálogos — cobertura");

check("o catálogo-fonte tem mensagens", en.length > 200, "> 200", en.length);
check(
  "português tem exatamente as mesmas mensagens que o inglês",
  pt.length === en.length && pt.every((e, i) => e.id === en[i].id),
  en.length,
  pt.length
);
check(
  "espanhol tem exatamente as mesmas mensagens que o inglês",
  es.length === en.length && es.every((e, i) => e.id === en[i].id),
  en.length,
  es.length
);

for (const [nome, cat] of [
  ["português", pt],
  ["espanhol", es]
] as const) {
  const vazias = cat.filter((e) => !e.str.trim()).map((e) => e.id);
  check(
    `nenhuma mensagem sem tradução em ${nome}`,
    vazias.length === 0,
    [],
    vazias.slice(0, 8)
  );
}

// ---------------------------------------------------------------------------
section("catálogos — marcadores ICU (o defeito que não aparece no build)");

/** `{nome}`, `{0}`, e as tags de componente `<0>`…`</0>`. */
function marcadores(msg: string): string[] {
  const nomes = [...msg.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map((m) => m[1]);
  const tags = [...msg.matchAll(/<\/?(\d+)>/g)].map((m) => `<${m[1]}>`);
  return [...new Set([...nomes, ...tags])].sort();
}

for (const [nome, cat] of [
  ["português", pt],
  ["espanhol", es]
] as const) {
  const quebradas: string[] = [];
  for (let i = 0; i < en.length; i++) {
    const original = marcadores(en[i].id);
    const traduzida = marcadores(cat[i].str);
    if (original.join("|") !== traduzida.join("|")) {
      quebradas.push(`${en[i].id.slice(0, 45)} → [${original}] vs [${traduzida}]`);
    }
  }
  check(
    `todo marcador do original sobrevive em ${nome}`,
    quebradas.length === 0,
    [],
    quebradas.slice(0, 6)
  );
}

section("catálogos — plurais");

/*
 * Uma mensagem de plural precisa das MESMAS categorias nos dois lados. Traduzir
 * `{n, plural, one {…} other {…}}` como texto corrido não dá erro em lugar
 * nenhum: só imprime a chave crua na tela.
 */
const plurais = en.map((e, i) => [e, pt[i], es[i]] as const).filter(([e]) => /,\s*plural\s*,/.test(e.id));
check("existem mensagens de plural para conferir", plurais.length >= 5, ">= 5", plurais.length);

for (const [nome, indice] of [
  ["português", 1],
  ["espanhol", 2]
] as const) {
  const ruins = plurais
    .filter(([, ...trads]) => !/,\s*plural\s*,/.test(trads[indice - 1].str))
    .map(([e]) => e.id.slice(0, 50));
  check(
    `plural continua sendo plural em ${nome}`,
    ruins.length === 0,
    [],
    ruins
  );
  const semOther = plurais
    .filter(([, ...trads]) => !/\bother\s*\{/.test(trads[indice - 1].str))
    .map(([e]) => e.id.slice(0, 50));
  check(
    `toda forma plural em ${nome} tem a categoria 'other' (a única obrigatória)`,
    semOther.length === 0,
    [],
    semOther
  );
}

section("catálogos — traduziram de verdade?");

/*
 * Uma tradução idêntica ao original quase sempre significa "esqueci esta
 * linha". Algumas são legítimas — nomes próprios, "Audio", "online" — então a
 * verificação é sobre a PROPORÇÃO, não sobre cada caso.
 */
for (const [nome, cat] of [
  ["português", pt],
  ["espanhol", es]
] as const) {
  const iguais = cat.filter((e, i) => e.str === en[i].id);
  check(
    `${nome} não é o inglês copiado (${iguais.length} de ${en.length} iguais)`,
    iguais.length < en.length * 0.1,
    `< ${Math.round(en.length * 0.1)}`,
    iguais.length
  );
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passaram, ${failures.length} falharam`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
