import { api, fileUrl } from "./api";
import { ehEnderecoNosso } from "./soundboard";

/**
 * Os sons que não vêm embutidos: os de cada pessoa e os de cada espaço.
 *
 * Os oito embutidos continuam onde estavam, em `soundboard.ts`, e continuam
 * sendo sintetizados na hora. Estes aqui são arquivos de verdade, que alguém
 * subiu — e a diferença que importa é que eles precisam TRAFEGAR: quem recebe o
 * recado "toquem o som X" pode nunca ter ouvido esse som antes.
 */

export type EscopoDoSom = "usuario" | "espaco";

export type SomDaNuvem = {
  id: string;
  name: string;
  emoji: string;
  escopo: EscopoDoSom;
  spaceId: string | null;
  /** Sempre relativo, sempre `/files/<chave>`. Ver `ehEndereçoNosso`. */
  url: string;
  bytes: number;
  createdById: string;
};

export type Bandeja = {
  meus: SomDaNuvem[];
  doEspaco: SomDaNuvem[];
  limites: { porPessoa: number; porEspaco: number; bytes: number };
};

export const BANDEJA_VAZIA: Bandeja = {
  meus: [],
  doEspaco: [],
  limites: { porPessoa: 12, porEspaco: 30, bytes: 512 * 1024 }
};

export async function carregarBandeja(spaceId?: string | null): Promise<Bandeja> {
  const q = spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : "";
  return api.get<Bandeja>(`/sounds${q}`);
}

export async function subirSom(opcoes: {
  arquivo: File;
  nome: string;
  emoji: string;
  spaceId?: string | null;
}): Promise<SomDaNuvem> {
  const form = new FormData();
  form.append("name", opcoes.nome);
  form.append("emoji", opcoes.emoji);
  /*
   * `spaceId` presente quer dizer "este som é do espaço"; ausente quer dizer
   * "é meu". Um campo de escopo separado seria uma segunda fonte de verdade
   * para a mesma coisa, e as duas acabariam discordando.
   */
  if (opcoes.spaceId) form.append("spaceId", opcoes.spaceId);
  // O arquivo por último: o servidor lê os campos que vieram ANTES dele, e um
  // multipart é lido em ordem.
  form.append("file", opcoes.arquivo);

  const r = await api.post<{ som: SomDaNuvem }>("/sounds", form);
  return r.som;
}

export async function apagarSom(id: string): Promise<void> {
  await api.del<{ ok: true }>(`/sounds/${encodeURIComponent(id)}`);
}

/* ------------------------------------------------------------------ tocar */

/** Um `<audio>` por endereço, reaproveitado: o arquivo é baixado uma vez só. */
const tocadores = new Map<string, HTMLAudioElement>();

export async function tocarEndereco(url: string, sinkId?: string): Promise<void> {
  if (!ehEnderecoNosso(url)) return;
  try {
    let el = tocadores.get(url);
    if (!el) {
      el = new Audio(fileUrl(url));
      el.preload = "auto";
      tocadores.set(url, el);
    }
    const comSaida = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (sinkId && comSaida.setSinkId) await comSaida.setSinkId(sinkId).catch(() => undefined);
    el.currentTime = 0;
    await el.play();
  } catch {
    /*
     * Um efeito sonoro nunca vale mostrar erro. A política de autoplay pode
     * recusar, a rede pode falhar, e nos dois casos o certo é o silêncio — quem
     * apertou continua conversando.
     */
  }
}

/**
 * Deixa o arquivo pronto antes de alguém precisar dele.
 *
 * Sem isto, o primeiro toque de cada som espera o download, e um som que chega
 * meio segundo atrasado chega depois da piada. Chamado quando a bandeja abre:
 * é quando se sabe quais sons estão prestes a ser usados, e é uma tela em que
 * ninguém está esperando nada.
 */
export function prepararSons(sons: SomDaNuvem[]): void {
  for (const som of sons) {
    if (!ehEnderecoNosso(som.url) || tocadores.has(som.url)) continue;
    const el = new Audio(fileUrl(som.url));
    el.preload = "auto";
    tocadores.set(som.url, el);
  }
}

/** Esquece um som apagado, para o `<audio>` dele não ficar pendurado. */
export function esquecerEndereco(url: string): void {
  tocadores.delete(url);
}
