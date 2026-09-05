-- Idempotência de envio.
--
-- O cliente gera o clientMsgId antes de mandar. Isso faz o reenvio ser
-- idempotente (a mesma mensagem nunca entra duas vezes) e deixa o cliente
-- reconhecer a própria bolha otimista quando a cópia volta pelo socket.
-- Sem isso, um envio aparecia duas vezes na tela.
--
-- A unicidade é POR AUTOR, nunca global. Um índice global deixaria qualquer
-- pessoa buscar a mensagem de outra chutando o id, e faria dois clientes que
-- colidissem no mesmo id perder um dos envios em silêncio.
--
-- Nullable de propósito: mensagens antigas não têm, e no Postgres NULL conta
-- como distinto num índice único, então elas convivem sem conflito.

ALTER TABLE "Message" ADD COLUMN "clientMsgId" TEXT;

CREATE UNIQUE INDEX "Message_authorId_clientMsgId_key"
  ON "Message"("authorId", "clientMsgId");

-- Paginação estável: createdAt tem precisão de milissegundo, e mensagens que
-- caem no mesmo milissegundo voltam em ordem não determinística — o cursor
-- pulava algumas de forma permanente. O id desempata.
DROP INDEX IF EXISTS "Message_roomId_createdAt_idx";
CREATE INDEX "Message_roomId_createdAt_id_idx"
  ON "Message"("roomId", "createdAt", "id");
