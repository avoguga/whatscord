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
// OS ERROS DA API
//
// A API responde `{ error, code, params }` e o cliente traduz pelo `code`. Os
// dois lados vivem em arquivos diferentes, em pastas diferentes, e nada no
// TypeScript liga um ao outro: um codigo novo no servidor que ninguem mapeou no
// cliente nao da erro em lugar nenhum — so faz a mensagem sair em ingles para
// quem usa o app em portugues. E exatamente esse o buraco que este bloco fecha.
//
// A leitura e do CODIGO-FONTE, e nao por import: `erros.ts` usa o macro do
// Lingui, que so existe depois do Babel, entao importa-lo aqui nao funciona.
// ---------------------------------------------------------------------------

section("erros da API — os dois lados falam da mesma lista");

const fonteFalha = readFileSync(
  new URL("../apps/api/src/lib/falha.ts", import.meta.url),
  "utf8"
);
const fonteErros = readFileSync(
  new URL("../apps/web/src/lib/erros.ts", import.meta.url),
  "utf8"
);

/** Os codigos declarados na uniao `CodigoDeFalha`. */
const declarados = (() => {
  const bloco = fonteFalha.slice(
    fonteFalha.indexOf("export type CodigoDeFalha"),
    fonteFalha.indexOf(";", fonteFalha.indexOf("export type CodigoDeFalha"))
  );
  return [...bloco.matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]);
})();

/** As chaves do mapa do cliente. */
const mapeados = (() => {
  const bloco = fonteErros.slice(
    fonteErros.indexOf("const MENSAGENS"),
    fonteErros.indexOf("CODIGOS_CONHECIDOS")
  );
  return [...bloco.matchAll(/^\s{2}"([a-z_]+\.[a-z_]+)":/gm)].map((m) => m[1]);
})();

check("a união de códigos da API foi lida", declarados.length > 30, "> 30", declarados.length);
check("o mapa do cliente foi lido", mapeados.length > 30, "> 30", mapeados.length);
check(
  "nenhum código repetido na união da API",
  new Set(declarados).size === declarados.length,
  declarados.length,
  new Set(declarados).size
);

const semTraducao = declarados.filter((c) => !mapeados.includes(c));
check(
  "todo código que a API emite tem mensagem no cliente",
  semTraducao.length === 0,
  [],
  semTraducao
);

const orfaos = mapeados.filter((c) => !declarados.includes(c));
check(
  "o cliente não guarda mensagem para código que a API não emite",
  orfaos.length === 0,
  [],
  orfaos
);

section("erros da API — códigos realmente usados nas rotas");

/*
 * A união pode declarar um código que nenhuma rota emite. Não quebra nada, mas
 * é peso morto que envelhece: alguém lê a lista e acha que o caso existe.
 */
const fontesDaApi = [
  "plugins/auth.ts",
  "routes/auth.ts",
  "routes/calls.ts",
  "routes/files.ts",
  "routes/messages.ts",
  "routes/rooms.ts",
  "routes/spaces.ts",
  "routes/users.ts",
  "lib/rooms.ts",
  "lib/falha.ts",
  "../../src/server.ts"
].map((f) => {
  try {
    return readFileSync(new URL(`../apps/api/src/${f}`, import.meta.url), "utf8");
  } catch {
    return "";
  }
});
const tudoDaApi = fontesDaApi.join("\n") + readFileSync(
  new URL("../apps/api/src/server.ts", import.meta.url),
  "utf8"
);

const naoUsados = declarados.filter((c) => {
  // A declaração da união também casa; conta as ocorrências e desconta uma.
  const vezes = tudoDaApi.split(`"${c}"`).length - 1;
  return vezes < 1;
});
check(
  "todo código declarado é emitido por alguma rota",
  naoUsados.length === 0,
  [],
  naoUsados
);

section("erros da API — a ponte das mensagens do zod");

/*
 * As mensagens de validação chegam ao `send` como texto solto: o `safeParse`
 * monta a frase a partir do schema e o código não viaja junto. Uma tabela faz o
 * caminho de volta, e o preço é ficar preso ao texto — mudar a frase no schema
 * sem mudar a tabela derruba a tradução em silêncio. É esse preço que o teste
 * cobra.
 */
const mensagensDoZod = (() => {
  const fontes = ["routes/auth.ts", "routes/rooms.ts", "routes/users.ts"].map((f) =>
    readFileSync(new URL(`../apps/api/src/${f}`, import.meta.url), "utf8")
  );
  const achadas = new Set<string>();
  for (const src of fontes) {
    /*
     * `[^\n]` e não `[^)]`: o padrão de um `.regex()` pode conter parênteses
     * — o do avatar tem um `(?!` — e parar no primeiro `)` fazia a busca perder
     * a mensagem justamente da validação mais delicada que existe aqui.
     */
    for (const m of src.matchAll(/\.(?:min|max|email|regex|refine|url)\([^\n]*?"([A-Z][^"]{6,}\.)"/g)) {
      achadas.add(m[1]);
    }
  }
  return [...achadas];
})();

const naTabela = (() => {
  const bloco = fonteFalha.slice(
    fonteFalha.indexOf("const POR_MENSAGEM"),
    fonteFalha.indexOf("export function falhaDeValidacao")
  );
  return [...bloco.matchAll(/^\s{2}"([^"]+)":/gm)].map((m) => m[1]);
})();

check(
  "as mensagens de validação dos schemas foram encontradas",
  mensagensDoZod.length >= 6,
  ">= 6",
  mensagensDoZod.length
);
const foraDaTabela = mensagensDoZod.filter((m) => !naTabela.includes(m));
check(
  "toda mensagem de validação tem um código na tabela",
  foraDaTabela.length === 0,
  [],
  foraDaTabela
);
const tabelaMorta = naTabela.filter((m) => !mensagensDoZod.includes(m));
check(
  "a tabela não guarda mensagem que nenhum schema emite",
  tabelaMorta.length === 0,
  [],
  tabelaMorta
);

section("erros da API — as mensagens em inglês existem no catálogo");

/*
 * Cada `msg` do mapa de erros vira uma mensagem do catálogo. Se uma frase do
 * cliente não bater com nenhuma msgid, ela nunca foi extraída — e sairia em
 * inglês mesmo com o idioma trocado.
 */
const frasesDoCliente = [
  ...fonteErros.matchAll(/msg`([^`]+)`/g),
  ...fonteErros.matchAll(/msg\(\{ message: "([^"]+)" \}\)/g)
].map((m) => m[1]);
const idsDoCatalogo = new Set(en.map((e) => e.id));
const foraDoCatalogo = frasesDoCliente.filter((f) => !idsDoCatalogo.has(f));
check(
  "toda mensagem de erro do cliente está no catálogo",
  foraDoCatalogo.length === 0,
  [],
  foraDoCatalogo.slice(0, 6)
);
check(
  "e são muitas (o mapa não ficou vazio por engano)",
  frasesDoCliente.length > 40,
  "> 40",
  frasesDoCliente.length
);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passaram, ${failures.length} falharam`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
