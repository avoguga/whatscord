import { i18n } from "@lingui/core";

/**
 * Idioma da interface.
 *
 * Três: inglês, português e espanhol. Inglês é o idioma-fonte — as strings
 * estão escritas nele dentro do código, então o catálogo `en` é gerado do
 * próprio JSX e nunca fica desatualizado.
 *
 * A escolha do idioma na primeira abertura é uma cascata, e a ordem importa:
 *
 *   1. o que a pessoa escolheu aqui dentro, se já escolheu;
 *   2. o idioma que o SISTEMA OPERACIONAL informou ao app instalado;
 *   3. `navigator.languages`, que é o que o navegador diz;
 *   4. inglês.
 *
 * O passo 2 existe por um motivo concreto e não por preciosismo: dentro da
 * WebView2 do Windows, `navigator.language` **não reflete de forma confiável**
 * o idioma do sistema (wry#442). Sem perguntar ao SO pelo lado nativo, o app
 * instalado num Windows em português pode abrir em inglês — e essa é a primeira
 * impressão do produto. O lado Rust escreve o valor em `window.__WC_LOCALE__`
 * antes de a página carregar; no navegador ele simplesmente não existe e a
 * cascata cai para o passo 3.
 */

export const IDIOMAS = ["en", "pt", "es"] as const;
export type Idioma = (typeof IDIOMAS)[number];

/** `system` = seguir o sistema, como no tema. */
export type PreferenciaIdioma = Idioma | "system";

export const NOMES_DE_IDIOMA: Record<Idioma, string> = {
  // Cada um escrito NO PRÓPRIO IDIOMA. Quem abriu o app numa língua que não
  // entende precisa reconhecer a sua na lista — "Portuguese" não ajuda quem só
  // lê português.
  en: "English",
  pt: "Português",
  es: "Español"
};

const KEY = "whatscord.locale";

declare global {
  interface Window {
    /** Injetado pelo lado Rust do app instalado. Ausente no navegador. */
    __WC_LOCALE__?: string;
  }
}

export function isIdioma(v: unknown): v is Idioma {
  return typeof v === "string" && (IDIOMAS as readonly string[]).includes(v);
}

/**
 * Reduz uma etiqueta BCP 47 a um dos idiomas que existem aqui.
 *
 * `pt-BR`, `pt-PT` e `pt` são todos português: a região não muda a tradução
 * neste app, e recusar `pt-BR` porque não é exatamente `pt` faria o Brasil
 * inteiro cair no inglês.
 */
export function idiomaDe(tag: string | undefined | null): Idioma | null {
  if (!tag) return null;
  const base = tag.toLowerCase().split(/[-_]/)[0];
  return isIdioma(base) ? base : null;
}

/** O que o sistema pede, olhando primeiro o que o lado nativo informou. */
export function idiomaDoSistema(): Idioma {
  const doSO = idiomaDe(typeof window !== "undefined" ? window.__WC_LOCALE__ : null);
  if (doSO) return doSO;

  const doNavegador = typeof navigator !== "undefined" ? navigator.languages : undefined;
  for (const tag of doNavegador ?? []) {
    const achado = idiomaDe(tag);
    if (achado) return achado;
  }
  return "en";
}

export function preferenciaSalva(): PreferenciaIdioma {
  try {
    const v = localStorage.getItem(KEY);
    return v === "system" || isIdioma(v) ? v : "system";
  } catch {
    return "system";
  }
}

export function resolverIdioma(p: PreferenciaIdioma): Idioma {
  return p === "system" ? idiomaDoSistema() : p;
}

/**
 * Carrega o catálogo e ativa o idioma.
 *
 * O `import` é dinâmico de propósito: sem isso os três catálogos entrariam no
 * pacote principal e todo mundo baixaria as traduções que não vai usar.
 */
export async function ativarIdioma(p: PreferenciaIdioma): Promise<Idioma> {
  const idioma = resolverIdioma(p);
  const { messages } = await import(`../locales/${idioma}.po`);
  i18n.loadAndActivate({ locale: idioma, messages });
  document.documentElement.lang = idioma;
  return idioma;
}

export async function salvarIdioma(p: PreferenciaIdioma): Promise<Idioma> {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    // Sem persistência a escolha ainda vale pela sessão.
  }
  return ativarIdioma(p);
}
