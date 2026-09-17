/**
 * Atualização do app desktop — as decisões, sem nada em volta.
 *
 * Quem baixa e instala é `lib/atualizador.ts`, e quem desenha é
 * `ui/Atualizacao.tsx`. Aqui fica só o que dá para verificar sem navegador e
 * sem Tauri: em que ambiente a atualização existe, quando vale procurar de
 * novo, quanto do download já veio e que tipo de erro foi aquele.
 *
 * Por isso este arquivo não importa NADA — nem o macro do Lingui (explode em
 * Node, e já quebrou os testes duas vezes), nem React, nem o plugin do Tauri.
 * Os tipos do evento de download são repetidos à mão pelo mesmo motivo: o teste
 * roda sem o pacote do plugin ter o que fazer.
 */

/** Espera depois de abrir o app antes da verificação automática. */
export const ESPERA_ANTES_DE_VERIFICAR_MS = 8_000;

/** Intervalo mínimo entre duas verificações automáticas. */
export const INTERVALO_ENTRE_VERIFICACOES_MS = 6 * 60 * 60 * 1000;

const CHAVE_ULTIMA_VERIFICACAO = "whatscord.atualizacao.ultimaVerificacao";

/**
 * A atualização só existe no app instalado no computador.
 *
 * `__TAURI_INTERNALS__` separa o app do navegador comum — mas o APK também é
 * Tauri e também tem essa variável. O plugin de atualização não é registrado no
 * Android (lá quem atualiza é a loja, ou um APK novo), e chamar um comando que
 * não existe só renderia um erro na tela. Daí o segundo teste, pelo agente.
 */
export function ehAppDesktop(temTauri: boolean, userAgent: string): boolean {
  return temTauri && !/Android/i.test(userAgent);
}

/**
 * Já está na hora de procurar de novo?
 *
 * Uma marca ilegível ou ausente conta como "nunca verificou". Uma marca no
 * FUTURO também: o relógio do computador voltou (fuso trocado, bateria da BIOS),
 * e respeitá-la calaria a verificação por quanto tempo o relógio tivesse
 * andado para trás.
 */
export function deveVerificar(ultima: number | null, agora: number): boolean {
  if (ultima === null || !Number.isFinite(ultima)) return true;
  if (ultima > agora) return true;
  return agora - ultima >= INTERVALO_ENTRE_VERIFICACOES_MS;
}

export function ultimaVerificacao(): number | null {
  try {
    const cru = localStorage.getItem(CHAVE_ULTIMA_VERIFICACAO);
    // Mesmo cuidado de `volumeDaChamada.ts`: `Number("")` vale zero, e zero é
    // um instante válido (1970) — leria como "verificou há muito tempo", o que
    // aqui por acaso dá certo, mas é por acaso.
    if (cru === null || cru.trim() === "") return null;
    const n = Number(cru);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function marcarVerificacao(agora: number): void {
  try {
    localStorage.setItem(CHAVE_ULTIMA_VERIFICACAO, String(agora));
  } catch {
    // Modo privado ou armazenamento cheio: verifica de novo na próxima abertura.
  }
}

/* --------------------------------------------------------------- download */

/** O mesmo formato do `DownloadEvent` de `@tauri-apps/plugin-updater`. */
export type EventoDeDownload =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export type Progresso = {
  /** Tamanho anunciado pelo servidor; `null` quando ele não disse. */
  total: number | null;
  baixado: number;
  terminou: boolean;
};

export const PROGRESSO_INICIAL: Progresso = { total: null, baixado: 0, terminou: false };

export function aplicarEvento(p: Progresso, e: EventoDeDownload): Progresso {
  switch (e.event) {
    case "Started": {
      /*
       * `contentLength` é opcional no plugin: vem do cabeçalho da resposta, e
       * nem todo servidor manda. Zero também não serve de total — dividiria
       * por zero.
       */
      const n = e.data.contentLength;
      return { total: typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null, baixado: 0, terminou: false };
    }
    case "Progress": {
      const n = e.data.chunkLength;
      return { ...p, baixado: p.baixado + (Number.isFinite(n) && n > 0 ? n : 0) };
    }
    case "Finished":
      return { ...p, terminou: true };
  }
}

/**
 * Porcentagem inteira de 0 a 100, ou `null` quando não há como saber.
 *
 * Arredonda para BAIXO e só diz 100 quando o download terminou de fato: "100%"
 * parado na tela enquanto o último pedaço ainda chega parece travado.
 */
export function porcentagem(p: Progresso): number | null {
  if (p.terminou) return 100;
  if (p.total === null) return null;
  return Math.max(0, Math.min(99, Math.floor((p.baixado / p.total) * 100)));
}

/* ------------------------------------------------------------------ erros */

export type TipoDeErro = "offline" | "sem-versao-publicada" | "assinatura" | "outro";

/**
 * Traduz o erro do plugin para uma de quatro situações que a pessoa entende.
 *
 * O plugin devolve texto, não código. As frases vêm de `error.rs` do
 * tauri-plugin-updater (branch v2): "Could not fetch a valid release JSON from
 * the remote" é o que sai quando o endereço de versões não responde com um JSON
 * válido — é o caso de nenhuma release publicada ainda (o GitHub devolve 404);
 * o erro de rede do reqwest chega como "error sending request for url (…)"; e
 * as falhas de assinatura mencionam "signature". Se o texto mudar numa versão
 * nova, o pior que acontece é cair em "outro", que tem mensagem genérica.
 */
export function tipoDeErro(erro: unknown, online = true): TipoDeErro {
  if (!online) return "offline";
  const texto =
    typeof erro === "string" ? erro : erro instanceof Error ? erro.message : String(erro ?? "");
  if (/signature/i.test(texto)) return "assinatura";
  if (/valid release JSON|not found in the response|platforms/i.test(texto)) return "sem-versao-publicada";
  if (/error sending request|dns|timed? ?out|connect|network|offline|failed to fetch/i.test(texto)) {
    return "offline";
  }
  return "outro";
}
