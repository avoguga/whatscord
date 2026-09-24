-- "Esqueci a senha".
--
-- A tabela guarda o HASH do token (sha256), nunca o token: o token só existe no
-- e-mail que a pessoa recebe. Um backup vazado desta tabela não redefine a
-- senha de ninguém.
--
-- Pedidos usados ficam, com `usedAt` preenchido, em vez de sumir: é contando
-- as linhas da última hora que se impede alguém de usar o formulário para
-- lotar a caixa de entrada de outra pessoa. O índice (userId, createdAt) é
-- exatamente essa contagem.

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");
CREATE INDEX "PasswordReset_userId_createdAt_idx" ON "PasswordReset"("userId", "createdAt");

-- AddForeignKey
-- Some a conta, somem os pedidos dela.
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
