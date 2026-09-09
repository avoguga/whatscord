import { toDataUrl, type ToneStep } from "./sounds";

/**
 * A bandeja de sons da chamada.
 *
 * O que ela é: apertar um botão e TODO MUNDO na chamada ouvir. É o soundboard
 * do Discord, e a graça está inteira no "todo mundo" — um efeito que só quem
 * apertou escuta não é uma piada, é um bug.
 *
 * Como o som viaja: NÃO como áudio. Vai um recado de alguns bytes pelo canal de
 * dados da chamada — "toquem o som 3" — e cada aparelho sintetiza o mesmo som
 * localmente. Publicar uma faixa de áudio para um efeito de meio segundo
 * custaria uma renegociação e chegaria depois da piada; o recado chega no tempo
 * de um ping, e a forma de onda é idêntica em todo mundo porque é gerada pela
 * mesma função com a mesma semente.
 */

export type SomId =
  | "tada"
  | "buzina"
  | "erro"
  | "tambor"
  | "sino"
  | "boing"
  | "sussurro"
  | "fanfarra";

/**
 * Um som da bandeja: o que ele É, não como ele se chama.
 *
 * O NOME fica no componente, e essa divisão não é arrumação — é o que mantém
 * este arquivo carregável fora do navegador. Os nomes passam pelo macro do
 * Lingui, que só existe durante o build: um `import` dele em Node explode antes
 * da primeira linha rodar, e levaria junto a capacidade de testar o empacotamento
 * do recado e a ordenação da bandeja, que é justamente a parte que pode quebrar
 * calada entre duas versões do app.
 */
export type Som = {
  id: SomId;
  /** Um caractere para o botão: a bandeja tem de ser lida de relance. */
  face: string;
  passos: ToneStep[];
};

export const SONS: Som[] = [
  {
    id: "tada",
    face: "🎉",
    passos: [
      { freq: 523.25, ms: 90 },
      { freq: 659.25, ms: 90 },
      { freq: 1046.5, ms: 260, ganho: 0.26 }
    ]
  },
  {
    id: "buzina",
    face: "📣",
    passos: [
      { freq: 233.08, ms: 120, onda: "quadrada", ganho: 0.2 },
      { freq: 246.94, ms: 380, onda: "quadrada", ganho: 0.22 }
    ]
  },
  {
    id: "erro",
    face: "❌",
    passos: [
      { freq: 196.0, ms: 180, onda: "serra", ganho: 0.24 },
      { freq: 155.56, ms: 320, onda: "serra", ganho: 0.24 }
    ]
  },
  {
    id: "tambor",
    face: "🥁",
    passos: [
      { freq: 200, ms: 40, onda: "ruido", ganho: 0.2 },
      { freq: 200, ms: 40, onda: "ruido", ganho: 0.16 },
      { freq: 120, ms: 60, onda: "ruido", ganho: 0.24 },
      { freq: 90, ms: 260, onda: "quadrada", ganho: 0.14 }
    ]
  },
  {
    id: "sino",
    face: "🔔",
    passos: [
      { freq: 1567.98, ms: 70 },
      { freq: 2093.0, ms: 320, ganho: 0.16 }
    ]
  },
  {
    id: "boing",
    face: "🤸",
    passos: [
      { freq: 880, ms: 60, onda: "serra", ganho: 0.2 },
      { freq: 440, ms: 70, onda: "serra", ganho: 0.2 },
      { freq: 660, ms: 60, onda: "serra", ganho: 0.18 },
      { freq: 330, ms: 200, onda: "serra", ganho: 0.16 }
    ]
  },
  {
    id: "sussurro",
    face: "🦗",
    passos: [
      { freq: 4000, ms: 45, onda: "ruido", ganho: 0.1 },
      { freq: 1, ms: 120, ganho: 0 },
      { freq: 4000, ms: 45, onda: "ruido", ganho: 0.1 },
      { freq: 1, ms: 120, ganho: 0 },
      { freq: 4000, ms: 45, onda: "ruido", ganho: 0.1 }
    ]
  },
  {
    id: "fanfarra",
    face: "🎺",
    passos: [
      { freq: 392.0, ms: 90, onda: "quadrada", ganho: 0.16 },
      { freq: 523.25, ms: 90, onda: "quadrada", ganho: 0.16 },
      { freq: 659.25, ms: 90, onda: "quadrada", ganho: 0.16 },
      { freq: 783.99, ms: 300, onda: "quadrada", ganho: 0.18 }
    ]
  }
];

export function ehSomId(v: unknown): v is SomId {
  return typeof v === "string" && SONS.some((s) => s.id === v);
}

