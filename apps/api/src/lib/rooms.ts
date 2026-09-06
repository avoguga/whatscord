import { prisma } from "./prisma.js";
import type { CodigoDeFalha } from "./falha.js";

/** Two people can only ever have one DM, whichever of them opens it first. */
export function dmKeyFor(a: string, b: string) {
  return [a, b].sort().join(":");
}

export class HttpError extends Error {
  /*
   * O `code` acompanha a mensagem porque quem captura este erro so tem a
   * frase em maos, e a frase nao pode ser o identificador: mudar uma virgula
   * no texto derrubaria a traducao no cliente sem aviso.
   */
  constructor(
    public status: number,
    message: string,
    public code: CodigoDeFalha = "server.bad_request"
  ) {
    super(message);
  }
}

/** Throws unless the user belongs to the room. Every room route starts here. */
export async function requireMembership(roomId: string, userId: string) {
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    include: { room: true }
  });
  if (!membership) {
    throw new HttpError(
      404,
      "That conversation does not exist, or you are not in it.",
      "rooms.gone"
    );
  }
  return membership;
}

export async function memberIdsOf(roomId: string) {
  const rows = await prisma.roomMember.findMany({
    where: { roomId },
    select: { userId: true }
  });
  return rows.map((r) => r.userId);
}
