-- Sons da bandeja: os do usuário e os do espaço.
--
-- Duas donas possíveis e nunca as duas. O som é de uma PESSOA — vai com ela
-- para qualquer conversa — ou de um ESPAÇO, e aí todo mundo de lá pode tocar.
-- O CHECK abaixo é o que impede o estado "de ninguém" de existir: o Prisma não
-- sabe expressar "um ou outro" no schema, então sem esta linha um bug numa rota
-- criaria uma linha órfã que nenhuma listagem devolveria e ninguém apagaria.
--
-- O áudio NÃO mora aqui. `key` aponta para o mesmo armazenamento dos anexos, que
-- já sabe guardar áudio e já serve por URL. Guardar bytes no banco faria cada
-- abertura da bandeja arrastar megabytes por uma tela que só precisa de nome e
-- carinha.
--
-- `ON DELETE CASCADE` nos três lados, e cada um por um motivo diferente:
-- apagar o espaço leva os sons dele (não sobrevivem a ele); apagar a conta leva
-- os sons pessoais; e apagar quem subiu um som do espaço leva o registro de
-- autoria junto — o que é intencional, porque `createdById` existe para saber a
-- quem cobrar, e cobrar de uma conta que não existe mais não serve para nada.

-- CreateEnum
CREATE TYPE "SoundScope" AS ENUM ('USER', 'SPACE');

-- CreateTable
CREATE TABLE "Sound" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "scope" "SoundScope" NOT NULL,
    "userId" TEXT,
    "spaceId" TEXT,
    "createdById" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sound_pkey" PRIMARY KEY ("id")
);

-- Exatamente um dono, e ele tem de casar com o escopo declarado.
ALTER TABLE "Sound" ADD CONSTRAINT "Sound_um_dono_so" CHECK (
  ("scope" = 'USER'  AND "userId" IS NOT NULL AND "spaceId" IS NULL) OR
  ("scope" = 'SPACE' AND "spaceId" IS NOT NULL AND "userId" IS NULL)
);

-- CreateIndex
CREATE INDEX "Sound_userId_idx" ON "Sound"("userId");

-- CreateIndex
CREATE INDEX "Sound_spaceId_idx" ON "Sound"("spaceId");

-- AddForeignKey
ALTER TABLE "Sound" ADD CONSTRAINT "Sound_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sound" ADD CONSTRAINT "Sound_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sound" ADD CONSTRAINT "Sound_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
