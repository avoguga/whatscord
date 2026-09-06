import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { userSelect } from "../lib/shapes.js";
import { authGuard } from "../plugins/auth.js";
import { emitToRoom, emitToUsers, joinUserSockets, leaveUserSockets } from "../realtime/bus.js";
import { falha, falhaDeValidacao } from "../lib/falha.js";

const inviteCode = () => crypto.randomBytes(5).toString("hex");

const pastaSelect = { id: true, name: true, color: true, position: true } as const;

/**
 * A hierarquia, em número.
 *
 * A regra que vale em todas as rotas é uma só: NINGUÉM AGE SOBRE ALGUÉM DO
 * MESMO NÍVEL OU ACIMA. É o que impede dois administradores de se rebaixarem
 * mutuamente, e é o que impede um deles de expulsar o outro — brigas que, sem
 * a regra, acabam em espaço sem ninguém para administrar.
 */
const nivel = { OWNER: 3, ADMIN: 2, MEMBER: 1 } as const;

export async function spaceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/spaces", async (request) => {
    const memberships = await prisma.spaceMember.findMany({
      where: { userId: request.userId },
      /*
       * `position` empatado cai em `joinedAt`: enquanto ninguém tiver arrastado
       * nada, todas as posições valem 0, e sem o desempate a lista voltaria numa
       * ordem diferente a cada carregamento — a barra lateral dançando sozinha.
       */
      orderBy: [{ position: "asc" }, { joinedAt: "asc" }],
      include: {
        space: {
          include: {
            _count: { select: { members: true } },
            rooms: {
              orderBy: [{ position: "asc" }, { createdAt: "asc" }],
              select: { id: true, name: true, kind: true, topic: true, position: true }
            }
          }
        }
      }
    });

    return {
      spaces: memberships.map((m) => ({
        id: m.space.id,
        name: m.space.name,
        iconUrl: m.space.iconUrl,
        inviteCode: m.space.inviteCode,
        role: m.role,
        position: m.position,
        folderId: m.folderId,
        memberCount: m.space._count.members,
        channels: m.space.rooms
      }))
    };
  });

  /* ---------------------------------------------------------------- */
  /* Pastas da barra lateral                                          */
  /* ---------------------------------------------------------------- */

  app.get("/space-folders", async (request) => {
    const folders = await prisma.spaceFolder.findMany({
      where: { userId: request.userId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: pastaSelect
    });
    return { folders };
  });

  app.post("/space-folders", async (request, reply) => {
    const body = z
      .object({ name: z.string().min(1).max(60), color: z.string().max(30).nullable().optional() })
      .safeParse(request.body);
    if (!body.success) {
      return falha(reply, 400, "spaces.needs_folder_name", "Give the folder a name.");
    }

    // A pasta nova nasce no fim da lista; nascer em 0 empurraria as outras.
    const quantas = await prisma.spaceFolder.count({ where: { userId: request.userId } });
    const folder = await prisma.spaceFolder.create({
      data: {
        userId: request.userId,
        name: body.data.name,
        color: body.data.color ?? null,
        position: quantas
      },
      select: pastaSelect
    });
    return reply.code(201).send({ folder });
  });

  app.patch("/space-folders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).max(60).optional(),
        color: z.string().max(30).nullable().optional(),
        position: z.number().int().min(0).max(9999).optional()
      })
      .safeParse(request.body ?? {});
    if (!body.success) {
      return falha(reply, 400, "spaces.needs_folder_name", "Give the folder a name.");
    }

    // Corpo sem nenhum campo não é erro, mas também não é `UPDATE` nenhum.
    const vazio = Object.values(body.data).every((v) => v === undefined);
    if (vazio) {
      const folder = await prisma.spaceFolder.findFirst({
        where: { id, userId: request.userId },
        select: pastaSelect
      });
      if (!folder) return falha(reply, 404, "spaces.folder_missing", "That folder does not exist.");
      return { folder };
    }

    /*
     * O `updateMany` filtra por dono na mesma consulta que grava. Buscar antes
     * e gravar depois abriria uma janela entre as duas — e, pior, um `update`
     * por id sozinho deixaria qualquer pessoa renomear a pasta de outra.
     */
    const alterou = await prisma.spaceFolder.updateMany({
      where: { id, userId: request.userId },
      data: body.data
    });
    if (alterou.count === 0) {
      return falha(reply, 404, "spaces.folder_missing", "That folder does not exist.");
    }

    const folder = await prisma.spaceFolder.findUnique({ where: { id }, select: pastaSelect });
    return { folder };
  });

  /**
   * Apagar a pasta NÃO apaga o que estava dentro.
   *
   * O `onDelete: SetNull` do banco devolve os espaços para fora de qualquer
   * pasta. Apagá-los junto seria arrancar conversas inteiras de todo mundo por
   * causa de uma gaveta que uma pessoa resolveu desfazer na barra lateral dela.
   */
  app.delete("/space-folders/:id", async (request, reply) => {
    const apagou = await prisma.spaceFolder.deleteMany({
      where: { id: (request.params as { id: string }).id, userId: request.userId }
    });
    if (apagou.count === 0) {
      return falha(reply, 404, "spaces.folder_missing", "That folder does not exist.");
    }
    return reply.code(204).send();
  });

  /**
   * Reordenar a barra lateral.
   *
   * Tudo numa transação: metade da ordem aplicada é pior do que nenhuma —
   * a tela ficaria com dois espaços na mesma posição, e o desempate por
   * `joinedAt` faria a lista pular sozinha no próximo carregamento.
   *
   * Espaço de que a pessoa não é membro é ignorado EM SILÊNCIO. Recusar com
   * erro responderia "esse espaço existe, você é que não está nele" para
   * qualquer id chutado.
   */
  app.patch("/spaces/order", async (request, reply) => {
    const body = z
      .object({
        items: z
          .array(
            z.object({
              spaceId: z.string().min(1),
              position: z.number().int().min(0).max(9999),
              folderId: z.string().min(1).nullable().optional()
            })
          )
          .max(300)
      })
      .safeParse(request.body);
    if (!body.success) return falha(reply, 400, "spaces.bad_order", "That ordering is not valid.");

    const pastas = [...new Set(body.data.items.map((i) => i.folderId).filter(Boolean))] as string[];
    if (pastas.length > 0) {
      const minhas = await prisma.spaceFolder.count({
        where: { id: { in: pastas }, userId: request.userId }
      });
      /*
       * Pasta de outra pessoa é recusa, não silêncio: aqui o silêncio gravaria
       * um `folderId` que a listagem nunca devolveria, e o espaço sumiria da
       * barra lateral sem explicação.
       */
      if (minhas !== pastas.length) {
        return falha(reply, 403, "spaces.folder_not_yours", "That folder is not yours.");
      }
    }

    const meus = await prisma.spaceMember.findMany({
      where: { userId: request.userId, spaceId: { in: body.data.items.map((i) => i.spaceId) } },
      select: { spaceId: true }
    });
    const permitidos = new Set(meus.map((m) => m.spaceId));

    await prisma.$transaction(
      body.data.items
        .filter((item) => permitidos.has(item.spaceId))
        .map((item) =>
          prisma.spaceMember.update({
            where: { spaceId_userId: { spaceId: item.spaceId, userId: request.userId } },
            data: { position: item.position, folderId: item.folderId ?? null }
          })
        )
    );

    // As outras abas da MESMA pessoa: a ordem é dela, ninguém mais a vê.
    emitToUsers([request.userId], "spaces:order", { userId: request.userId });
    return reply.code(204).send();
  });

  /** A new space always opens with one text channel and one voice channel. */
  app.post("/spaces", async (request, reply) => {
    const body = z.object({ name: z.string().min(1).max(60) }).safeParse(request.body);
    if (!body.success) return falha(reply, 400, "spaces.needs_name", "Give the space a name.");

    const space = await prisma.space.create({
      data: {
        name: body.data.name,
        ownerId: request.userId,
        inviteCode: inviteCode(),
        members: { create: { userId: request.userId, role: "OWNER" } },
        rooms: {
          create: [
            { kind: "TEXT", name: "general", position: 0 },
            { kind: "VOICE", name: "Voice", position: 1 }
          ]
        }
      },
      include: { rooms: true }
    });

    await prisma.roomMember.createMany({
      data: space.rooms.map((r) => ({ roomId: r.id, userId: request.userId, role: "OWNER" as const }))
    });
    await Promise.all(space.rooms.map((r) => joinUserSockets(request.userId, r.id)));

    return reply.code(201).send({
      space: {
        id: space.id,
        name: space.name,
        inviteCode: space.inviteCode,
        channels: space.rooms.map((r) => ({ id: r.id, name: r.name, kind: r.kind }))
      }
    });
  });

  app.post("/spaces/:id/channels", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).max(60),
        kind: z.enum(["TEXT", "VOICE"]).default("TEXT"),
        topic: z.string().max(300).optional()
      })
      .safeParse(request.body);
    if (!body.success) return falhaDeValidacao(reply, body.error.issues[0].message);

    const membership = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId: request.userId } }
    });
    if (!membership) return falha(reply, 404, "spaces.not_member", "You are not in that space.");
    if (membership.role === "MEMBER") {
      return falha(reply, 403, "spaces.admin_only", "Only admins can add channels.");
    }

    const count = await prisma.room.count({ where: { spaceId: id } });
    const room = await prisma.room.create({
      data: {
        spaceId: id,
        kind: body.data.kind,
        name: body.data.name,
        topic: body.data.topic,
        position: count
      }
    });

    // Everyone in the space gets the new channel.
    const members = await prisma.spaceMember.findMany({
      where: { spaceId: id },
      select: { userId: true }
    });
    await prisma.roomMember.createMany({
      data: members.map((m) => ({ roomId: room.id, userId: m.userId })),
      skipDuplicates: true
    });
    const ids = members.map((m) => m.userId);
    await Promise.all(ids.map((u) => joinUserSockets(u, room.id)));
    emitToUsers(ids, "room:new", { roomId: room.id });

    return reply.code(201).send({ channel: { id: room.id, name: room.name, kind: room.kind } });
  });

  app.post("/spaces/join/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const space = await prisma.space.findUnique({
      where: { inviteCode: code },
      include: { rooms: true }
    });
    if (!space) return falha(reply, 404, "spaces.bad_invite", "That invite is not valid.");

    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: space.id, userId: request.userId } },
      create: { spaceId: space.id, userId: request.userId },
      update: {}
    });
    await prisma.roomMember.createMany({
      data: space.rooms.map((r) => ({ roomId: r.id, userId: request.userId })),
      skipDuplicates: true
    });
    await Promise.all(space.rooms.map((r) => joinUserSockets(request.userId, r.id)));

    emitToUsers([request.userId], "space:joined", { spaceId: space.id });

    /*
     * Everyone already in the space has to hear about it too. Telling only the
     * person who joined is why someone could accept an invite and simply not
     * appear on the inviter's screen until they reloaded the page.
     */
    const others = await prisma.spaceMember.findMany({
      where: { spaceId: space.id, userId: { not: request.userId } },
      select: { userId: true }
    });
    emitToUsers(
      others.map((o) => o.userId),
      "space:members",
      { spaceId: space.id }
    );
    for (const room of space.rooms) {
      emitToRoom(room.id, "room:members", { roomId: room.id });
    }

    return { space: { id: space.id, name: space.name } };
  });

  /**
   * Sair de um espaço.
   *
   * Entrar era possível desde sempre; sair, não — quem aceitava um convite
   * ficava lá para sempre, sem nenhuma saída pela API nem pela interface.
   *
   * Duas decisões que valem estar escritas:
   *
   * As MENSAGENS FICAM. Apagar o que a pessoa escreveu ao sair arrancaria
   * metade das conversas de todo mundo que continua, e ninguém espera isso ao
   * clicar em "sair".
   *
   * O DONO PODE SAIR. Prender quem criou o espaço dentro dele é pior do que
   * transferir: a posse passa para o membro mais antigo que restou. Se não
   * restou ninguém, o espaço é apagado — e aí sim as mensagens vão junto, por
   * cascata, porque não há mais quem as leia.
   */
  app.delete("/spaces/:id/members/me", async (request, reply) => {
    const { id } = request.params as { id: string };

    const space = await prisma.space.findUnique({
      where: { id },
      include: { rooms: { select: { id: true } } }
    });
    if (!space) return falha(reply, 404, "spaces.missing", "That space does not exist.");

    const membership = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId: request.userId } }
    });
    if (!membership) return falha(reply, 404, "spaces.not_member", "You are not in that space.");

    const roomIds = space.rooms.map((r) => r.id);

    await prisma.$transaction([
      prisma.spaceMember.delete({
        where: { spaceId_userId: { spaceId: id, userId: request.userId } }
      }),
      prisma.roomMember.deleteMany({
        where: { roomId: { in: roomIds }, userId: request.userId }
      })
    ]);

    /*
     * Tirar a linha do banco não basta: uma aba aberta continua inscrita nos
     * canais e recebendo mensagem até alguém recarregar a página.
     */
    await Promise.all(roomIds.map((roomId) => leaveUserSockets(request.userId, roomId)));

    const restantes = await prisma.spaceMember.findMany({
      where: { spaceId: id },
      orderBy: { joinedAt: "asc" },
      select: { userId: true }
    });

    if (restantes.length === 0) {
      // Ninguém restou: o espaço, seus canais e suas mensagens somem por cascata.
      await prisma.space.delete({ where: { id } });
      emitToUsers([request.userId], "space:left", { spaceId: id });
      return reply.send({ ok: true, spaceDeleted: true });
    }

    if (space.ownerId === request.userId) {
      const herdeiro = restantes[0].userId;
      await prisma.$transaction([
        prisma.space.update({ where: { id }, data: { ownerId: herdeiro } }),
        prisma.spaceMember.update({
          where: { spaceId_userId: { spaceId: id, userId: herdeiro } },
          data: { role: "OWNER" }
        })
      ]);
    }

    emitToUsers([request.userId], "space:left", { spaceId: id });
    emitToUsers(
      restantes.map((m) => m.userId),
      "space:members",
      { spaceId: id }
    );
    for (const roomId of roomIds) {
      emitToRoom(roomId, "room:members", { roomId });
    }

    return reply.send({ ok: true, spaceDeleted: false });
  });

  app.get("/spaces/:id/members", async (request, reply) => {
    const { id } = request.params as { id: string };
    const membership = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId: request.userId } }
    });
    if (!membership) return falha(reply, 404, "spaces.not_member", "You are not in that space.");

    const members = await prisma.spaceMember.findMany({
      where: { spaceId: id },
      /*
       * Por papel e depois por nome. O enum `MemberRole` está declarado na
       * ordem OWNER, ADMIN, MEMBER, e o Postgres ordena enum pela ordem da
       * declaração — então `asc` já é a hierarquia, sem tabela de tradução.
       */
      orderBy: [{ role: "asc" }, { user: { displayName: "asc" } }],
      include: { user: { select: userSelect } }
    });
    return {
      members: members.map((m) => ({ ...m.user, role: m.role, joinedAt: m.joinedAt }))
    };
  });

  /* ---------------------------------------------------------------- */
  /* Administrar membros                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Promover e rebaixar.
   *
   * Só o dono mexe em papel. Deixar um administrador promover outro faria o
   * cargo se espalhar sozinho: quem entrou pelo convite de ontem vira
   * administrador hoje e distribui o cargo amanhã, e não há como o dono voltar
   * atrás mais depressa do que a lista cresce.
   *
   * Não existe um segundo dono. Para passar a posse existe rota própria, que
   * troca os dois papéis de uma vez — sem ela, "promover a OWNER" deixaria o
   * espaço com dois donos e nenhuma regra para desempatar.
   */
  app.patch("/spaces/:id/members/:userId", async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const body = z
      .object({ role: z.enum(["OWNER", "ADMIN", "MEMBER"]) })
      .safeParse(request.body);
    if (!body.success) {
      return falha(reply, 400, "spaces.pick_role", "Pick a role: admin or member.");
    }

    const eu = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId: request.userId } }
    });
    if (!eu) return falha(reply, 404, "spaces.not_member", "You are not in that space.");

    if (userId === request.userId) {
      return falha(reply, 403, "spaces.self_role", "You cannot change your own role.");
    }

    const alvo = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId } }
    });
    if (!alvo) return falha(reply, 404, "spaces.member_missing", "That person is not in this space.");

    if (body.data.role === "OWNER") {
      return falha(
        reply,
        400,
        "spaces.owner_via_transfer",
        "Transfer ownership instead of setting that role."
      );
    }

    /*
     * A hierarquia vem antes de "só o dono": um administrador tentando mexer
     * noutro administrador tem que ouvir que o problema é o nível do outro, e
     * não que ele deveria ser dono — a segunda frase o faria tentar de novo.
     */
    if (nivel[eu.role] <= nivel[alvo.role]) {
      return falha(
        reply,
        403,
        "spaces.rank_too_low",
        "You cannot act on someone at your own level or above."
      );
    }
    if (eu.role !== "OWNER") {
      return falha(reply, 403, "spaces.owner_only", "Only the space owner can do that.");
    }

    await prisma.spaceMember.update({
      where: { spaceId_userId: { spaceId: id, userId } },
      data: { role: body.data.role }
    });

    await avisarMembros(id);
    return { ok: true, role: body.data.role };
  });

  /**
   * Passar a posse.
   *
   * O dono antigo vira ADMIN, não MEMBER: quem entregou as chaves continua
   * sendo quem construiu o lugar, e rebaixá-lo a membro comum tiraria dele
   * até a possibilidade de criar um canal no espaço que era dele.
   */
  app.post("/spaces/:id/owner", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ userId: z.string().min(1) }).safeParse(request.body);
    if (!body.success) {
      return falha(reply, 400, "spaces.pick_owner", "Pick who should own the space.");
    }

    const eu = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId: request.userId } }
    });
    if (!eu) return falha(reply, 404, "spaces.not_member", "You are not in that space.");
    if (eu.role !== "OWNER") {
      return falha(reply, 403, "spaces.owner_only", "Only the space owner can do that.");
    }
    if (body.data.userId === request.userId) {
      return falha(reply, 403, "spaces.self_role", "You cannot change your own role.");
    }

    const alvo = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId: body.data.userId } }
    });
    if (!alvo) return falha(reply, 404, "spaces.member_missing", "That person is not in this space.");

    /*
     * Os três gravam juntos. Se o `Space.ownerId` mudasse e os papéis não, o
     * espaço passaria a ter um dono que a lista de membros mostra como membro
     * comum — e ninguém conseguiria administrar nada.
     */
    await prisma.$transaction([
      prisma.space.update({ where: { id }, data: { ownerId: body.data.userId } }),
      prisma.spaceMember.update({
        where: { spaceId_userId: { spaceId: id, userId: body.data.userId } },
        data: { role: "OWNER" }
      }),
      prisma.spaceMember.update({
        where: { spaceId_userId: { spaceId: id, userId: request.userId } },
        data: { role: "ADMIN" }
      })
    ]);

    await avisarMembros(id);
    return { ok: true, ownerId: body.data.userId };
  });

  /**
   * Remover alguém do espaço.
   *
   * AS MENSAGENS FICAM. Isto é regra do produto, não detalhe de implementação:
   * apagar o que a pessoa escreveu arrancaria metade das conversas de todo
   * mundo que continua no espaço, e ninguém espera isso ao expulsar alguém.
   * O que sai é o acesso — a associação ao espaço, as associações aos canais e
   * as inscrições dos sockets que ainda estão abertos.
   */
  app.delete("/spaces/:id/members/:userId", async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };

    const eu = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId: request.userId } }
    });
    if (!eu) return falha(reply, 404, "spaces.not_member", "You are not in that space.");

    if (userId === request.userId) {
      // Sair é outra rota, e ela sabe transferir a posse e apagar o espaço vazio.
      return falha(reply, 400, "spaces.leave_instead", "Use leave space to remove yourself.");
    }

    const alvo = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId } }
    });
    if (!alvo) return falha(reply, 404, "spaces.member_missing", "That person is not in this space.");

    if (alvo.role === "OWNER") {
      return falha(
        reply,
        403,
        "spaces.owner_stays",
        "The owner cannot be removed from the space."
      );
    }
    if (nivel[eu.role] <= nivel[alvo.role]) {
      return falha(
        reply,
        403,
        "spaces.rank_too_low",
        "You cannot act on someone at your own level or above."
      );
    }
    if (eu.role === "MEMBER") {
      return falha(reply, 403, "spaces.staff_only", "Only space admins can manage members.");
    }

    const rooms = await prisma.room.findMany({ where: { spaceId: id }, select: { id: true } });
    const roomIds = rooms.map((r) => r.id);

    await prisma.$transaction([
      prisma.spaceMember.delete({ where: { spaceId_userId: { spaceId: id, userId } } }),
      prisma.roomMember.deleteMany({ where: { roomId: { in: roomIds }, userId } })
    ]);

    // A linha do banco some, mas a aba aberta continua inscrita nos canais e
    // recebendo mensagem até alguém recarregar a página.
    await Promise.all(roomIds.map((roomId) => leaveUserSockets(userId, roomId)));

    /*
     * `space:left` é o mesmo evento de quando a pessoa sai por vontade própria.
     * O cliente já sabe o que fazer com ele — tirar o espaço da barra lateral —
     * e um nome novo só para "foi expulso" exigiria que todo cliente instalado
     * aprendesse a palavra antes de a rota poder ser usada.
     */
    emitToUsers([userId], "space:left", { spaceId: id });
    await avisarMembros(id);
    return reply.code(204).send();
  });

  /**
   * Trocar o código do convite.
   *
   * O código antigo para de valer na hora, porque ele É o único campo: o
   * `inviteCode` do espaço é sobrescrito, e `POST /spaces/join/:code` não tem
   * onde encontrar o valor anterior. É isso que faz esta rota servir para o que
   * ela existe — cortar um link que vazou.
   */
  app.post("/spaces/:id/invite/regenerate", async (request, reply) => {
    const { id } = request.params as { id: string };

    const eu = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId: request.userId } }
    });
    if (!eu) return falha(reply, 404, "spaces.not_member", "You are not in that space.");
    if (eu.role === "MEMBER") {
      return falha(reply, 403, "spaces.staff_only", "Only space admins can manage members.");
    }

    /*
     * `inviteCode` é único no banco. Cinco bytes colidem com probabilidade
     * desprezível, mas "desprezível" vira um 500 na cara de alguém no dia em
     * que acontecer; tentar de novo custa uma consulta.
     */
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const codigo = inviteCode();
      const usado = await prisma.space.findUnique({
        where: { inviteCode: codigo },
        select: { id: true }
      });
      if (usado) continue;
      const space = await prisma.space.update({
        where: { id },
        data: { inviteCode: codigo },
        select: { inviteCode: true }
      });
      await avisarMembros(id);
      return { inviteCode: space.inviteCode };
    }
    return falha(reply, 500, "server.broke", "Something broke on our side. Try again.");
  });
}

/**
 * Cutuca todo mundo do espaço para recarregar a lista.
 *
 * Vai o id do espaço, não o que mudou: a lista de membros é curta e o cliente
 * já sabe buscá-la. Mandar o diff obrigaria a acertar cada mudança de papel na
 * ponta, e um evento perdido deixaria a tela mentindo sobre quem manda ali.
 */
async function avisarMembros(spaceId: string) {
  const membros = await prisma.spaceMember.findMany({
    where: { spaceId },
    select: { userId: true }
  });
  emitToUsers(
    membros.map((m) => m.userId),
    "space:members",
    { spaceId }
  );
}
