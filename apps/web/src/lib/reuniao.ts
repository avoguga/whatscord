import { api } from "./api";

/**
 * Reuniões por link — as chamadas à API.
 *
 * Funcionam com ou sem conta: a camada de rede só manda o cabeçalho de sessão
 * quando existe uma, e é exatamente isso que separa "entrar com a conta" de
 * "entrar como convidado" do lado do servidor.
 */

/** `id` é nulo quando quem criou não tinha conta (reunião instantânea). */
export type Anfitriao = { id: string | null; displayName: string; avatarUrl: string | null };

export type InfoDaReuniao = {
  code: string;
  title: string | null;
  host: Anfitriao;
  ativa: boolean;
  pessoas: number;
  teto: number;
};

export type Entrada = {
  url: string;
  token: string;
  identidade: string;
  nome: string;
  convidado: boolean;
  souAnfitriao: boolean;
  reuniao: { code: string; title: string | null; host: Anfitriao; link: string };
};

/**
 * Criar. Sem conta, `nome` é obrigatório e a resposta traz a chave de
 * anfitrião — guardada neste navegador, é ela que deixa encerrar e remover.
 */
export async function criarReuniao(nome?: string): Promise<{ reuniao: InfoDaReuniao; link: string }> {
  const r = await api.post<{ reuniao: InfoDaReuniao; link: string; chave?: string }>(
    "/meetings",
    nome ? { nome } : {}
  );
  if (r.chave) guardarChave(r.reuniao.code, r.chave);
  return r;
}

const CHAVE = (code: string) => `whatscord.chaveDaReuniao.${code}`;

function guardarChave(code: string, chave: string) {
  try {
    localStorage.setItem(CHAVE(code), chave);
  } catch {
    /* sem armazenamento, quem criou entra como convidado comum */
  }
}

function chaveDe(code: string): string | undefined {
  try {
    return localStorage.getItem(CHAVE(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function infoDaReuniao(code: string): Promise<InfoDaReuniao> {
  const r = await api.get<{ reuniao: InfoDaReuniao }>(`/meetings/${encodeURIComponent(code)}`);
  return r.reuniao;
}

export async function entrarNaReuniao(code: string, nome?: string): Promise<Entrada> {
  const chave = chaveDe(code);
  return api.post<Entrada>(`/meetings/${encodeURIComponent(code)}/join`, {
    ...(nome ? { nome } : {}),
    ...(chave ? { chave } : {})
  });
}

export async function encerrarParaTodos(code: string): Promise<void> {
  const chave = chaveDe(code);
  await api.post(`/meetings/${encodeURIComponent(code)}/end`, chave ? { chave } : {});
}

export async function removerPessoa(code: string, identidade: string): Promise<void> {
  const chave = chaveDe(code);
  await api.post(`/meetings/${encodeURIComponent(code)}/remove`, { identidade, ...(chave ? { chave } : {}) });
}
