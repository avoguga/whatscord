import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../plugins/auth.js";
import { deleteObject, newObjectKey, putObject } from "../lib/storage.js";
import { falha } from "../lib/falha.js";

/**
 * Sons da bandeja — os de cada pessoa e os de cada espaço.
 *
 * O desenho em uma frase: o BANCO guarda quem é dono do quê, e o áudio vai para
 * o mesmo armazenamento dos anexos. Não há caminho novo de arquivo; a rota
 * pública `/files/<key>` já serve áudio e já está resolvida dentro da WebView.
 *
 * O que isto NÃO faz, de propósito: converter, cortar ou normalizar o áudio.
 * Isso exigiria ffmpeg no container — mais 80 MB de imagem e um processo por
 * upload — para um recurso cuja graça inteira é a rapidez. O que protege o
 * servidor é o limite de TAMANHO, que é verificado aqui e não dá para burlar.
 */

/**
 * Meio megabyte por som.
 *
 * Não é o limite de anexo (25 MB), e a diferença é o ponto: um som da bandeja
 * precisa tocar no instante em que alguém aperta. Um arquivo que leva três
 * segundos para baixar chega depois da piada, e aí o recurso não existe. Meio
 * megabyte cabe folgado em ~5 segundos de MP3 decente — que é o mesmo teto que o
 * Discord usa, pelo mesmo motivo.
 */
const MAX_BYTES = 512 * 1024;

/**
 * Quantos sons cada dono pode ter.
 *
 * Existe porque armazenamento não é infinito e porque uma bandeja com duzentos
 * botões não é uma bandeja — é um problema de busca. O número do espaço é maior
 * porque ali muita gente contribui.
 */
const LIMITE_POR_PESSOA = 12;
const LIMITE_POR_ESPACO = 30;

/** Só áudio, e só os tipos que a rota de download devolve como áudio de verdade. */
const TIPOS = new Set(["audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/mp4"]);

/**
 * O nome e a carinha.
 *
 * O emoji é um campo separado, e não o primeiro caractere do nome, porque a
 * bandeja é lida de relance: o desenho é o que a mão procura, e o texto é a
 * confirmação. Um limite curto no nome não é economia de bytes — é o que impede
 * um botão de esticar a coluna e desalinhar a grade inteira.
 */
const dados = z.object({
  name: z.string().trim().min(1).max(24),
  emoji: z.string().trim().min(1).max(8)
});

function paraFora(s: {
  id: string;
  name: string;
  emoji: string;
  scope: "USER" | "SPACE";
  spaceId: string | null;
  key: string;
  bytes: number;
  createdById: string;
}) {
  return {
    id: s.id,
    name: s.name,
    emoji: s.emoji,
    escopo: s.scope === "SPACE" ? ("espaco" as const) : ("usuario" as const),
    spaceId: s.spaceId,
    /*
     * A URL sai pronta. O cliente não deve saber montar caminho de
     * armazenamento — e, mais importante, quem RECEBE um som pelo canal de
     * dados da chamada precisa de um endereço que ele mesmo não inventou.
     */
    url: `/files/${encodeURIComponent(s.key)}`,
    bytes: s.bytes,
    createdById: s.createdById
  };
}

