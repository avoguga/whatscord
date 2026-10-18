import { api } from "./api";

/**
 * Reuniões por link — as chamadas à API.
 *
 * Funcionam com ou sem conta: a camada de rede só manda o cabeçalho de sessão
 * quando existe uma, e é exatamente isso que separa "entrar com a conta" de
 * "entrar como convidado" do lado do servidor.
 */

export type Anfitriao = { id: string; displayName: string; avatarUrl: string | null };

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

export async function criarReuniao(title?: string): Promise<{ reuniao: InfoDaReuniao; link: string }> {
  return api.post("/meetings", title ? { title } : {});
}

export async function infoDaReuniao(code: string): Promise<InfoDaReuniao> {
  const r = await api.get<{ reuniao: InfoDaReuniao }>(`/meetings/${encodeURIComponent(code)}`);
  return r.reuniao;
}

export async function entrarNaReuniao(code: string, nome?: string): Promise<Entrada> {
  return api.post<Entrada>(`/meetings/${encodeURIComponent(code)}/join`, nome ? { nome } : {});
}

export async function encerrarParaTodos(code: string): Promise<void> {
  await api.post(`/meetings/${encodeURIComponent(code)}/end`);
}

export async function removerPessoa(code: string, identidade: string): Promise<void> {
  await api.post(`/meetings/${encodeURIComponent(code)}/remove`, { identidade });
}
