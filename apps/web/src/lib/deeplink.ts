/**
 * Links de convite.
 *
 * Um convite chega de três jeitos, e todos terminam no mesmo lugar:
 *
 *   whatscord://join/<código>              o app desktop, pelo protocolo
 *   https://<host>/?join=<código>          o navegador, ou quem não tem o app
 *   <código>                               digitado à mão, como sempre foi
 *
 * O link web usa PARÂMETRO e não caminho por um motivo concreto: o Vite está
 * com `base: "./"` (exigência da configuração do app desktop), então o
 * index.html referencia os assets relativamente. Num caminho aninhado como
 * `/join/abc`, o navegador procuraria o bundle em `/join/assets/…`, receberia o
 * próprio HTML de volta pelo fallback de SPA, e o app simplesmente não subiria.
 * `/join/<código>` continua sendo aceito na leitura, para o dia em que a base
 * virar absoluta.
 *
 * Nada aqui importa do Tauri de propósito. O app desktop entrega a URL como um
 * evento de DOM (`whatscord:deeplink`), então o mesmo código roda no navegador
 * sem nunca ouvir esse evento — e o build web não carrega uma linha de Tauri.
 */

/** Nome do evento que o lado Rust dispara na janela. */
export const DEEP_LINK_EVENT = "whatscord:deeplink";

/** O esquema registrado no Windows. Precisa bater com tauri.conf.json. */
export const SCHEME = "whatscord";

const PENDING_KEY = "whatscord.pendingInvite";

/**
 * Um código de convite é hexadecimal de 10 caracteres (`crypto.randomBytes(5)`
 * na API). A validação é deliberadamente estreita: isto vem do sistema
 * operacional, por um link que qualquer um pode ter escrito, e vira segmento de
 * uma URL de API. Recusar o que não tem cara de código é mais barato do que
 * confiar e escapar depois.
 */
const CODE = /^[a-fA-F0-9]{6,64}$/;

function sanitize(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  return CODE.test(trimmed) ? trimmed.toLowerCase() : null;
}

/**
 * Extrai o código de qualquer forma que o convite tenha chegado.
 *
 * Devolve `null` para tudo o que não for reconhecido — inclusive URLs bem
 * formadas de outros caminhos, para que um link `whatscord://qualquer/coisa`
 * não seja tratado como convite.
 */
export function inviteCodeFrom(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;

  // Código puro, do jeito que sempre se pôde colar no campo.
  const bare = sanitize(input);
  if (bare) return bare;

  let url: URL;
  try {
    // `base` cobre o caso de vir só o caminho, tipo "/join/abc123".
    url = new URL(input, "https://whatscord.invalid");
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== `${SCHEME}:`) {
    return null;
  }

  /*
   * `whatscord://join/abc` é parseado com host "join" e caminho "/abc", e não
   * com caminho "/join/abc" como se espera de um http. Juntar host e caminho
   * trata as duas formas sem casos especiais.
   */
  const query = sanitize(url.searchParams.get("join")) ?? sanitize(url.searchParams.get("code"));

  const parts = `${url.host}/${url.pathname}`.split("/").filter(Boolean);
  const at = parts.indexOf("join");
  if (at === -1) return query;

  return sanitize(parts[at + 1]) ?? query;
}

/**
 * De onde sai o link que a pessoa vai MANDAR para alguém.
 *
 * Dentro do app desktop `location.origin` é `http://tauri.localhost` — a origem
 * interna da WebView. Um convite com esse endereço não abre em lugar nenhum
 * além da própria máquina, então o link precisa apontar para a web pública.
 * Em desenvolvimento vale o mesmo: `localhost:5173` não serve para compartilhar.
 */
const PUBLIC_WEB_URL =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_WEB_URL ??
  "https://whatscord.167.88.39.225.sslip.io";

const ORIGEM_INTERNA = /^https?:\/\/(tauri\.localhost|localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function shareOrigin(origin: string): string {
  return ORIGEM_INTERNA.test(origin) ? PUBLIC_WEB_URL : origin;
}

/** O link para mandar para alguém: funciona com app ou sem ele. */
export function inviteLink(code: string, origin = window.location.origin): string {
  return `${shareOrigin(origin).replace(/\/$/, "")}/?join=${encodeURIComponent(code)}`;
}

/** O link que abre o app desktop direto, se ele estiver instalado. */
export function appLink(code: string): string {
  return `${SCHEME}://join/${encodeURIComponent(code)}`;
}

/**
 * Guarda um convite que chegou antes de haver sessão.
 *
 * Um link recebido por quem ainda não entrou tem que sobreviver ao login, senão
 * a pessoa faz o cadastro e cai numa tela vazia, sem nunca entrar no espaço para
 * o qual foi convidada.
 */
export function stashPendingInvite(code: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, code);
  } catch {
    /* sem armazenamento o convite só se perde; não vale quebrar o login */
  }
}

/** Olha o convite guardado sem consumi-lo. */
export function peekPendingInvite(): string | null {
  try {
    return sanitize(sessionStorage.getItem(PENDING_KEY));
  } catch {
    return null;
  }
}

/** Lê e consome o convite guardado. */
export function takePendingInvite(): string | null {
  try {
    const code = sessionStorage.getItem(PENDING_KEY);
    if (code) sessionStorage.removeItem(PENDING_KEY);
    return sanitize(code);
  } catch {
    return null;
  }
}

/**
 * O convite embutido no endereço atual, quando o app abriu por `/join/<código>`.
 *
 * Limpa a barra de endereços em seguida: deixar o código ali faz um F5 tentar
 * entrar de novo num espaço em que a pessoa já está.
 */
export function inviteFromLocation(): string | null {
  const code = inviteCodeFrom(window.location.pathname + window.location.search);
  if (code) window.history.replaceState(null, "", "/");
  return code;
}

/** Escuta os links que o app desktop entrega enquanto já está aberto. */
export function onDeepLink(handler: (code: string) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== "string") return;
    const code = inviteCodeFrom(detail);
    if (code) handler(code);
  };
  window.addEventListener(DEEP_LINK_EVENT, listener);
  return () => window.removeEventListener(DEEP_LINK_EVENT, listener);
}
