/**
 * Reuniões por link: as decisões, sem rede e sem banco.
 *
 * Pura de propósito, como `transmissao.ts`: aqui estão o formato do link, o que
 * vale como nome de quem entra sem conta, e quem é convidado. O teste
 * (`tests/reuniao.test.ts`) confere tudo sem subir nada.
 */

/**
 * Quantas pessoas cabem numa reunião.
 *
 * Numa transmissão só uma pessoa publica; numa reunião TODAS publicam câmera e
 * microfone, e o servidor repassa cada vídeo para cada um dos outros. O LiveKit
 * roda com 1,5 vCPU num host dividido com ~105 contêineres — doze já é uma
 * reunião grande para isso. É configurável (`MEETING_MAX_PARTICIPANTS`) porque o
 * número certo sai de medir, não de chutar.
 */
export const TETO_DA_REUNIAO = 12;

/** Quanto tempo um link de reunião vale. */
export const VALIDADE_DA_REUNIAO_MS = 30 * 24 * 60 * 60 * 1000;

/** O nome da sala da reunião no LiveKit. Separado de `room_` e `stream_`. */
export const salaDaReuniao = (meetingId: string) => `meet_${meetingId}`;

/**
 * O código do link, no formato do Meet: três letras, quatro, três.
 *
 * Só letras minúsculas, de propósito: é algo que alguém lê em voz alta numa
 * ligação ou digita no celular, e "0" contra "o" ou "l" contra "1" vira erro de
 * quem digita. Dez letras são ~47 bits — com o teto de tentativas por endereço,
 * adivinhar um link existente não é um caminho.
 *
 * `sortear` vem de fora (o servidor usa `crypto.randomInt`) para o teste poder
 * passar um sorteio previsível.
 */
const LETRAS = "abcdefghijklmnopqrstuvwxyz";
export function gerarCodigo(sortear: (max: number) => number): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += LETRAS[sortear(LETRAS.length)];
  return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
}

const CODIGO = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
export function ehCodigoDeReuniao(valor: unknown): valor is string {
  return typeof valor === "string" && CODIGO.test(valor);
}

/**
 * O nome de quem entra sem conta, limpo.
 *
 * Vem de qualquer pessoa da internet e aparece na tela de todo mundo da
 * reunião, então: sem caracteres de controle (que bagunçam a tela ou escondem
 * texto), espaços colapsados, e no máximo 40 caracteres contados como letras de
 * verdade — `slice` comum partiria um emoji no meio. Vazio depois de limpo não
 * é nome.
 */
export const NOME_MAXIMO = 40;
export function nomeDeConvidado(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const limpo = bruto
    // Primeiro, todo tipo de espaço vira um espaço — quebra de linha inclusive,
    // que É caractere de controle: apagada antes, "Ana↵Bia" virava "AnaBia".
    .replace(/\s+/g, " ")
    // Depois sai o que sobrou de invisível: controle e formatação.
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
  if (!limpo) return null;
  return [...limpo].slice(0, NOME_MAXIMO).join("").trim();
}

/**
 * A identidade de um convidado no LiveKit.
 *
 * Prefixo `g_` e nada parecido com o `id` de uma conta (que é um cuid,
 * começando por `c`). É por esse prefixo que a tela põe a etiqueta
 * "convidado" — o que impede alguém sem conta de entrar como "Gustavo
 * Henrique" e passar pelo Gustavo Henrique de verdade.
 */
export const identidadeDeConvidado = (aleatorio: string) => `g_${aleatorio}`;
export const ehConvidado = (identidade: string) => identidade.startsWith("g_");

/** A reunião ainda aceita gente? Nem encerrada, nem vencida. */
export function reuniaoAtiva(
  m: { endedAt: Date | null; expiresAt: Date },
  agora: Date
): boolean {
  if (m.endedAt) return false;
  return m.expiresAt.getTime() > agora.getTime();
}

/** Cabe mais um? O anfitrião entra sempre — sem ele a reunião não tem dono. */
export function cabeNaReuniao(dentro: number, teto: number, ehAnfitriao: boolean): boolean {
  if (ehAnfitriao) return true;
  if (!Number.isFinite(teto) || teto <= 0) return false;
  return dentro < teto;
}

/**
 * Um teto de tentativas por chave (endereço de rede, conta) numa janela.
 *
 * Na memória do processo. Um limite que zera quando a API reinicia é pior, mas
 * não é um buraco: o que ele segura é alguém martelando a rota pública em
 * sequência, e isso não sobrevive a um reinício de qualquer forma.
 */
export function criarLimite(maximo: number, janelaMs: number) {
  const tentativas = new Map<string, number[]>();
  return function pode(chave: string, agora = Date.now()): boolean {
    const desde = agora - janelaMs;
    const recentes = (tentativas.get(chave) ?? []).filter((t) => t > desde);
    if (recentes.length >= maximo) {
      tentativas.set(chave, recentes);
      return false;
    }
    recentes.push(agora);
    tentativas.set(chave, recentes);
    if (tentativas.size > 5000) {
      for (const [k, ts] of tentativas) if (!ts.some((t) => t > desde)) tentativas.delete(k);
    }
    return true;
  };
}
