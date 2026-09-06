import { z } from "zod";

/**
 * Um endereço de imagem que a gente serve.
 *
 * Precisa apontar para um arquivo NOSSO. Aceitar URL arbitrária deixaria
 * qualquer pessoa transformar o próprio avatar — ou o ícone de um grupo — num
 * rastreador: o endereço seria buscado pelo navegador de todo mundo que visse a
 * conversa, entregando IP e horário a um servidor de terceiros. Num ícone de
 * grupo isso é pior do que num avatar, porque quem escolhe o ícone não é
 * necessariamente quem aparece na foto.
 *
 * O `(?!.*\.\.)` não é paranoia: sem ele, `/files/../../etc/passwd` passava na
 * validação. Não chega a ser leitura de arquivo — o valor só vira `src` de
 * imagem e o navegador normaliza para fora do `/files/` — mas guardar caminho
 * que escapa da pasta é o tipo de coisa que vira problema no dia em que alguém
 * usar esse campo do lado do servidor.
 *
 * `null` remove a imagem.
 *
 * Vive aqui, e não colado num único schema, porque a mesma regra vale para
 * `User.avatarUrl` e para `Room.iconUrl`: duplicar a expressão era garantir que
 * um dos dois lados ficaria para trás no dia em que ela mudasse.
 */
export const caminhoDeImagem = z
  .string()
  .max(500)
  .regex(/^\/files\/(?!.*\.\.)[A-Za-z0-9._~%\-/]+$/, "That is not a valid image.")
  .nullable()
  .optional();
