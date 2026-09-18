/**
 * Quem pode assistir a uma transmissão, e quantos cabem.
 *
 * Pura de propósito, como `expulsao.ts`: é a decisão mais delicada do recurso —
 * ela separa uma transmissão privada de um vazamento — e uma decisão dessas não
 * pode depender de banco, de rede ou de ordem de chamada para ser conferida. O
 * teste (`tests/transmissao.test.ts`) não sobe nada.
 *
 * A regra em uma frase: PÚBLICA é para quem tem conta, DE ESPAÇO é para quem já
 * está no espaço, e POR LINK é para quem tem o código. O dono entra sempre.
 */

export type Visibilidade = "PUBLIC" | "SPACE" | "LINK";

export type Transmissao = {
  ownerId: string;
  visibility: Visibilidade;
  /** Presente quando `visibility` é SPACE — o banco garante isso por CHECK. */
  spaceId: string | null;
  inviteCode: string;
};

export type QuemPergunta = {
  userId: string;
  /** Já resolvido por quem chama: é uma consulta ao banco, não uma decisão. */
  ehMembroDoEspaco: boolean;
  /** O código que a pessoa apresentou, se apresentou algum. */
  codigo?: string | null;
};

/**
 * O teto de espectadores por transmissão.
 *
 * Não é preferência de produto: é a conta de banda. Cada espectador recebe uma
 * cópia do vídeo, então a saída do servidor é `espectadores × bitrate`. A 1,8
 * Mbps (720p30, o padrão de transmissão), quinze pessoas já são 27 Mbps saindo
 * de um contêiner com 1,5 vCPU num host dividido com ~105 outros.
 *
 * Por isso o número é baixo e é CONFIGURÁVEL: subir sem medir é como prometer
 * uma festa sem saber o tamanho da sala. O caminho para centenas não é aumentar
 * este número — é parar de mandar uma cópia para cada um (HLS atrás de CDN).
 */
export const TETO_DE_ESPECTADORES = 15;

/** O nome da sala da transmissão no LiveKit. Separado do `room_` das chamadas. */
export const salaDaTransmissao = (streamId: string) => `stream_${streamId}`;

/**
 * A chave sob a qual se conta quem está assistindo.
 *
 * Reaproveita a presença de voz — a mesma máquina de vencimento por conexão,
 * renovação pelo servidor e sobrevivência ao F5, que já custou caro para ficar
 * certa. O prefixo é o que mantém os dois mundos separados dentro dela: sem ele,
 * uma transmissão e uma sala de voz com o mesmo id disputariam a mesma chave, e
 * a saída de uma limparia a outra.
 *
 * É também o que deixa o `disconnect` do socket distinguir os dois casos sem ir
 * ao banco perguntar de quem é a sala.
 */
export const PREFIXO_DE_ESPECTADORES = "stream:";
export const chaveDeEspectadores = (streamId: string) =>
  `${PREFIXO_DE_ESPECTADORES}${streamId}`;
export const ehChaveDeEspectadores = (chave: string) =>
  chave.startsWith(PREFIXO_DE_ESPECTADORES);

/**
 * Pode assistir?
 *
 * O dono vem primeiro, e não é atalho: sem isso, o dono de uma transmissão por
 * link precisaria do próprio código para entrar na própria transmissão.
 */
export function podeAssistir(t: Transmissao, quem: QuemPergunta): boolean {
  if (!t || !quem?.userId) return false;
  if (t.ownerId === quem.userId) return true;

  switch (t.visibility) {
    case "PUBLIC":
      return true;
    case "SPACE":
      /*
       * `spaceId` nulo aqui só acontece se o CHECK do banco tiver sido burlado.
       * Nesse caso a resposta é NÃO: diante de um estado que não devia existir,
       * a saída segura é fechar a porta, não abri-la.
       */
      return t.spaceId !== null && quem.ehMembroDoEspaco;
    case "LINK":
      return comparaCodigo(t.inviteCode, quem.codigo);
    default:
      /*
       * Visibilidade desconhecida — uma versão mais nova do servidor escrevendo
       * num banco lido por uma mais velha, por exemplo. Fecha.
       */
      return false;
  }
}

/**
 * Compara dois códigos de convite.
 *
 * Comprimento igual e diferença acumulada, em vez de `===`, para o tempo da
 * resposta não contar quantos caracteres do início estavam certos. São só dez
 * caracteres hexadecimais e a rota tem rede na frente, então o ganho é pequeno
 * — mas isto é a fechadura de uma transmissão privada, e fechadura se escreve
 * assim por hábito, não por cálculo de risco.
 */
export function comparaCodigo(esperado: string, apresentado: string | null | undefined): boolean {
  if (typeof apresentado !== "string" || apresentado.length !== esperado.length) return false;
  let diferenca = 0;
  for (let i = 0; i < esperado.length; i++) {
    diferenca |= esperado.charCodeAt(i) ^ apresentado.charCodeAt(i);
  }
  return diferenca === 0;
}

/**
 * A transmissão aparece na tela de início de quem pergunta?
 *
 * Não é a mesma pergunta que `podeAssistir`, e confundir as duas é o erro que
 * vaza: quem tem o código PODE assistir a uma transmissão por link, mas ela
 * nunca deve aparecer numa vitrine — senão o código deixa de ser um segredo no
 * instante em que alguém abre a tela de início.
 */
export function apareceNoInicio(t: Transmissao, quem: QuemPergunta): boolean {
  if (t.visibility === "LINK") return t.ownerId === quem.userId;
  return podeAssistir(t, quem);
}

/** Está no ar? A resposta do banco; quem confirma de verdade é a presença. */
export function estaNoAr(t: { startedAt: Date | null; endedAt: Date | null }): boolean {
  return t.startedAt !== null && t.endedAt === null;
}

/**
 * Cabe mais um?
 *
 * O dono nunca é barrado pelo próprio teto — ele não é espectador, é a fonte, e
 * trancá-lo do lado de fora terminaria a transmissão de todo mundo.
 */
export function cabeMaisUm(
  assistindoAgora: number,
  teto: number,
  ehDono: boolean
): boolean {
  if (ehDono) return true;
  if (!Number.isFinite(teto) || teto <= 0) return false;
  return assistindoAgora < teto;
}
