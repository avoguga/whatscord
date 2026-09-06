/**
 * Testes do tema claro/escuro e da paleta.
 *
 *   npx tsx tests/theme.test.mts
 *
 * Duas metades bem diferentes:
 *
 *  1. O MECANISMO — ler a preferência, resolver "igual ao dispositivo", pintar
 *     no `<html>`, sobreviver a armazenamento bloqueado. Roda com um DOM e um
 *     `matchMedia` de mentira, porque é tudo com que o módulo fala.
 *
 *  2. A PALETA — que é onde mora o defeito caro. Um tema claro errado não
 *     quebra: fica ilegível, e ninguém percebe até um usuário reclamar que
 *     "não dá para ler". Então todo par texto/fundo é medido em contraste
 *     WCAG aqui, lendo o CSS de verdade, e não conferido no olho.
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
// DOM e matchMedia de mentira, montados antes de importar o módulo: ele lê
// `document` e `matchMedia` no escopo global.
// ---------------------------------------------------------------------------

type Ouvinte = () => void;
let prefereClaro = false;
let ouvintes: Ouvinte[] = [];
let matchMediaExiste = true;

const raiz = {
  dataset: {} as Record<string, string>,
  style: { colorScheme: "" }
};

let armazenamento: Record<string, string> = {};
let armazenamentoQuebrado = false;

(globalThis as any).document = { documentElement: raiz };
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
Object.defineProperty(globalThis, "matchMedia", {
  configurable: true,
  get() {
    if (!matchMediaExiste) return undefined;
    return (consulta: string) => ({
      matches: consulta.includes("light") ? prefereClaro : !prefereClaro,
      addEventListener: (_: string, fn: Ouvinte) => ouvintes.push(fn),
      removeEventListener: (_: string, fn: Ouvinte) => {
        ouvintes = ouvintes.filter((o) => o !== fn);
      }
    });
  }
});

const {
  applyTheme,
  isTheme,
  resolveTheme,
  saveTheme,
  storedTheme,
  systemTheme,
  watchSystemTheme
} = await import("../apps/web/src/lib/theme");

// ---------------------------------------------------------------------------
section("isTheme — só três valores existem");

check("aceita light", isTheme("light"));
check("aceita dark", isTheme("dark"));
check("aceita system", isTheme("system"));
check("recusa string qualquer", !isTheme("azul"));
check("recusa null", !isTheme(null));
check("recusa objeto", !isTheme({ theme: "dark" }));
check("recusa maiúscula (não normaliza silenciosamente)", !isTheme("Dark"));

// ---------------------------------------------------------------------------
section("storedTheme — o que estava salvo");

armazenamento = {};
check("sem nada salvo, é 'igual ao dispositivo'", storedTheme() === "system");

armazenamento = { "whatscord.theme": "light" };
check("lê 'light' salvo", storedTheme() === "light");

armazenamento = { "whatscord.theme": "dark" };
check("lê 'dark' salvo", storedTheme() === "dark");

armazenamento = { "whatscord.theme": "roxo" };
check(
  "valor corrompido cai para 'system' em vez de vazar para o CSS",
  storedTheme() === "system",
  "system",
  storedTheme()
);

armazenamentoQuebrado = true;
check("armazenamento bloqueado não derruba a leitura", storedTheme() === "system");
armazenamentoQuebrado = false;

// ---------------------------------------------------------------------------
section("systemTheme — o que o sistema pede");

prefereClaro = true;
check("sistema em claro vira 'light'", systemTheme() === "light");

prefereClaro = false;
check("sistema em escuro vira 'dark'", systemTheme() === "dark");

matchMediaExiste = false;
check(
  "navegador sem matchMedia fica no escuro (comportamento anterior preservado)",
  systemTheme() === "dark",
  "dark",
  systemTheme()
);
matchMediaExiste = true;

// ---------------------------------------------------------------------------
section("resolveTheme — 'system' nunca chega ao CSS");

prefereClaro = true;
check("system + sistema claro = light", resolveTheme("system") === "light");
prefereClaro = false;
check("system + sistema escuro = dark", resolveTheme("system") === "dark");
check("escolha explícita ignora o sistema", resolveTheme("light") === "light");
prefereClaro = true;
check("escolha explícita de escuro ignora sistema claro", resolveTheme("dark") === "dark");
prefereClaro = false;

// ---------------------------------------------------------------------------
section("applyTheme — carimbo no <html>");

applyTheme("light");
check("data-theme vira 'light'", raiz.dataset.theme === "light", "light", raiz.dataset.theme);
check(
  "color-scheme acompanha (senão a barra de rolagem nativa fica preta)",
  raiz.style.colorScheme === "light",
  "light",
  raiz.style.colorScheme
);

applyTheme("dark");
check("data-theme volta para 'dark'", raiz.dataset.theme === "dark");
check("color-scheme volta junto", raiz.style.colorScheme === "dark");

prefereClaro = true;
check("applyTheme('system') devolve o valor resolvido", applyTheme("system") === "light");
check("e carimba o resolvido, nunca a palavra 'system'", raiz.dataset.theme === "light");
prefereClaro = false;

// ---------------------------------------------------------------------------
section("saveTheme — escolher persiste e pinta na mesma hora");

armazenamento = {};
saveTheme("light");
check("grava a escolha", armazenamento["whatscord.theme"] === "light");
check("e pinta sem esperar recarregar", raiz.dataset.theme === "light");

armazenamentoQuebrado = true;
raiz.dataset.theme = "light";
const resultado = saveTheme("dark");
check(
  "sem poder gravar, ainda pinta (a escolha dura a sessão)",
  raiz.dataset.theme === "dark" && resultado === "dark",
  "dark",
  raiz.dataset.theme
);
armazenamentoQuebrado = false;

// ---------------------------------------------------------------------------
section("watchSystemTheme — acompanhar o sistema durante o uso");

let preferenciaAtual: "light" | "dark" | "system" = "system";
ouvintes = [];
prefereClaro = false;
applyTheme("system");
const parar = watchSystemTheme(() => preferenciaAtual);
check("assinou a mudança do sistema", ouvintes.length === 1);

prefereClaro = true;
ouvintes.forEach((o) => o());
check(
  "sistema mudou para claro e o app acompanhou",
  raiz.dataset.theme === "light",
  "light",
  raiz.dataset.theme
);

preferenciaAtual = "dark";
prefereClaro = true;
raiz.dataset.theme = "dark";
ouvintes.forEach((o) => o());
check(
  "quem ESCOLHEU escuro não é arrastado pelo sistema",
  raiz.dataset.theme === "dark",
  "dark",
  raiz.dataset.theme
);

parar();
check("desassina ao desmontar (sem listener vazando)", ouvintes.length === 0);

matchMediaExiste = false;
const pararVazio = watchSystemTheme(() => "system");
check("sem matchMedia devolve um cancelador que não explode", typeof pararVazio === "function");
pararVazio();
matchMediaExiste = true;

// ---------------------------------------------------------------------------
// A PALETA. Daqui para baixo é o CSS de verdade.
// ---------------------------------------------------------------------------

const css = readFileSync(new URL("../apps/web/src/styles.css", import.meta.url), "utf8");

function tokens(seletor: string): Record<string, string> {
  const i = css.indexOf(seletor + " {");
  if (i < 0) throw new Error(`seletor ausente: ${seletor}`);
  const corpo = css.slice(i, css.indexOf("\n}", i));
  const saida: Record<string, string> = {};
  for (const m of corpo.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) saida[m[1]] = m[2].trim();
  return saida;
}

const escuro = tokens(":root");
const claro = { ...escuro, ...tokens(':root[data-theme="light"]') };

function canal(c: number) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function rgb(cor: string): [number, number, number] {
  const h = cor.trim().replace("#", "");
  const cheio = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(cheio.slice(i, i + 2), 16)) as [number, number, number];
}
function luminancia(cor: string) {
  const [r, g, b] = rgb(cor);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}
function contraste(a: string, b: string) {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** rgba() só tem contraste depois de composto sobre o fundo em que pousa. */
function resolver(c: string, sob: string) {
  const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/);
  if (!m) return c;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const base = rgb(sob);
  const mist = [0, 1, 2].map((i) => Math.round(Number(m[i + 1]) * a + base[i] * (1 - a)));
  return "#" + mist.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/*
 * Onde cada texto de fato pousa. Escrito à mão porque é a pergunta que importa:
 * "esta cor de texto aparece sobre qual fundo?". Derivar isso do CSS
 * automaticamente daria a ilusão de cobertura sem responder nada.
 */
