-- Reuniões por link, no jeito do Google Meet.
--
-- Só quem CRIA tem linha aqui. Quem entra sem conta não tem: é um nome dentro
-- do token do LiveKit e some quando sai — guardá-lo seria inventar uma conta
-- que ninguém pediu.
--
-- `expiresAt` existe porque um link aberto não pode valer para sempre. O índice
-- (ownerId, createdAt) é a contagem do teto de criação por hora.

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_code_key" ON "Meeting"("code");
CREATE INDEX "Meeting_ownerId_createdAt_idx" ON "Meeting"("ownerId", "createdAt");

-- AddForeignKey
-- Some a conta, somem as reuniões que ela criou.
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
