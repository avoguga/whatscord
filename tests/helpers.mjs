// Utilitários da bateria de testes de integração contra a API em produção.
import { createRequire } from "node:module";
import crypto from "node:crypto";

const require = createRequire("C:/Users/User/Documents/finalmente/whatscord/package.json");
export const { io } = require("socket.io-client");

export const BASE = process.env.WC_BASE ?? "https://api.whatscord.167.88.39.225.sslip.io";

/* ------------------------------------------------------------------ */
/* placar                                                              */
/* ------------------------------------------------------------------ */

export const results = {
  total: 0,
  passed: 0,
  failed: 0,
  failures: [],
  notes: [],
  skipped: []
};

export function pass(desc) {
  results.total += 1;
  results.passed += 1;
  console.log(`PASS  ${desc}`);
}

export function fail(desc, expected, actual) {
  results.total += 1;
  results.failed += 1;
  results.failures.push({ desc, expected, actual });
  console.log(`FAIL  ${desc}`);
  console.log(`        esperado: ${expected}`);
  console.log(`        obtido:   ${actual}`);
}

export function check(desc, ok, expected, actual) {
  if (ok) pass(desc);
  else fail(desc, expected, actual);
}

/** Observação informativa: não conta como teste, mas entra no relatório. */
export function note(text) {
  results.notes.push(text);
  console.log(`NOTA  ${text}`);
}

export async function t(desc, fn) {
  try {
    await fn();
  } catch (err) {
    fail(desc, "o teste rodar até o fim", `exceção: ${err?.stack?.split("\n")[0] ?? err}`);
  }
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

export async function req(method, path, opts = {}) {
  const { token, body, headers } = opts;
  const h = { accept: "application/json", ...(headers ?? {}) };
  let payload;
  if (body !== undefined) {
    if (body instanceof FormData) payload = body;
    else {
      h["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  if (token) h.authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* resposta não-JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

export const GET = (p, o) => req("GET", p, o);
export const POST = (p, o) => req("POST", p, o);
export const PATCH = (p, o) => req("PATCH", p, o);
export const DEL = (p, o) => req("DELETE", p, o);

export function short(r) {
  const body = r.json ? JSON.stringify(r.json) : r.text;
  return `${r.status} ${body.slice(0, 220)}`;
}

/* ------------------------------------------------------------------ */
/* usuários descartáveis                                               */
/* ------------------------------------------------------------------ */

const rand = () => crypto.randomBytes(5).toString("hex");

export async function makeUser(label) {
  const suffix = rand();
  const username = `t${label.toLowerCase()}${suffix}`;
  const email = `t-${suffix}@teste.dev`;
  const password = "senha-de-teste-123";
  const res = await POST("/auth/register", {
    body: { email, username, displayName: `Teste ${label}`, password }
  });
  if (res.status !== 201) throw new Error(`registro de ${label} falhou: ${short(res)}`);
  return {
    label,
    email,
    username,
    password,
    id: res.json.user.id,
    token: res.json.accessToken,
    refreshToken: res.json.refreshToken,
    user: res.json.user
  };
}

/* ------------------------------------------------------------------ */
/* sockets                                                             */
/* ------------------------------------------------------------------ */

export function connectSocket(token, label = "socket") {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      timeout: 15000
    });
    const events = [];
    socket.onAny((name, payload) => events.push({ name, payload, at: Date.now() }));
    const timer = setTimeout(() => reject(new Error(`${label}: timeout ao conectar`)), 20000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve({
        socket,
        events,
        label,
        countOf: (name) => events.filter((e) => e.name === name).length,
        of: (name) => events.filter((e) => e.name === name),
        clear: () => events.splice(0, events.length)
      });
    });
    socket.on("connect_error", (err) => {
      clearTimeout(timer);
      reject(new Error(`${label}: connect_error ${err?.message ?? err}`));
    });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
