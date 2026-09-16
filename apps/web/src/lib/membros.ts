/**
 * Quem está aqui, agrupado do jeito que a mão procura.
 *
 * É a lista de membros do Discord, do lado direito de um espaço. O que ela
 * responde, nesta ordem: quem está NUMA CHAMADA agora (e em qual), quem está
 * online, e quem não está. Dentro de online, quem administra vem antes — não por
 * hierarquia, mas porque é a quem se procura quando algo precisa ser resolvido.
 *
 * Livre de imports de UI, de rede e de macro de tradução, de propósito: é isto
 * que permite testar a ordenação em Node. Os títulos dos grupos são chaves; o
 * componente traduz.
 */

export type PapelNoEspaco = "OWNER" | "ADMIN" | "MEMBER";

export type MembroCru = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role?: PapelNoEspaco;
};

export type Grupo = "chamada" | "administracao" | "online" | "offline";

/** Onde alguém está falando: a sala, para entrar junto, e o nome, para mostrar. */
export type CanalDeVoz = { salaId: string; nome: string };

export type MembroAgrupado = MembroCru & {
  online: boolean;
  /** O canal de voz em que a pessoa está, quando está. */
  canalDeVoz: CanalDeVoz | null;
  /** É a própria pessoa que está olhando. */
  souEu: boolean;
};

export type GrupoDeMembros = { grupo: Grupo; membros: MembroAgrupado[] };

/** A ordem fixa dos grupos. Fixa porque a mão aprende o lugar antes de o olho ler. */
export const ORDEM_DOS_GRUPOS: Grupo[] = ["chamada", "administracao", "online", "offline"];

const PESO_DO_PAPEL: Record<PapelNoEspaco, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };

/**
 * Dentro de um grupo: quem administra primeiro, depois por nome. O nome é
 * comparado sem diferenciar maiúsculas e com as regras do idioma — "Ágata" tem
 * de vir perto de "Agatha", não depois de "Zé".
 */
function compararMembros(a: MembroAgrupado, b: MembroAgrupado): number {
  const pa = PESO_DO_PAPEL[a.role ?? "MEMBER"];
  const pb = PESO_DO_PAPEL[b.role ?? "MEMBER"];
  if (pa !== pb) return pa - pb;
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
}

/**
 * Monta os grupos.
 *
 * `vozPorUsuario` já vem resolvido para NOME de canal — quem chama sabe quais
 * salas de voz são deste espaço, e esta função não deve saber o que é uma sala.
 *
 * Grupos vazios não voltam. Um título "Em chamada — 0" ocupa espaço para dizer
 * que não há nada, e a ausência do título diz a mesma coisa sem ocupar nada.
 */
export function agruparMembros(
  membros: MembroCru[],
  online: ReadonlySet<string>,
  vozPorUsuario: ReadonlyMap<string, CanalDeVoz>,
  meuId: string | null
): GrupoDeMembros[] {
  const baldes: Record<Grupo, MembroAgrupado[]> = {
    chamada: [],
    administracao: [],
    online: [],
    offline: []
  };

  for (const m of membros) {
    const canalDeVoz = vozPorUsuario.get(m.id) ?? null;
    /*
     * Estar numa chamada PROVA presença, mesmo que o evento de "online" ainda
     * não tenha chegado: a presença de voz e a de conexão viajam por caminhos
     * diferentes e podem chegar fora de ordem. Sem isto, alguém apareceria em
     * "Em chamada" e, um instante depois, também em "Offline".
     */
    const estaOnline = online.has(m.id) || canalDeVoz !== null;
    const agrupado: MembroAgrupado = {
      ...m,
      online: estaOnline,
      canalDeVoz,
      souEu: meuId !== null && m.id === meuId
    };

    if (canalDeVoz !== null) baldes.chamada.push(agrupado);
    else if (!estaOnline) baldes.offline.push(agrupado);
    else if (m.role === "OWNER" || m.role === "ADMIN") baldes.administracao.push(agrupado);
    else baldes.online.push(agrupado);
  }

  return ORDEM_DOS_GRUPOS.filter((g) => baldes[g].length > 0).map((g) => ({
    grupo: g,
    membros: baldes[g].sort(compararMembros)
  }));
}

/**
 * De "sala → ids" para "id → nome da sala".
 *
 * A presença de voz chega por SALA, porque é assim que o servidor a guarda. A
 * lista de membros precisa dela por PESSOA. Esta é a virada, e ela fica aqui
 * para ser testada: uma pessoa em duas salas ao mesmo tempo (dois aparelhos) é
 * um caso real, e a resposta é o primeiro canal na ordem em que as salas vieram.
 */
export function vozPorPessoa(
  presencaPorSala: Readonly<Record<string, readonly string[]>>,
  nomeDaSala: ReadonlyMap<string, string>
): Map<string, CanalDeVoz> {
  const saida = new Map<string, CanalDeVoz>();
  for (const [salaId, ids] of Object.entries(presencaPorSala)) {
    const nome = nomeDaSala.get(salaId);
    // Sala que não é deste espaço (ou que não conhecemos) não conta.
    if (nome === undefined) continue;
    for (const id of ids) if (!saida.has(id)) saida.set(id, { salaId, nome });
  }
  return saida;
}

/** Quantos estão online, para o cabeçalho. Quem está em chamada conta. */
export function contarOnline(grupos: readonly GrupoDeMembros[]): number {
  return grupos.reduce(
    (n, g) => (g.grupo === "offline" ? n : n + g.membros.length),
    0
  );
}

const CHAVE = "whatscord.painelDeMembros";

/** Se o painel fica aberto. Guardado por aparelho; o padrão é aberto. */
export function painelDeMembrosAberto(): boolean {
  try {
    return localStorage.getItem(CHAVE) !== "fechado";
  } catch {
    return true;
  }
}

export function salvarPainelDeMembros(aberto: boolean): void {
  try {
    if (aberto) localStorage.removeItem(CHAVE);
    else localStorage.setItem(CHAVE, "fechado");
  } catch {
    /* a escolha só não sobrevive à aba */
  }
}
