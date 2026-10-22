-- Reunião instantânea sem conta: quem abre o site sem estar logado também cria.
--
-- Sem conta não há `ownerId`. O anfitrião passa a ser quem guarda a chave que
-- saiu na criação — aqui fica só o hash dela (sha256), como nos links de
-- redefinir senha: quem lê o banco não vira anfitrião de ninguém. `hostName` é
-- o nome que a pessoa digitou, para a tela de espera dizer quem criou.

ALTER TABLE "Meeting" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "Meeting" ADD COLUMN "hostName" TEXT;
ALTER TABLE "Meeting" ADD COLUMN "hostKeyHash" TEXT;
