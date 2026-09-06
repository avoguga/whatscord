import { redis } from "./redis.js";

/**
 * Quem está dentro de cada sala de voz AGORA.
 *
 * Antes isso vivia só na memória do cliente: um F5 apagava a lista, e quem
 * entrasse na conversa depois via a sala vazia mesmo com gente falando dentro.
 * A fonte de verdade passa a ser o servidor.
 *
 * COMO A CHAVE É MONTADA. Um ZSET por sala, onde cada membro é
 * `userId:socketId` e o score é o instante em que aquela conexão expira. Um
 * SET simples com TTL na chave inteira não serviria: o TTL seria do conjunto,
 * e a conexão de quem caiu ficaria viva enquanto qualquer outra pessoa
 * renovasse a sala. Com o vencimento no score, cada conexão expira sozinha.
 *
 * POR CONEXÃO, MAS CONTADO POR USUÁRIO. Quem abre o app em duas abas tem duas
 * conexões; só sai da lista quando a última delas sai. Por isso o `userId` faz
 * parte do membro do ZSET — dá para saber de quem é cada conexão sem uma
 * segunda leitura.
 *
 * O TTL É REDE DE SEGURANÇA, NÃO O MECANISMO. A saída normal é o `disconnect`
 * do socket ou o `call:leave`. O TTL só cobre o caso em que nenhum dos dois
 * chega — processo morto, cabo arrancado — para que ninguém fique preso na
 * lista para sempre.
 */
export const TTL_DE_VOZ_MS = 90_000;

/** De quanto em quanto tempo o servidor renova quem ainda está conectado. */
export const RENOVACAO_DE_VOZ_MS = 30_000;

const chaveDaSala = (roomId: string) => `whatscord:voz:sala:${roomId}`;
const chaveDaConexao = (socketId: string) => `whatscord:voz:conexao:${socketId}`;

const membroDe = (userId: string, socketId: string) => `${userId}:${socketId}`;
const donoDe = (membro: string) => membro.slice(0, membro.indexOf(":"));

/*
 * Sem Redis a API roda como instância única, e aí a memória do processo é uma
 * fonte de verdade tão boa quanto. O formato é o mesmo (vencimento por
 * conexão) para que os dois caminhos não divirjam em comportamento.
 */
const salasNaMemoria = new Map<string, Map<string, number>>();
const conexoesNaMemoria = new Map<string, Set<string>>();

function agora() {
  return Date.now();
}

/** Os membros ainda vivos de uma sala, já sem os vencidos. */
async function vivosDaSala(roomId: string): Promise<string[]> {
  if (!redis) {
    const sala = salasNaMemoria.get(roomId);
    if (!sala) return [];
    const limite = agora();
    for (const [membro, expira] of sala) if (expira <= limite) sala.delete(membro);
    if (sala.size === 0) salasNaMemoria.delete(roomId);
    return [...sala.keys()];
  }
  const chave = chaveDaSala(roomId);
  // A poda acontece na leitura: é o único momento em que alguém se importa.
  await redis.zremrangebyscore(chave, 0, agora());
  return redis.zrange(chave, 0, -1);
}

/** Ids de usuário na sala de voz, sem repetir quem está em duas abas. */
export async function usuariosNaVoz(roomId: string): Promise<string[]> {
  const membros = await vivosDaSala(roomId);
  return [...new Set(membros.map(donoDe))];
}

/** A mesma coisa para várias salas de uma vez. */
export async function presencaDeSalas(roomIds: string[]): Promise<Record<string, string[]>> {
  const saida: Record<string, string[]> = {};
  await Promise.all(
    roomIds.map(async (roomId) => {
      saida[roomId] = await usuariosNaVoz(roomId);
    })
  );
  return saida;
}

/**
 * Marca uma conexão como presente na sala.
 *
 * Devolve `true` quando isso mudou a lista de USUÁRIOS — a segunda aba da
 * mesma pessoa entrando não muda nada, e avisar a sala outra vez só faria a
 * tela piscar.
 */
