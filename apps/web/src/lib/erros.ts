import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

/**
 * As mensagens de erro da API, no idioma da interface.
 *
 * A API responde `{ error, code, params }`: a frase em inglês, um identificador
 * estável e os valores que a frase usa. Quem traduz é este arquivo.
 *
 * A tradução acontece no momento em que o erro é LANÇADO, dentro do `api.ts`,
 * e não em cada `catch`. Isso é o que faz as trinta e poucas telas que já
 * mostram `err.message` passarem a falar três idiomas sem uma linha de mudança
 * — e é o que evita que a próxima tela esqueça de traduzir.
 *
 * Um código que não estiver aqui devolve `null`, e o chamador mostra a frase em
 * inglês que veio do servidor. Ficar sem mensagem seria pior do que ficar com a
 * mensagem no idioma errado.
 */
const MENSAGENS: Record<string, MessageDescriptor> = {
  "auth.required": msg`Sign in to continue.`,
  "auth.expired": msg`Your session expired. Sign in again.`,
  "auth.sign_in_again": msg`Sign in again.`,
  "auth.bad_credentials": msg`That email or password is not right.`,
  "auth.missing_refresh": msg`Missing refresh token.`,
  "auth.username_taken": msg`That username is taken.`,
  "auth.email_taken": msg`An account already uses that email.`,
  "auth.account_missing": msg`Account not found.`,

  "calls.disabled": msg`Calls are not set up on this server.`,

  "files.none": msg`Attach a file to upload.`,
  // O limite vem em `params`, não colado na frase: em português o número cai no
  // meio dela, e concatenar no servidor prenderia a tradução à ordem do inglês.
  /*
   * Forma de objeto, e não a de template: só ela deixa o marcador ter NOME.
   * Com `msg\`... ${x} ...\`` o macro numera o marcador pela posição, e a
   * tradução em português — onde o número cai no meio da frase — teria de
   * adivinhar qual número é qual.
   */
  "files.too_big": msg({ message: "Files have to be under {mb} MB." }),
  "files.empty": msg`That file is empty.`,
  "files.bad_reference": msg`Bad file reference.`,
  "files.gone": msg`That file is no longer here.`,

  "messages.bad_cursor": msg`That pagination cursor is not valid.`,
  "messages.bad_pagination": msg`Bad pagination values.`,
  "messages.nothing_to_send": msg`Write something or attach a file.`,
  "messages.reply_other_room": msg`You can only reply to a message in this conversation.`,
  "messages.attachment_not_yours": msg`That attachment is not yours to send.`,
  "messages.attachment_gone": msg`That attachment is no longer available. Upload it again.`,
  "messages.duplicate_send": msg`That send already exists in another conversation.`,
  "messages.empty": msg`The message cannot be empty.`,
  "messages.gone": msg`That message is gone.`,
  "messages.edit_not_yours": msg`You can only edit your own messages.`,
  "messages.delete_not_yours": msg`You can only delete your own messages.`,
  "messages.bad_edit": msg`That edit is not valid.`,
  "messages.pick_emoji": msg`Pick an emoji.`,

  "rooms.gone": msg`That conversation no longer exists.`,
  "rooms.group_only": msg`Only group chats can be edited here.`,
  "rooms.staff_only": msg`Only group admins can change the group.`,
  "rooms.self_dm": msg`You cannot message yourself.`,
  "rooms.person_missing": msg`That person is not on WhatsCord.`,
  "rooms.dm_is_full": msg`A direct message cannot take more people.`,
  "rooms.channel_via_space": msg`People join a channel by joining its space. Share the space invite code instead.`,
  "rooms.no_such_accounts": msg`None of those accounts exist.`,
  "rooms.not_member": msg`You are not in that conversation.`,
  "rooms.pick_someone": msg`Pick someone to message.`,
  "rooms.pick_who": msg`Pick who to add.`,
  "rooms.mute_or_unmute": msg`Say whether to mute or unmute.`,

  "spaces.not_member": msg`You are not in that space.`,
  "spaces.admin_only": msg`Only admins can add channels.`,
  "spaces.bad_invite": msg`That invite is not valid.`,
  "spaces.missing": msg`That space does not exist.`,
  "spaces.needs_name": msg`Give the space a name.`,
  "spaces.staff_only": msg`Only space admins can manage members.`,
  "spaces.owner_only": msg`Only the space owner can do that.`,
  /*
   * A regra de hierarquia inteira numa frase só. Dizer "você não tem permissão"
   * deixaria a pessoa tentando de novo; dizer o critério explica por que um
   * admin não consegue mexer noutro admin, que é o caso que surpreende.
   */
  "spaces.rank_too_low": msg`You cannot act on someone at your own level or above.`,
  "spaces.self_role": msg`You cannot change your own role.`,
  "spaces.leave_instead": msg`Use leave space to remove yourself.`,
  "spaces.member_missing": msg`That person is not in this space.`,
  "spaces.owner_stays": msg`The owner cannot be removed from the space.`,
  "spaces.owner_via_transfer": msg`Transfer ownership instead of setting that role.`,
  "spaces.pick_role": msg`Pick a role: admin or member.`,
  "spaces.pick_owner": msg`Pick who should own the space.`,
  "spaces.folder_missing": msg`That folder does not exist.`,
  "spaces.folder_not_yours": msg`That folder is not yours.`,
  "spaces.needs_folder_name": msg`Give the folder a name.`,
  "spaces.bad_order": msg`That ordering is not valid.`,

  "users.missing": msg`That account does not exist.`,

  "validation.email": msg`Enter a valid email address.`,
  "validation.username_short": msg`Usernames are at least 3 characters.`,
  "validation.username_chars": msg`Use lowercase letters, numbers, dots and underscores.`,
  "validation.password_short": msg`Use at least 8 characters.`,
  "validation.identifier_required": msg`Enter your email or username.`,
  "validation.password_required": msg`Enter your password.`,
  "validation.group_name": msg`Give the group a name.`,
  "validation.avatar_url": msg`That is not a valid image.`,

  "server.broke": msg`Something broke on our side. Try again.`,
  "server.bad_request": msg`That request could not be handled.`
};

/** Só para o teste conferir que os dois lados falam da mesma lista. */
export const CODIGOS_CONHECIDOS = Object.keys(MENSAGENS);

/**
 * Traduz o erro da API, ou devolve `null` se não conhecer o código.
 *
 * `server.bad_request` é o único que não traduz: é o código genérico de "o
 * servidor recusou por um motivo que não tem nome próprio", e nesses casos a
 * frase que veio junto diz mais do que a genérica traduzida diria.
 */
export function traduzirErro(
  code: unknown,
  params?: Record<string, string | number>
): string | null {
  if (typeof code !== "string") return null;
  if (code === "server.bad_request") return null;
  const descritor = MENSAGENS[code];
  /*
   * O `i18n._` tem sobrecarga para id e para descritor, e o TypeScript escolhe
   * a de id quando o segundo argumento aparece. Passar o descritor explícito
   * resolve sem `any`.
   */
  return descritor ? i18n._(descritor.id ?? descritor.message!, params, descritor) : null;
}
