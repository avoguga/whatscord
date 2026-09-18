/**
 * Decidir se vale expulsar alguém da sala do LiveKit.
 *
 * O problema que isto resolve: quem sai da chamada pode continuar DENTRO do
 * LiveKit. O aviso de saída é mandado pelo navegador de quem saiu, e um
 * navegador que foi congelado — aba em segundo plano, janela minimizada —
 * enfileira esse aviso e nunca o entrega. O soquete dele segue aberto, então
 * nem o tempo limite do LiveKit derruba a pessoa. Medido: quatro minutos depois
 * de a tela fechar, `ListParticipants` ainda devolvia a pessoa como ACTIVE,
 * publicando áudio, enquanto a nossa lista de presença já dizia que a sala
 * estava vazia.
 *
 * A saída é o servidor expulsar, que é a única ponta que sempre sabe que a
 * pessoa saiu. Só que `RemoveParticipant` do LiveKit mira a IDENTIDADE, e não
 * aquela sessão: uma expulsão atrasada derrubaria a pessoa que já voltou. Daí
 * esta função — a decisão inteira num lugar só, sem rede, para poder ser testada.
 */

/**
 * O `joinedAt` do LiveKit vem em SEGUNDOS, então a entrada é arredondada para
 * baixo. Sem esta folga, uma sessão que começou meio segundo depois do pedido
 * pareceria mais velha do que ele e levaria a expulsão no lugar da antiga.
 */
export const FOLGA_DE_ENTRADA_MS = 1_000;

/**
 * `entrouEmMs` é quando a sessão que está lá AGORA entrou (nulo quando não há
 * ninguém com essa identidade), e `pedidoEmMs` é quando recebemos a saída.
 *
 * Na dúvida, NÃO expulsa. Deixar um fantasma é chato; derrubar quem acabou de
 * voltar para a chamada é pior, e acontece justamente com quem sai e entra de
 * novo depressa — que é o caso mais comum de todos.
 */
export function deveExpulsar(entrouEmMs: number | null, pedidoEmMs: number): boolean {
  if (entrouEmMs === null) return false;
  if (!Number.isFinite(entrouEmMs) || !Number.isFinite(pedidoEmMs)) return false;
  return entrouEmMs + FOLGA_DE_ENTRADA_MS <= pedidoEmMs;
}

/** O `joinedAt` do LiveKit (segundos, e `bigint` no SDK) em milissegundos. */
export function entradaEmMs(joinedAt: bigint | number | null | undefined): number | null {
  if (joinedAt === null || joinedAt === undefined) return null;
  const segundos = typeof joinedAt === "bigint" ? Number(joinedAt) : joinedAt;
  if (!Number.isFinite(segundos) || segundos <= 0) return null;
  return segundos * 1000;
}
