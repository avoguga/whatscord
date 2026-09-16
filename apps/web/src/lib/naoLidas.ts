/**
 * Onde o número de não lidas aparece, e qual número é.
 *
 * O rail tem três lugares que carregam um contador — o botão de conversas,
 * cada chip de espaço, e a pasta fechada — e cada um responde a uma pergunta
 * diferente. Misturar as somas foi exatamente o defeito que existia: o botão de
 * conversas somava os canais de todos os espaços, então a pessoa clicava, não
 * achava nada novo e concluía que o contador estava quebrado.
 *
 * Puro, sem imports, para ser testado em Node.
 */

export type SalaContavel = {
  unread: number;
  space: { id: string } | null;
};

/** "Quantas mensagens me esperam FORA dos espaços" — conversas diretas e grupos. */
export function naoLidasForaDosEspacos(salas: readonly SalaContavel[]): number {
  return salas.reduce((n, r) => (r.space ? n : n + r.unread), 0);
}

/** "Tem coisa nova lá dentro?" — uma soma por espaço, só dos que têm algo. */
export function naoLidasPorEspaco(salas: readonly SalaContavel[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of salas) {
    if (r.space && r.unread > 0) m.set(r.space.id, (m.get(r.space.id) ?? 0) + r.unread);
  }
  return m;
}

/**
 * "Quantas nesta vista" — o filtro "Não lidas" da lista. A vista é o espaço
 * aberto, ou as conversas quando nenhum está.
 */
export function naoLidasNaVista(
  salas: readonly SalaContavel[],
  espacoAtivo: string | null
): number {
  return salas.reduce(
    (n, r) => ((espacoAtivo ? r.space?.id === espacoAtivo : !r.space) ? n + r.unread : n),
    0
  );
}

/** A soma de vários espaços — o que uma pasta fechada mostra. */
export function somarEspacos(porEspaco: ReadonlyMap<string, number>, ids: readonly string[]): number {
  return ids.reduce((n, id) => n + (porEspaco.get(id) ?? 0), 0);
}

/** "99+" em vez de um número de três dígitos que não cabe num círculo de 18px. */
export function rotuloDeContador(n: number): string {
  return n > 99 ? "99+" : String(n);
}
