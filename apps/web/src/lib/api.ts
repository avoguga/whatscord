/**
 * One place that knows how to talk to the API, including refreshing an expired
 * access token. Everything else calls `api.get` / `api.post` and never thinks
 * about tokens.
 */

import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { traduzirErro } from "./erros";

const DEFAULT_API = "https://api.whatscord.167.88.39.225.sslip.io";

export const apiBase: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  localStorage.getItem("whatscord.apiUrl") ??
  DEFAULT_API;

type Tokens = { accessToken: string; refreshToken: string };

const STORE_KEY = "whatscord.session";

/**
 * Session storage wins over local storage when both are set.
 *
 * localStorage is shared by every tab on the origin, so two accounts cannot be
 * open side by side — which is exactly what you need to try a call, or to keep
 * a work and a personal account open at once. A session that starts in
 * sessionStorage stays there and belongs to that one tab.
 */
function store(): Storage {
  try {
    return sessionStorage.getItem(STORE_KEY) ? sessionStorage : localStorage;
  } catch {
    return localStorage;
  }
}

export function loadTokens(): Tokens | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY) ?? localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: Tokens) {
  store().setItem(STORE_KEY, JSON.stringify(tokens));
}

export function clearTokens() {
  try {
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* private mode can refuse sessionStorage */
  }
  localStorage.removeItem(STORE_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

async function refreshAccess(): Promise<boolean> {
  const tokens = loadTokens();
  if (!tokens?.refreshToken) return false;

  // Collapse parallel 401s into one refresh.
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${apiBase}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: tokens.refreshToken })
      });
      if (!res.ok) return false;
      saveTokens(await res.json());
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();

  return refreshing;
}

/**
 * A mensagem de erro que a pessoa vai ler, no idioma da interface.
 *
 * A API responde `{ error, code, params }`: a frase em inglês, um identificador
 * estável e os valores que ela usa. Traduzir AQUI, no ponto em que o erro é
 * lançado, e não em cada `catch`, é o que faz as dezenas de telas que já
 * mostram `err.message` falarem três idiomas sem uma linha de mudança — e é o
 * que evita que a próxima tela esqueça.
 *
 * A ordem é deliberada: tradução, depois a frase em inglês que o servidor
 * mandou, e só então um texto de reserva. Um código desconhecido — servidor
 * mais novo que o app instalado — ainda diz algo útil; ficar mudo seria pior
 * do que ficar em inglês.
 */
function lerFalha(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== "object") return null;
  const { code, params, error } = corpo as {
    code?: unknown;
    params?: Record<string, string | number>;
    error?: unknown;
  };
  return traduzirErro(code, params) ?? (typeof error === "string" ? error : null);
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retry = true
): Promise<T> {
  const tokens = loadTokens();
  const headers: Record<string, string> = {};
  if (tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;

  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${apiBase}${path}`, { method, headers, body: payload });

  if (res.status === 401 && retry && (await refreshAccess())) {
    return request<T>(method, path, body, false);
  }

  if (!res.ok) {
    let corpo: unknown = null;
    try {
      corpo = await res.json();
    } catch {
      /* corpo vazio ou ilegível: cai na reserva */
    }
    throw new ApiError(
      res.status,
      lerFalha(corpo) ?? i18n._(msg`Something went wrong. Try again.`)
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path)
};

/** Attachments are served by the API, so relative URLs need the base prefixed. */
export function fileUrl(url: string) {
  return url.startsWith("http") ? url : `${apiBase}${url}`;
}

export async function uploadFile(file: File, onProgress?: (pct: number) => void) {
  const tokens = loadTokens();
  const form = new FormData();
  form.append("file", file);

  // XHR rather than fetch, because upload progress is worth having on a 90 MB video.
  return new Promise<{ key: string; name: string; mime: string; size: number; url: string }>(
    (resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${apiBase}/files`);
      if (tokens?.accessToken) xhr.setRequestHeader("Authorization", `Bearer ${tokens.accessToken}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          let corpo: unknown = null;
          try {
            corpo = JSON.parse(xhr.responseText);
          } catch {
            /* corpo ilegível: cai na reserva */
          }
          reject(
            new ApiError(
              xhr.status,
              lerFalha(corpo) ?? i18n._(msg`That file could not be uploaded.`)
            )
          );
        }
      };
      xhr.onerror = () =>
        reject(new ApiError(0, i18n._(msg`The connection dropped during the upload.`)));
      xhr.send(form);
    }
  );
}
