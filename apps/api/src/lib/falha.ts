import type { FastifyReply } from "fastify";

/**
 * Um erro que o cliente consegue traduzir.
 *
 * O corpo continua trazendo `error` com a frase em inglês — nenhum cliente
 * antigo quebra, e um `curl` continua legível. O que muda é a companhia:
 * `code`, que é um identificador estável, e `params`, com os valores que a
 * frase usa.
 *
 * Quem traduz é o CLIENTE, não o servidor. Isso não é preguiça: as regras de
 * plural e de formatação de número e data são de cada idioma, o catálogo já
 * vive no cliente, e negociar por `Accept-Language` obrigaria a duplicar o
 * catálogo aqui e a manter os dois em dia. É também o que a RFC 9457 recomenda
 * para Problem Details: o campo legível é para humanos e não deve ser
 * interpretado; quem identifica o problema é o código.
 *
 * A frase em inglês NÃO é o identificador. Se fosse, mudar uma vírgula no texto
 * derrubaria a tradução em silêncio.
 */

/**
 * Todos os erros que a API sabe emitir.
 *
 * Lista fechada de propósito: um código que o cliente não conhece cai no texto
 * em inglês, e é isso que um teste compara entre os dois lados. Sem a lista,
 * não haveria o que comparar.
 */
export type CodigoDeFalha =
  | "auth.required"
  | "auth.expired"
  | "auth.sign_in_again"
  | "auth.bad_credentials"
  | "auth.missing_refresh"
  | "auth.username_taken"
  | "auth.email_taken"
  | "auth.account_missing"
  | "calls.disabled"
  | "files.none"
  | "files.too_big"
  | "files.empty"
  | "files.bad_reference"
  | "files.gone"
  | "messages.bad_cursor"
  | "messages.nothing_to_send"
  | "messages.reply_other_room"
  | "messages.attachment_not_yours"
  | "messages.attachment_gone"
  | "messages.duplicate_send"
  | "messages.empty"
  | "messages.gone"
  | "messages.edit_not_yours"
  | "messages.delete_not_yours"
  | "rooms.gone"
  | "rooms.self_dm"
  | "rooms.person_missing"
  | "rooms.dm_is_full"
  | "rooms.channel_via_space"
  | "rooms.no_such_accounts"
  | "rooms.not_member"
  | "rooms.group_only"
  | "rooms.staff_only"
  | "spaces.not_member"
  | "spaces.admin_only"
  | "spaces.staff_only"
  | "spaces.owner_only"
  | "spaces.rank_too_low"
  | "spaces.self_role"
  | "spaces.leave_instead"
  | "spaces.member_missing"
  | "spaces.owner_stays"
  | "spaces.owner_via_transfer"
  | "spaces.pick_role"
  | "spaces.pick_owner"
  | "spaces.folder_missing"
  | "spaces.folder_not_yours"
  | "spaces.needs_folder_name"
  | "spaces.bad_order"
  | "spaces.bad_invite"
  | "spaces.missing"
  | "users.missing"
  | "messages.bad_pagination"
  | "messages.bad_edit"
  | "messages.pick_emoji"
  | "rooms.pick_someone"
  | "rooms.pick_who"
  | "rooms.mute_or_unmute"
  | "spaces.needs_name"
  | "validation.email"
  | "validation.username_short"
  | "validation.username_chars"
  | "validation.password_short"
  | "validation.identifier_required"
  | "validation.password_required"
  | "validation.group_name"
  | "validation.avatar_url"
  | "server.broke"
  | "server.bad_request";

export type Falha = {
  error: string;
  code: CodigoDeFalha;
  params?: Record<string, string | number>;
};

/**
 * Responde um erro.
 *
 * `mensagem` é a frase em inglês, escrita no ponto da chamada para ficar ao
 * lado do que a causou; `params` carrega os valores que ela interpola, para o
 * cliente montar a mesma frase no idioma dele.
 */
export function falha(
  reply: FastifyReply,
  status: number,
  code: CodigoDeFalha,
  mensagem: string,
  params?: Record<string, string | number>
) {
  const corpo: Falha = { error: mensagem, code };
  if (params) corpo.params = params;
  return reply.code(status).send(corpo);
}

/**
 * A mensagem que o zod devolve, de volta ao codigo que a nomeia.
 *
 * A validacao acontece longe de quem responde: o `safeParse` monta a frase a
 * partir do schema, e no ponto do `send` so existe `issues[0].message`. Em vez
 * de espalhar codigo por cada campo de cada schema, a tabela faz o caminho de
 * volta uma vez so.
 *
 * O custo e ficar preso ao texto: mudar a frase no schema sem mudar aqui faz a
 * mensagem cair no ingles em silencio. Por isso existe um teste que compara as
 * duas listas.
 */
const POR_MENSAGEM: Record<string, CodigoDeFalha> = {
  "Enter a valid email address.": "validation.email",
  "Usernames are at least 3 characters.": "validation.username_short",
  "Use lowercase letters, numbers, dots and underscores.": "validation.username_chars",
  "Use at least 8 characters.": "validation.password_short",
  "Enter your email or username.": "validation.identifier_required",
  "Enter your password.": "validation.password_required",
  "Give the group a name.": "validation.group_name",
  "That is not a valid image.": "validation.avatar_url"
};

/**
 * Responde uma falha de validacao do zod.
 *
 * Uma mensagem que nao esteja na tabela ainda sai, com o codigo generico: e
 * melhor mostrar a frase em ingles do que engolir o motivo da recusa.
 */
export function falhaDeValidacao(reply: FastifyReply, mensagem: string) {
  return falha(reply, 400, POR_MENSAGEM[mensagem] ?? "server.bad_request", mensagem);
}

/** So para o teste conferir que a tabela cobre o que os schemas emitem. */
export const MENSAGENS_DE_VALIDACAO = Object.keys(POR_MENSAGEM);
