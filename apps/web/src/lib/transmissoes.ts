import { api } from "./api";

/**
 * Transmissões, do lado de quem usa.
 *
 * Só rede e tipos — nada de React e nada de Lingui, para este arquivo poder ser
 * lido por um teste em Node. A regra vale para todo `lib/` deste projeto, e já
 * foi quebrada antes: um macro de tradução aqui derruba a bateria inteira.
 */

export type Visibilidade = "PUBLIC" | "SPACE" | "LINK";

export type QuemTransmite = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

export type Transmissao = {
  id: string;
  title: string;
  visibility: Visibilidade;
  spaceId: string | null;
  /** A sala do bate-papo. É uma sala como outra qualquer — daí o chat pronto. */
  roomId: string;
  owner?: QuemTransmite;
  souDono: boolean;
  aoVivo: boolean;
  startedAt: string | null;
  assistindo: number;
  /** Só vem para o dono: numa transmissão por link, o código é a fechadura. */
  inviteCode: string | null;
};

/**
 * Como a mídia chega.
 *
 * Hoje só existe `webrtc` — cada pessoa recebe a própria cópia do vídeo. O campo
 * existe desde já porque é a costura por onde a escala entra: quando uma
 * transmissão passar do que o servidor aguenta copiar, a resposta passa a ser
 * `{ modo: "hls", url }` para quem chegar depois, e o tocador decide por aqui.
 * Sem este campo, trocar a entrega de mídia seria reescrever a tela.
 */
export type ComoAssistir =
  | { modo: "webrtc"; url: string; token: string; stream: Transmissao }
  | { modo: "hls"; url: string; stream: Transmissao };

export async function transmissoesAoVivo(): Promise<{ streams: Transmissao[]; teto: number }> {
  return api.get<{ streams: Transmissao[]; teto: number }>("/streams/live");
}

export async function minhasTransmissoes(): Promise<Transmissao[]> {
  const r = await api.get<{ streams: Transmissao[] }>("/streams/mine");
  return r.streams;
}

export async function criarTransmissao(dados: {
  title: string;
  visibility: Visibilidade;
  spaceId?: string | null;
}): Promise<Transmissao> {
  const r = await api.post<{ stream: Transmissao }>("/streams", {
    title: dados.title,
    visibility: dados.visibility,
    ...(dados.spaceId ? { spaceId: dados.spaceId } : {})
  });
  return r.stream;
}

export async function entrarNoAr(id: string): Promise<ComoAssistir> {
  return api.post<ComoAssistir>(`/streams/${encodeURIComponent(id)}/go-live`);
}

export async function sairDoAr(id: string): Promise<void> {
  await api.post(`/streams/${encodeURIComponent(id)}/stop`);
}

export async function assistir(id: string, codigo?: string | null): Promise<ComoAssistir> {
  return api.post<ComoAssistir>(
    `/streams/${encodeURIComponent(id)}/watch`,
    codigo ? { codigo } : {}
  );
}

export async function apagarTransmissao(id: string): Promise<void> {
  await api.del(`/streams/${encodeURIComponent(id)}`);
}

export async function transmissaoPeloCodigo(codigo: string): Promise<Transmissao> {
  const r = await api.get<{ stream: Transmissao }>(
    `/streams/code/${encodeURIComponent(codigo)}`
  );
  return r.stream;
}

/* ------------------------------------------------------------------ links */

/**
 * O endereço de uma transmissão.
 *
 * `?live=` e não `?join=`, que é o de espaço. São portas diferentes e precisam
 * ser distinguíveis: o mesmo código levaria a pessoa para o lugar errado, e o
 * erro apareceria como "convite inválido" sem dizer por quê.
 */
export const PARAM_DA_TRANSMISSAO = "live";

export function linkDaTransmissao(codigo: string, origem: string): string {
  return `${origem.replace(/\/+$/, "")}/?${PARAM_DA_TRANSMISSAO}=${encodeURIComponent(codigo)}`;
}

/**
 * O código de transmissão que está na URL, se houver.
 *
 * Mesma validação do convite de espaço — hexadecimal, 6 a 64 — porque a origem é
 * a mesma: um endereço escrito por qualquer pessoa, que vai virar segmento de
 * uma chamada de API.
 */
const CODIGO = /^[a-fA-F0-9]{6,64}$/;

export function codigoDaTransmissaoEm(
  busca: string
): string | null {
  try {
    const params = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca);
    const bruto = (params.get(PARAM_DA_TRANSMISSAO) ?? "").trim().toLowerCase();
    return CODIGO.test(bruto) ? bruto : null;
  } catch {
    return null;
  }
}