const pares: [string, string, number][] = [
  ["--text", "--panel", 4.5],
  ["--text", "--chat-bg", 4.5],
  ["--text", "--panel-header", 4.5],
  ["--text", "--rail", 4.5],
  ["--text", "--bubble-in", 4.5],
  ["--text", "--bubble-out", 4.5],
  ["--text", "--hover", 4.5],
  ["--text", "--input", 4.5],
  ["--text", "--overlay", 4.5],
  ["--text-dim", "--panel", 4.5],
  ["--text-dim", "--chat-bg", 4.5],
  ["--text-dim", "--panel-header", 4.5],
  ["--text-dim", "--rail", 4.5],
  ["--text-dim", "--bubble-in", 4.5],
  ["--text-dim", "--hover", 4.5],
  // Terciário: rótulo curto e auxiliar, alvo de 3:1 como componente gráfico.
  ["--text-faint", "--panel", 3],
  ["--text-faint", "--chat-bg", 3],
  ["--text-faint", "--panel-header", 3],
  ["--text-faint", "--rail", 3],
  ["--text-faint", "--bubble-in", 3],
  // Hora e confirmação dentro do balão de saída.
  ["--meta-out", "--bubble-out", 3],
  ["--heading", "--chat-bg", 3],
  // Texto branco sobre o vermelho de perigo, nos dois temas.
  ["--on-danger", "--danger", 3],
  // Tinta sobre o botão verde.
  ["--accent-ink", "--accent", 3]
];

