/**
 * Tema claro / escuro / igual ao dispositivo.
 *
 * Três opções, não duas, porque "igual ao dispositivo" é o padrão do Discord
 * ("Sync with computer") e é o que faz o app acompanhar o modo noturno do
 * sistema sem a pessoa precisar trocar duas vezes por dia. É também o único
 * valor honesto para quem nunca abriu esta tela.
 *
 * O escuro continua sendo o resultado de "sistema" quando o sistema não diz
 * nada: era o comportamento anterior, e mudá-lo silenciosamente para claro
 * seria uma regressão visível para quem já usa o app.
 */

export type Theme = "light" | "dark" | "system";

/** O que de fato é pintado. `system` nunca chega ao CSS. */
export type ResolvedTheme = "light" | "dark";

const KEY = "whatscord.theme";

export function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark" || v === "system";
}

export function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : "system";
  } catch {
    // Modo privado com armazenamento bloqueado cai aqui. Não é motivo para
    // derrubar a inicialização do app.
    return "system";
  }
}

/**
 * O que o sistema operacional pede.
 *
 * Ausência de resposta vira `dark` de propósito: `prefers-color-scheme` não
 * tem valor "desconhecido", e um navegador que não suporta a consulta devolve
 * `false` para as duas — indistinguível de "quer claro". Preferir escuro nesse
 * empate mantém o app exatamente como era antes desta funcionalidade existir.
 */
export function systemTheme(): ResolvedTheme {
  if (typeof matchMedia !== "function") return "dark";
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveTheme(t: Theme): ResolvedTheme {
  return t === "system" ? systemTheme() : t;
}

/**
 * Carimba o tema no `<html>`.
 *
 * `color-scheme` vai junto e não é detalhe: é ele que decide a cor das barras
 * de rolagem nativas, do cursor de texto e dos controles de formulário que o
 * navegador desenha sozinho. Sem isso, um app claro ganha barra de rolagem
 * preta.
 */
export function applyTheme(t: Theme): ResolvedTheme {
  const resolvido = resolveTheme(t);
  const raiz = document.documentElement;
  raiz.dataset.theme = resolvido;
  raiz.style.colorScheme = resolvido;
  return resolvido;
}

export function saveTheme(t: Theme): ResolvedTheme {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Sem persistência ainda vale pintar: a escolha dura a sessão.
  }
  return applyTheme(t);
}

/**
 * Acompanha o sistema enquanto a preferência for `system`.
 *
 * Sem isto, quem escolhe "igual ao dispositivo" acerta o tema na abertura e
 * depois fica preso nele — o Windows troca para o modo noturno às 18h e o app
 * segue claro até o próximo recarregamento.
 */
export function watchSystemTheme(get: () => Theme): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const mq = matchMedia("(prefers-color-scheme: light)");
  const aoMudar = () => {
    if (get() === "system") applyTheme("system");
  };
  mq.addEventListener("change", aoMudar);
  return () => mq.removeEventListener("change", aoMudar);
}
