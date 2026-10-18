import { RoomServiceClient } from "livekit-server-sdk";
import { env, callsEnabled } from "../env.js";
import { deveExpulsar, entradaEmMs } from "./expulsao.js";
import { salaDaTransmissao } from "./transmissao.js";
import { salaDaReuniao } from "./reuniao.js";

/**
 * Falar com o LiveKit como servidor, e não como mais um participante.
 *
 * Existe por um motivo só: TIRAR de verdade quem saiu. Ver `expulsao.ts` para o
 * defeito que isto conserta e para a medição que o mostrou.
 *
 * O cliente é montado uma vez. `LIVEKIT_URL` é `wss://`, e o SDK troca sozinho
 * para `https://` — conferido: `new RoomServiceClient("wss://…")` guarda
 * `host: "https://…"`.
 */
let cliente: RoomServiceClient | null = null;

function servico(): RoomServiceClient | null {
  if (!callsEnabled) return null;
  if (!cliente) {
    cliente = new RoomServiceClient(env.LIVEKIT_URL!, env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!);
  }
  return cliente;
}

/** O nome da sala no LiveKit. Mesmo formato que o token concede. */
export const salaDoLiveKit = (roomId: string) => `room_${roomId}`;

/**
 * Tira a pessoa da chamada, se ela ainda estiver lá.
 *
 * NUNCA lança. É chamada de dentro de manipuladores de socket, e o LiveKit pode
 * estar fora do ar, reiniciando, ou simplesmente não ter essa sala — nada disso
 * pode derrubar a saída da pessoa da nossa própria lista de presença, que é o
 * que a tela lê.
 *
 * `pedidoEmMs` é o instante em que a saída chegou até nós, e serve para não
 * expulsar quem já voltou. Ver `deveExpulsar`.
 */
export async function expulsarDaChamada(
  roomId: string,
  userId: string,
  pedidoEmMs: number
): Promise<"expulso" | "nao-estava" | "voltou" | "indisponivel"> {
  const svc = servico();
  if (!svc) return "indisponivel";
  const sala = salaDoLiveKit(roomId);

  try {
    /*
     * Perguntar antes de expulsar não é zelo excessivo: é o que separa "esta
     * pessoa ficou presa lá dentro" de "esta pessoa já voltou para a chamada".
     * Sem a consulta, `RemoveParticipant` derrubaria a segunda.
     */
    const p = await svc.getParticipant(sala, userId).catch(() => null);
    if (!p) return "nao-estava";
    if (!deveExpulsar(entradaEmMs(p.joinedAt), pedidoEmMs)) return "voltou";

    await svc.removeParticipant(sala, userId);
    return "expulso";
  } catch {
    return "indisponivel";
  }
}

/**
 * Derruba a sala de uma transmissão inteira.
 *
 * Chamada quando o dono sai do ar ou apaga a transmissão. Sem ela, quem estava
 * assistindo continuaria conectado a uma sala que a nossa lista já não mostra —
 * o mesmo fantasma que custou caro nas chamadas, só que ao contrário: lá sobrava
 * quem tinha saído, aqui sobraria a plateia de um palco vazio.
 *
 * `deleteRoom` derruba todos de uma vez, e não precisa da ressalva de
 * `expulsarDaChamada` sobre quem já voltou: aqui não há sessão nova a proteger,
 * porque a transmissão acabou para todo mundo ao mesmo tempo.
 *
 * NUNCA lança, pelo mesmo motivo da irmã: é chamada de dentro de uma rota que
 * precisa terminar de marcar o fim no banco mesmo com o LiveKit fora do ar.
 */
export async function encerrarTransmissao(streamId: string): Promise<boolean> {
  const svc = servico();
  if (!svc) return false;
  try {
    await svc.deleteRoom(salaDaTransmissao(streamId));
    return true;
  } catch {
    // Sala que não existe é o caso comum: ninguém chegou a entrar no ar.
    return false;
  }
}

/* ---------------------------------------------------------------- reuniões */

/**
 * Quantas pessoas estão numa reunião agora, segundo o próprio LiveKit.
 *
 * Aqui a contagem vem do LiveKit e não da nossa presença, ao contrário das
 * transmissões: convidados sem conta não têm socket conosco — o LiveKit é o
 * único lugar que sabe que eles estão lá. Sala que não existe é zero.
 */
export async function pessoasNaReuniao(meetingId: string): Promise<number> {
  const svc = servico();
  if (!svc) return 0;
  try {
    return (await svc.listParticipants(salaDaReuniao(meetingId))).length;
  } catch {
    return 0;
  }
}

/**
 * Cria a sala com o teto de gente JÁ dentro dela.
 *
 * Sem isto a sala nasceria sozinha, na primeira entrada, sem limite nenhum — e
 * o nosso teto valeria só para quem passa pela API, não para um token pego no
 * meio do caminho. Chamar de novo numa sala existente não muda nada, então é
 * seguro chamar a cada entrada.
 */
export async function prepararReuniao(meetingId: string, teto: number): Promise<void> {
  const svc = servico();
  if (!svc) return;
  try {
    await svc.createRoom({
      name: salaDaReuniao(meetingId),
      maxParticipants: teto,
      // Cinco minutos vazia e a sala some. A REUNIÃO continua valendo pelo
      // link; a sala renasce na próxima entrada.
      emptyTimeout: 300
    });
  } catch {
    /* LiveKit fora do ar: a entrada falha mais adiante, com mensagem clara. */
  }
}

/** Tira uma pessoa da reunião. Só o anfitrião chega aqui. Nunca lança. */
export async function removerDaReuniao(meetingId: string, identidade: string): Promise<boolean> {
  const svc = servico();
  if (!svc) return false;
  try {
    await svc.removeParticipant(salaDaReuniao(meetingId), identidade);
    return true;
  } catch {
    return false;
  }
}

/** Encerra para todos: derruba a sala inteira. Nunca lança. */
export async function encerrarReuniao(meetingId: string): Promise<boolean> {
  const svc = servico();
  if (!svc) return false;
  try {
    await svc.deleteRoom(salaDaReuniao(meetingId));
    return true;
  } catch {
    return false;
  }
}