for (const [nome, paleta] of [
  ["escuro", escuro],
  ["claro", claro]
] as const) {
  section(`contraste WCAG — tema ${nome}`);
  for (const [tinta, fundo, minimo] of pares) {
    const ct = paleta[tinta];
    const cf = paleta[fundo];
    if (!ct || !cf) {
      check(`${tinta} sobre ${fundo} — tokens existem`, false, "definidos", { ct, cf });
      continue;
    }
    const c = contraste(resolver(ct, cf), cf);
    check(
      `${tinta} sobre ${fundo} >= ${minimo}:1 (${c.toFixed(2)})`,
      c >= minimo,
      `>= ${minimo}`,
      Number(c.toFixed(2))
    );
  }
}

// ---------------------------------------------------------------------------
section("paleta — completude e regressão");

const soLuz = tokens(':root[data-theme="light"]');
const chavesEscuro = Object.keys(escuro).filter((k) => !k.startsWith("--gap-"));

check(
  "o tema claro não inventa token que o escuro não tem",
  Object.keys(soLuz).every((k) => k in escuro),
  [],
  Object.keys(soLuz).filter((k) => !(k in escuro))
);

/*
 * As que ficam FORA do tema claro de propósito: ou são sobre mídia (fundo de
 * vídeo, legenda sobre foto), ou são o palco da chamada, que segue escuro nos
 * dois temas como no Discord, ou são medida e não cor.
 */
const fixasDeProposito = new Set([
  "--warn",
  "--media-ink",
  "--preview-light",
  "--preview-light-bar",
  "--preview-light-bubble",
  "--preview-dark",
  "--preview-dark-bar",
  "--preview-dark-bubble",
  "--media-scrim",
  "--on-danger",
  "--call-bg",
  "--ctl",
  "--ctl-hover",
  "--pill",
  "--accent-ink",
  "--scrim",
  "--accent",
  "--rail-w",
  "--list-w",
  "--header-h",
  "--call-bar-h"
]);

const esquecidas = chavesEscuro.filter((k) => !(k in soLuz) && !fixasDeProposito.has(k));
check(
  "nenhum token de cor ficou sem versão clara sem justificativa",
  esquecidas.length === 0,
  [],
  esquecidas
);

const literais = (() => {
  // Comentários fora: um hex citado numa explicação não pinta nada.
  let corpo = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const sel of [":root", ':root[data-theme="light"]']) {
    const i = corpo.indexOf(sel + " {");
    corpo = corpo.slice(0, i) + corpo.slice(corpo.indexOf("\n}", i));
  }
  return corpo.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
})();
check(
  "nenhuma cor literal fora dos blocos de paleta (senão não trocaria de tema)",
  literais.length === 0,
  [],
  literais
);

check("o escuro segue sendo o padrão do :root", escuro["--panel"] === "#111b21");
check("o claro tem painel branco", claro["--panel"].toLowerCase() === "#ffffff");
check("o verde de marca é o mesmo nos dois temas", escuro["--accent"] === claro["--accent"]);
check("o balão de saída claro é o verde do WhatsApp", claro["--bubble-out"] === "#d9fdd3");

// ---------------------------------------------------------------------------
console.log(`\n${passed} passaram, ${failures.length} falharam`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
