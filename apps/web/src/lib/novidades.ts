/**
 * As notas de versão do app de desktop: ler `novidades.md` e decidir quando
 * mostrar.
 *
 * Puro de propósito — sem Lingui, sem `localStorage` direto, sem import `?raw`.
 * Quem lê o arquivo e guarda a marca é `atualizador.ts`; aqui mora só a regra,
 * para poder ser testada em Node (ver as duas armadilhas no guia do agente).
 *
 * `scripts/release-desktop.mjs` tem a sua própria `secaoDaVersao`, porque um
 * `.mjs` rodado com `node` não importa `.ts`. `tests/novidades.test.ts` confere
 * que as duas extraem exatamente o mesmo texto do arquivo real.
 */

export type Novidade = { versao: string; itens: string[] };

const CABECALHO = /^##\s+v?(\d+\.\d+\.\d+)\s*$/;

/** Cada `## x.y.z` com o texto até o próximo cabeçalho, na ordem do arquivo. */
function secoes(md: string): { versao: string; texto: string }[] {
  const saida: { versao: string; texto: string }[] = [];
  let atual: { versao: string; linhas: string[] } | null = null;
  for (const linha of md.replace(/\r\n?/g, "\n").split("\n")) {
    const m = CABECALHO.exec(linha);
    if (m) {
      if (atual) saida.push({ versao: atual.versao, texto: atual.linhas.join("\n").trim() });
      atual = { versao: m[1], linhas: [] };
    } else if (/^#{1,2}\s/.test(linha)) {
      // Um cabeçalho que não é de versão encerra a seção, sem abrir outra.
      if (atual) saida.push({ versao: atual.versao, texto: atual.linhas.join("\n").trim() });
      atual = null;
    } else if (atual) {
      atual.linhas.push(linha);
    }
  }
  if (atual) saida.push({ versao: atual.versao, texto: atual.linhas.join("\n").trim() });
  return saida;
}

/** O texto da seção de uma versão, ou null se não existe ou está vazia. */
export function secaoDaVersao(md: string, versao: string): string | null {
  const s = secoes(md).find((x) => x.versao === versao.replace(/^v/, ""));
  return s && s.texto ? s.texto : null;
}

/**
 * As linhas de uma nota como itens de lista, em texto puro.
 *
 * As notas do `latest.json` NÃO são assinadas — só o instalador é. Por isso
 * nunca viram HTML: são texto, e o React escapa.
 */
export function itensDasNotas(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return texto
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim().replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean);
}

/** Compara `x.y.z`. Negativo se `a` é mais velha, positivo se mais nova. Ilegível conta como 0.0.0. */
export function compararVersoes(a: string, b: string): number {
  const partes = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const pa = partes(a);
  const pb = partes(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * As novidades que a pessoa ainda não viu, da mais nova para a mais velha.
 *
 * - `vista` é a última versão cujas novidades a pessoa fechou.
 * - Sem `vista` e sem sinal de uso anterior: instalação nova. Nada a mostrar —
 *   "o que mudou" não faz sentido para quem nunca viu o antes.
 * - Sem `vista` mas COM uso anterior: veio de uma versão que ainda não tinha
 *   este aviso. Mostra só a atual, porque não dá para saber de onde veio.
 * - Com `vista`: tudo depois dela até a atual, inclusive. Quem pulou versões vê
 *   as que perdeu.
 * - `vista` MAIS NOVA que a atual (voltou para uma versão velha): nada.
 */
export function novidadesNaoVistas(
  md: string,
  { atual, vista, usavaAntes }: { atual: string | null; vista: string | null; usavaAntes: boolean }
): Novidade[] {
  if (!atual) return [];
  const todas = secoes(md)
    .map((s) => ({ versao: s.versao, itens: itensDasNotas(s.texto) }))
    .filter((s) => s.itens.length > 0);

  if (!vista) {
    if (!usavaAntes) return [];
    return todas.filter((s) => s.versao === atual);
  }
  return todas
    .filter((s) => compararVersoes(s.versao, vista) > 0 && compararVersoes(s.versao, atual) <= 0)
    .sort((x, y) => compararVersoes(y.versao, x.versao));
}