/**
 * Quanto tempo esperar entre um som e outro, em milissegundos.
 *
 * Sem isto a bandeja vira uma arma: alguém segura o botão e ninguém mais
 * consegue conversar. O Discord limita pelo mesmo motivo. Dois segundos é curto
 * o bastante para não atrapalhar quem está brincando e longo o bastante para
 * não dar para metralhar.
 */
export const ESPERA_MS = 2000;

/** Um jeito de tocar: cada som vira um `<audio>` reaproveitado. */
const tocadores = new Map<SomId, HTMLAudioElement>();

function tocadorDe(id: SomId): HTMLAudioElement | null {
  const som = SONS.find((s) => s.id === id);
  if (!som) return null;
  let el = tocadores.get(id);
  if (!el) {
    el = new Audio(toDataUrl(som.passos));
    el.preload = "auto";
    tocadores.set(id, el);
  }
  return el;
}

/**
 * Toca um som da bandeja na saída escolhida.
 *
 * Não passa pelo controle de "avisos sonoros da chamada": aquele decide se você
 * quer ouvir quem entrou e saiu, e isto aqui é alguém falando com você de
 * propósito. Silenciar os dois no mesmo interruptor faria a pessoa perder o
 * recado tentando se livrar do aviso.
 */
export async function tocarSom(id: SomId, sinkId?: string): Promise<void> {
  try {
    const el = tocadorDe(id);
    if (!el) return;
    const comSaida = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (sinkId && comSaida.setSinkId) {
      await comSaida.setSinkId(sinkId).catch(() => undefined);
    }
    el.currentTime = 0;
    await el.play();
  } catch {
    // A política de autoplay pode recusar antes da primeira interação, e um
    // efeito sonoro nunca vale mostrar erro.
  }
}

/* ------------------------------------------------------------------ recado */

/** O que viaja pelo canal de dados. */
export type RecadoDeSom = { tipo: "som"; id: SomId; de?: string };

/*
 * Sem anotar o retorno de proposito. `TextEncoder.encode` devolve um
 * `Uint8Array<ArrayBuffer>`, e escrever so `Uint8Array` alarga isso para
 * `ArrayBufferLike` — que inclui `SharedArrayBuffer` e nao serve para o
 * `publishData` do LiveKit. Deixar inferir mantem o tipo estreito sem prender o
 * arquivo a sintaxe generica de uma versao especifica do TypeScript.
 */
export function empacotarSom(id: SomId) {
  return new TextEncoder().encode(JSON.stringify({ tipo: "som", id } satisfies RecadoDeSom));
}

/**
 * Lê um recado do canal de dados, se for um som que conhecemos.
 *
 * Devolve `null` para qualquer outra coisa, e isso é deliberado: o canal é
 * compartilhado e um dia vai carregar outros recados. Um som que não existe
 * nesta versão também cai aqui — alguém com o app mais novo apertando um botão
 * que ainda não temos não pode derrubar a chamada de quem está atrás.
 */
export function lerRecadoDeSom(bytes: Uint8Array): SomId | null {
  try {
    const cru = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (
      cru &&
      typeof cru === "object" &&
      (cru as RecadoDeSom).tipo === "som" &&
      ehSomId((cru as RecadoDeSom).id)
    ) {
      return (cru as RecadoDeSom).id;
    }
  } catch {
    /* não era JSON nosso */
  }
  return null;
}

/* -------------------------------------------------- favoritos, por conversa */

const PREFIXO = "whatscord.somsFavoritos.";

/**
 * Os sons que aparecem primeiro nesta conversa.
 *
 * É a parte "por grupo": o time de trabalho e o grupo dos amigos não usam os
 * mesmos efeitos, e obrigar a caçar o mesmo som no meio de oito toda vez é o
 * tipo de atrito que faz a funcionalidade morrer. Fica guardado por sala e por
 * aparelho — é uma preferência de quem usa, não uma regra do grupo.
 */
export function favoritosDaSala(roomId: string): SomId[] {
  try {
    const cru = localStorage.getItem(PREFIXO + roomId);
    if (!cru) return [];
    const lista = JSON.parse(cru) as unknown;
    return Array.isArray(lista) ? lista.filter(ehSomId) : [];
  } catch {
    return [];
  }
}

export function salvarFavoritosDaSala(roomId: string, ids: SomId[]): void {
  try {
    localStorage.setItem(PREFIXO + roomId, JSON.stringify(ids));
  } catch {
    /* a escolha só não sobrevive à aba */
  }
}

/** A bandeja na ordem em que deve aparecer: favoritos na frente. */
export function ordenarBandeja(roomId: string): Som[] {
  const favoritos = favoritosDaSala(roomId);
  if (favoritos.length === 0) return SONS;
  const peso = (id: SomId) => {
    const i = favoritos.indexOf(id);
    return i === -1 ? favoritos.length : i;
  };
  return [...SONS].sort((a, b) => peso(a.id) - peso(b.id));
}
