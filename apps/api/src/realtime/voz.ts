import { prisma } from "../lib/prisma.js";
import { vozUserSelect } from "../lib/shapes.js";
import { usuariosNaVoz } from "../lib/presencaDeVoz.js";
import { chaveDeEspectadores } from "../lib/transmissao.js";
import { emitToRoom } from "./bus.js";

/**
 * Avisa a sala de quem está na voz agora.
 *
 * Vai a lista INTEIRA, e não "fulano entrou". Um evento incremental obriga o
 * cliente a manter um estado que ele não tem como consertar quando perde um
 * evento — e é assim que a lista fica com gente que já saiu. Mandar o conjunto
 * completo faz cada evento ser autossuficiente: chegou, a tela está certa.
 */
export async function anunciarPresencaDeVoz(roomId: string) {
  emitToRoom(roomId, "voice:presence", { roomId, users: await usuariosDaSala(roomId) });
}

/** Quem está na voz, já com nome e foto — a tela precisa dos dois. */
export async function usuariosDaSala(roomId: string) {
  const ids = await usuariosNaVoz(roomId);
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: vozUserSelect });
  // A ordem do banco não tem significado; o nome dá uma lista estável.
  return users.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Avisa quem está numa transmissão de quantos são.
 *
 * Vai só o NÚMERO, e não a lista de nomes como na voz. Numa chamada saber quem
 * está lá é o ponto; numa transmissão, publicar a lista de quem assiste seria
 * entregar a audiência inteira para qualquer pessoa que entrasse — e num
 * servidor pequeno, com gente que se conhece, isso é mais do que ninguém pediu.
 */
export async function anunciarEspectadores(streamId: string, roomId: string) {
  const quantos = (await usuariosNaVoz(chaveDeEspectadores(streamId))).length;
  emitToRoom(roomId, "stream:viewers", { streamId, roomId, assistindo: quantos });
}