export async function soundRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  /**
   * A bandeja de quem está perguntando: os sons dela, mais os do espaço pedido.
   *
   * Os dois numa resposta só porque a bandeja mostra os dois juntos. Duas
   * chamadas dariam uma tela que aparece pela metade e completa depois, que é
   * exatamente o tipo de piscada que faz um painel parecer quebrado.
   */
  app.get("/sounds", async (request) => {
    const q = z.object({ spaceId: z.string().optional() }).safeParse(request.query);
    const spaceId = q.success ? q.data.spaceId : undefined;

    const meus = await prisma.sound.findMany({
      where: { scope: "USER", userId: request.userId },
      orderBy: { createdAt: "asc" }
    });

    /*
     * O espaço só entra se quem pergunta for membro. Sem esta checagem, um id de
     * espaço chutado devolveria a bandeja de um servidor de que a pessoa nem
     * participa.
     */
    let doEspaco: typeof meus = [];
    if (spaceId) {
      const membro = await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId, userId: request.userId } }
      });
      if (membro) {
        doEspaco = await prisma.sound.findMany({
          where: { scope: "SPACE", spaceId },
          orderBy: { createdAt: "asc" }
        });
      }
    }

    return {
      meus: meus.map(paraFora),
      doEspaco: doEspaco.map(paraFora),
      limites: { porPessoa: LIMITE_POR_PESSOA, porEspaco: LIMITE_POR_ESPACO, bytes: MAX_BYTES }
    };
  });

  /**
   * Sobe um som.
   *
   * Multipart, com o arquivo e três campos. `spaceId` presente quer dizer "este
   * som é do espaço"; ausente quer dizer "é meu". Um campo `scope` explícito
   * seria uma segunda fonte de verdade para a mesma coisa, e as duas acabariam
   * discordando.
   */
  app.post("/sounds", async (request, reply) => {
    const enviado = await request.file({ limits: { fileSize: MAX_BYTES } });
    if (!enviado) return falha(reply, 400, "sounds.none", "Attach an audio file.");

    const campos = enviado.fields as Record<string, { value?: unknown } | undefined>;
    const texto = (nome: string) => {
      const v = campos[nome]?.value;
      return typeof v === "string" ? v : "";
    };

    const spaceId = texto("spaceId") || null;
    const corpo = dados.safeParse({ name: texto("name"), emoji: texto("emoji") });
    if (!corpo.success) {
      return falha(reply, 400, "sounds.needs_name", "Give the sound a short name and an emoji.");
    }

    const base = (enviado.mimetype || "").split(";")[0].trim().toLowerCase();
    if (!TIPOS.has(base)) {
      return falha(reply, 415, "sounds.not_audio", "That is not an audio file.");
    }

    /*
     * `toBuffer` devolve nulo quando o arquivo estoura o limite do multipart, e
     * essa é a ÚNICA leitura de tamanho em que dá para confiar: o
     * `Content-Length` vem do cliente.
     */
    const bytes = await enviado.toBuffer().catch(() => null);
    if (!bytes) {
      return falha(reply, 413, "sounds.too_big", "Sounds have to be under 512 KB.", {
        kb: Math.round(MAX_BYTES / 1024)
      });
    }
    if (bytes.length === 0) return falha(reply, 400, "sounds.empty", "That file is empty.");

    if (spaceId) {
      /*
       * Som do espaço é do grupo, não de quem subiu: aparece para todo mundo e
       * fica quando a pessoa sai. Por isso a régua é a mesma de quem administra
       * o espaço — um membro comum publicando som para todos seria o caminho
       * mais curto para uma sala impossível de usar.
       */
      const eu = await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId, userId: request.userId } }
      });
      if (!eu) return falha(reply, 403, "spaces.not_member", "You are not in that space.");
      if (eu.role === "MEMBER") {
        return falha(reply, 403, "spaces.staff_only", "Only admins can do that here.");
      }
      const quantos = await prisma.sound.count({ where: { scope: "SPACE", spaceId } });
      if (quantos >= LIMITE_POR_ESPACO) {
        return falha(reply, 409, "sounds.space_full", "This space has reached its sound limit.", {
          limite: LIMITE_POR_ESPACO
        });
      }
    } else {
      const quantos = await prisma.sound.count({
        where: { scope: "USER", userId: request.userId }
      });
      if (quantos >= LIMITE_POR_PESSOA) {
        return falha(reply, 409, "sounds.you_are_full", "You have reached your sound limit.", {
          limite: LIMITE_POR_PESSOA
        });
      }
    }

    const key = newObjectKey(enviado.filename ?? "som.mp3", request.userId);
    await putObject(key, bytes, base);

    const som = await prisma.sound.create({
      data: {
        name: corpo.data.name,
        emoji: corpo.data.emoji,
        scope: spaceId ? "SPACE" : "USER",
        spaceId,
        userId: spaceId ? null : request.userId,
        createdById: request.userId,
        key,
        mime: base,
        bytes: bytes.length
      }
    });

    return reply.code(201).send({ som: paraFora(som) });
  });

  /**
   * Apaga um som.
   *
   * O seu, sempre. O do espaço, se você administra o espaço — e também se foi
   * você quem subiu, porque errar o arquivo é o engano mais comum aqui e obrigar
   * a caçar um administrador para desfazer seria desproporcional.
   */
  app.delete("/sounds/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const som = await prisma.sound.findUnique({ where: { id } });
    if (!som) return falha(reply, 404, "sounds.gone", "That sound is no longer here.");

    let pode = false;
    if (som.scope === "USER") {
      pode = som.userId === request.userId;
    } else if (som.spaceId) {
      if (som.createdById === request.userId) {
        pode = true;
      } else {
        const eu = await prisma.spaceMember.findUnique({
          where: { spaceId_userId: { spaceId: som.spaceId, userId: request.userId } }
        });
        pode = !!eu && eu.role !== "MEMBER";
      }
    }
    if (!pode) return falha(reply, 403, "sounds.not_yours", "That sound is not yours to remove.");

    /*
     * O registro sai primeiro. Se o armazenamento falhar depois, o pior caso é
     * um objeto órfão ocupando meio megabyte — enquanto a ordem inversa deixaria
     * um botão na bandeja de todo mundo apontando para um arquivo que já não
     * existe, e ninguém com permissão para remover.
     */
    await prisma.sound.delete({ where: { id } });
    await deleteObject(som.key).catch(() => undefined);

    return { ok: true };
  });
}
