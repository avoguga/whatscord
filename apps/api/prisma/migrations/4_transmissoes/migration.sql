-- Transmissões: uma pessoa apresenta, muitas assistem.
--
-- A MÍDIA não passa por aqui e nem pela API: vai direto para o LiveKit, na sala
-- `stream_<id>`. O que esta tabela guarda é quem é dono, quem pode assistir e se
-- está no ar. A separação é deliberada — trocar a forma de ENTREGAR o vídeo
-- (hoje WebRTC para cada espectador, amanhã HLS atrás de uma CDN, quando a
-- conta de banda exigir) não pode obrigar a mexer no modelo de dados.
--
-- `ALTER TYPE ... ADD VALUE` dentro da transação da migração só é legal a partir
-- do PostgreSQL 12, e mesmo assim com a condição de o valor novo não ser USADO
-- antes do commit. Estamos no 16 e nenhuma linha abaixo escreve 'STREAM', então
-- passa. Se um dia esta migração ganhar um INSERT com o valor novo, ela terá de
-- ser partida em duas.

-- CreateEnum
CREATE TYPE "StreamVisibility" AS ENUM ('PUBLIC', 'SPACE', 'LINK');

-- AlterEnum
ALTER TYPE "RoomKind" ADD VALUE 'STREAM';

-- CreateTable
CREATE TABLE "Stream" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "spaceId" TEXT,
    "visibility" "StreamVisibility" NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stream_pkey" PRIMARY KEY ("id")
);

-- Uma transmissão de espaço PRECISA de espaço.
--
-- Sem isto, uma rota com defeito criaria uma transmissão `SPACE` sem `spaceId`:
-- a checagem de permissão perguntaria "é membro de qual espaço?", não teria
-- resposta, e o resultado dependeria de como o código trata o nulo — que é
-- exatamente o tipo de pergunta que não se quer fazer sobre quem pode assistir.
--
-- O contrário É permitido de propósito: uma transmissão pública pode nascer
-- dentro de um espaço e continuar pública. Isso é o que vai permitir, depois,
-- avisar o espaço quando alguém dele entra ao vivo.
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_espaco_quando_preciso"
    CHECK ("visibility" <> 'SPACE' OR "spaceId" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "Stream_inviteCode_key" ON "Stream"("inviteCode");
CREATE UNIQUE INDEX "Stream_roomId_key" ON "Stream"("roomId");
CREATE INDEX "Stream_ownerId_idx" ON "Stream"("ownerId");
CREATE INDEX "Stream_spaceId_idx" ON "Stream"("spaceId");

-- O índice da tela de início.
--
-- Parcial de propósito: a pergunta que essa tela faz é sempre "o que está no ar
-- agora", e o que já terminou é a maior parte da tabela depois de algumas
-- semanas. Um índice que só guarda as linhas vivas continua pequeno para sempre.
CREATE INDEX "Stream_ao_vivo_idx" ON "Stream"("visibility", "startedAt")
    WHERE "endedAt" IS NULL;

-- AddForeignKey
--
-- Três cascatas, cada uma por um motivo: some a conta, somem as transmissões
-- dela; some o espaço, somem as transmissões que eram dele; e some a SALA, some
-- a transmissão — este último é o caminho de apagar, porque apagar a sala já
-- leva o bate-papo inteiro por cascata e não deixa sobra.
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