export async function entrarNaVoz(
  roomId: string,
  userId: string,
  socketId: string
): Promise<boolean> {
  const antes = await usuariosNaVoz(roomId);
  const expira = agora() + TTL_DE_VOZ_MS;

  if (!redis) {
    const sala = salasNaMemoria.get(roomId) ?? new Map<string, number>();
    sala.set(membroDe(userId, socketId), expira);
    salasNaMemoria.set(roomId, sala);
    const conexao = conexoesNaMemoria.get(socketId) ?? new Set<string>();
    conexao.add(roomId);
    conexoesNaMemoria.set(socketId, conexao);
  } else {
    await redis.zadd(chaveDaSala(roomId), expira, membroDe(userId, socketId));
    /*
     * Vencimento na chave inteira, bem mais largo que o do membro: é só faxina,
     * para que uma sala de voz que ninguém mais usa não fique guardada para
     * sempre. Quem manda de verdade é o score.
     */
    await redis.pexpire(chaveDaSala(roomId), TTL_DE_VOZ_MS * 4);
    await redis.sadd(chaveDaConexao(socketId), roomId);
    await redis.pexpire(chaveDaConexao(socketId), TTL_DE_VOZ_MS * 4);
  }

  return !antes.includes(userId);
}

/**
 * Tira a pessoa da sala.
 *
 * `todasAsConexoes` existe para a saída DELIBERADA: quem clica em sair saiu, e
 * o LiveKit não deixaria a mesma identidade estar duas vezes na sala de
 * qualquer forma. Já a queda de uma conexão só derruba aquela conexão — as
 * outras abas continuam valendo.
 *
 * Devolve `true` quando a pessoa sumiu de vez da lista.
 */
export async function sairDaVoz(
  roomId: string,
  userId: string,
  socketId: string,
  todasAsConexoes = false
): Promise<boolean> {
  const membros = await vivosDaSala(roomId);
  const alvos = todasAsConexoes
    ? membros.filter((m) => donoDe(m) === userId)
    : [membroDe(userId, socketId)];
  if (alvos.length === 0) return false;

  if (!redis) {
    const sala = salasNaMemoria.get(roomId);
    if (sala) {
      for (const alvo of alvos) sala.delete(alvo);
      if (sala.size === 0) salasNaMemoria.delete(roomId);
    }
    conexoesNaMemoria.get(socketId)?.delete(roomId);
  } else {
    await redis.zrem(chaveDaSala(roomId), ...alvos);
    await redis.srem(chaveDaConexao(socketId), roomId);
  }

  const depois = await usuariosNaVoz(roomId);
  return membros.some((m) => donoDe(m) === userId) && !depois.includes(userId);
}

/** As salas de voz em que esta conexão está. */
export async function salasDaConexao(socketId: string): Promise<string[]> {
  if (!redis) return [...(conexoesNaMemoria.get(socketId) ?? [])];
  return redis.smembers(chaveDaConexao(socketId));
}

/**
 * Empurra o vencimento das salas desta conexão para frente.
 *
 * Quem bate o heartbeat é o SERVIDOR, olhando para os sockets que ele mesmo
 * ainda segura, e não o cliente. Depender de um `setInterval` do cliente seria
 * confiar a presença justamente a quem pode ter travado; e uma aba em segundo
 * plano tem o timer estrangulado pelo navegador, o que derrubaria da lista
 * quem está só ouvindo a chamada em outra janela.
 */
export async function renovarConexao(socketId: string) {
  const salas = await salasDaConexao(socketId);
  if (salas.length === 0) return;
  const expira = agora() + TTL_DE_VOZ_MS;

  for (const roomId of salas) {
    if (!redis) {
      const sala = salasNaMemoria.get(roomId);
      if (!sala) continue;
      for (const membro of sala.keys()) {
        if (membro.endsWith(`:${socketId}`)) sala.set(membro, expira);
      }
      continue;
    }
    const membros = await redis.zrange(chaveDaSala(roomId), 0, -1);
    const meus = membros.filter((m) => m.endsWith(`:${socketId}`));
    if (meus.length === 0) continue;
    await redis.zadd(chaveDaSala(roomId), ...meus.flatMap((m) => [expira, m] as const));
    await redis.pexpire(chaveDaSala(roomId), TTL_DE_VOZ_MS * 4);
  }

  if (redis) await redis.pexpire(chaveDaConexao(socketId), TTL_DE_VOZ_MS * 4);
}

/**
 * Esquece uma conexão inteira (o `disconnect` do socket).
 *
 * Devolve as salas em que a lista de usuários mudou — só essas precisam de
 * aviso. Sem isto, fechar a aba deixava a pessoa parada na lista até o TTL
 * vencer, que é justamente o defeito que se quer evitar.
 */
export async function esquecerConexao(socketId: string, userId: string): Promise<string[]> {
  const salas = await salasDaConexao(socketId);
  const mudaram: string[] = [];
  for (const roomId of salas) {
    if (await sairDaVoz(roomId, userId, socketId)) mudaram.push(roomId);
  }
  if (!redis) conexoesNaMemoria.delete(socketId);
  else await redis.del(chaveDaConexao(socketId));
  return mudaram;
}
