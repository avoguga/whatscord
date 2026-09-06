-- Ordem e pastas da barra lateral, por usuário.
--
-- `position` e `folderId` moram em SpaceMember, e não em Space, porque a ordem
-- é de QUEM OLHA. Se morasse no espaço, arrastar um servidor para o topo
-- reordenaria a barra lateral de todos os outros membros dele.
--
-- Nada precisa de backfill: `position` nasce 0 para todo mundo e a listagem
-- desempata por `joinedAt`, então a ordem de hoje continua a mesma até alguém
-- arrastar o primeiro espaço.

ALTER TABLE "SpaceMember" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SpaceMember" ADD COLUMN "folderId" TEXT;

-- CreateTable
CREATE TABLE "SpaceFolder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpaceFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpaceFolder_userId_idx" ON "SpaceFolder"("userId");

-- CreateIndex
CREATE INDEX "SpaceMember_folderId_idx" ON "SpaceMember"("folderId");

-- AddForeignKey
ALTER TABLE "SpaceFolder" ADD CONSTRAINT "SpaceFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ON DELETE SET NULL, nunca CASCADE: apagar uma pasta não pode arrastar junto
-- os espaços que estavam dentro dela — são conversas inteiras, de outras
-- pessoas. Sem a pasta, eles apenas voltam a ficar soltos na barra lateral.
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "SpaceFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
