/**
 * One place that knows how to talk to the API, including refreshing an expired
 * access token. Everything else calls `api.get` / `api.post` and never thinks
 * about tokens.
 */

const DEFAULT_API = "https://api.whatscord.167.88.39.225.sslip.io";

export const apiBase: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  localStorage.getItem("whatscord.apiUrl") ??
  DEFAULT_API;

type Tokens = { accessToken: string; refreshToken: string };

const STORE_KEY = "whatscord.session";

export function loadTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: Tokens) {
  localStorage.setItem(STORE_KEY, JSON.stringify(tokens));
}

export function clearTokens() {
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
    let message = "Something went wrong. Try again.";
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* keep the fallback */
    }
    throw new ApiError(res.status, message);
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
          let msg = "That file could not be uploaded.";
          try {
            msg = JSON.parse(xhr.responseText).error ?? msg;
          } catch {
            /* keep the fallback */
          }
          reject(new ApiError(xhr.status, msg));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, "The connection dropped during the upload."));
      xhr.send(form);
    }
  );
}
