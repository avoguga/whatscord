import { api } from "./api";

/**
 * Esqueci a senha e trocar a senha — rede e o leitor do link.
 *
 * O leitor do link mora à parte, em `linkDeSenha.ts`, sem importar nada: este
 * arquivo passa pela camada de rede, que usa macro de tradução, e macro não roda
 * no teste em Node.
 */

export type Sessao = {
  user: { id: string; username: string; displayName: string; avatarUrl: string | null };
  accessToken: string;
  refreshToken: string;
};

/**
 * Pede o link. A resposta é a mesma exista ou não a conta — quem decide o que
 * dizer na tela é a própria tela, e ela diz "se houver uma conta, mandamos".
 */
export async function pedirLinkDeSenha(email: string, idioma: string): Promise<void> {
  await api.post("/auth/forgot", { email, idioma });
}

/** Troca a senha pelo link do e-mail. Já devolve a pessoa logada. */
export async function redefinirSenha(token: string, password: string): Promise<Sessao> {
  return api.post<Sessao>("/auth/reset", { token, password });
}

/** Troca a senha estando logado. Devolve uma sessão nova para este aparelho. */
export async function trocarSenha(atual: string, nova: string): Promise<Sessao> {
  return api.post<Sessao>("/auth/password", { atual, nova });
}

export { tokenDeSenhaEm } from "./linkDeSenha";
