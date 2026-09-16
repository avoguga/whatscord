/**
 * Como a tela é capturada e publicada.
 *
 * Livre de imports do livekit-client de propósito: este arquivo é lido pela
 * tela de configurações, que não deve arrastar o SDK para o primeiro chunk.
 * Os tipos aqui são estruturais e batem com `ScreenShareCaptureOptions` e
 * `TrackPublishOptions` do SDK.
 */

/**
 * Se este aparelho consegue compartilhar tela.
 *
 * Falso na WebView do Android: nao existe caminho para `getDisplayMedia` ali —
 * capturar a tela exigiria a API MediaProjection nativa. Melhor desabilitar o
 * botao e dizer o motivo do que deixar a pessoa clicar e nao acontecer nada.
 *
 * Correcao de um comentario que ficou aqui e estava errado: ele dizia que o wry
 * concede permissao de camera e microfone. Nao concede — o
 * `PermissionRequested` dele responde apenas a CLIPBOARD_READ. No Windows quem
 * faz a captura funcionar e o sinalizador
 * `--auto-accept-camera-and-microphone-capture` da WebView, e quem faz os
 * dispositivos terem NOME e a concessao persistida em `conceder_midia`, no lado
 * Rust.
 */
export const canShareScreen =
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

/** Altura em pixels. `0` quer dizer "a resolução da fonte, sem limitar". */
export type Resolucao = 0 | 720 | 1080 | 1440;
export type Fps = 15 | 30 | 60;

export type Qualidade = { resolucao: Resolucao; fps: Fps };

export const RESOLUCOES: Resolucao[] = [720, 1080, 1440, 0];
export const TAXAS: Fps[] = [15, 30, 60];

/**
 * O padrão.
 *
 * Era 15 quadros por segundo, e foi exatamente essa a queixa que chegou dos
 * testes ("está com poucos FPS"). Quinze é uma escolha defensável para quem
 * compartilha uma planilha, e péssima para todo o resto — e ninguém escolheu,
 * era só o que vinha de fábrica. 1080p a 30 é o meio-termo que serve aos dois
 * casos sem exigir rede de sobra; quem quiser 60 escolhe.
 */
export const QUALIDADE_PADRAO: Qualidade = { resolucao: 1080, fps: 30 };

const KEY = "whatscord.shareQuality";

/** Antes existia `whatscord.shareMode` com "text" | "motion". */
const KEY_ANTIGA = "whatscord.shareMode";

export function ehResolucao(v: unknown): v is Resolucao {
  return typeof v === "number" && (RESOLUCOES as number[]).includes(v);
}
export function ehFps(v: unknown): v is Fps {
  return typeof v === "number" && (TAXAS as number[]).includes(v);
}

export function loadQualidade(): Qualidade {
  try {
    const cru = localStorage.getItem(KEY);
    if (cru) {
      const v = JSON.parse(cru) as Partial<Qualidade>;
      if (ehResolucao(v.resolucao) && ehFps(v.fps)) return { resolucao: v.resolucao, fps: v.fps };
    }
    /*
     * Quem já usava o app tem a preferência antiga guardada. Traduzir em vez de
     * ignorar: "motion" era 30 quadros e "text" era 15, então a escolha que a
     * pessoa fez continua valendo — e quem tinha "text" não é jogado para 60
     * sem pedir.
     */
    const antiga = localStorage.getItem(KEY_ANTIGA);
    if (antiga === "motion") return { resolucao: 1080, fps: 30 };
    if (antiga === "text") return { resolucao: 1080, fps: 15 };
  } catch {
    /* modo privado: fica o padrão */
  }
  return QUALIDADE_PADRAO;
}

export function saveQualidade(q: Qualidade): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* a escolha só não sobrevive à aba */
  }
}

/**
 * A largura que acompanha cada altura, em 16:9.
 *
 * A captura não é esticada para essa medida: o navegador trata `width`/`height`
 * como TETO e preserva a proporção da tela real. Uma tela 16:10 pedida como
 * 1920x1080 volta 1728x1080, e é isso mesmo que se quer.
 */
function larguraDe(altura: Resolucao): number {
  return Math.round((altura * 16) / 9);
}

/**
 * Quanta banda cada combinação precisa.
 *
 * Não é uma tabela de gosto: abaixo do necessário, o codificador tem de
 * escolher entre resolução e fluidez, e é aí que 60 vira 20 sem ninguém pedir.
 * Os números partem dos presets do próprio LiveKit para tela (1080p30 ≈ 3,5
 * Mbps) e crescem com a contagem de pixels e com a taxa — o dobro de quadros
 * não custa o dobro de bits, porque quadros vizinhos são parecidos, então o
 * fator de 60 é ~1,6 e não 2.
 */
export function bitrateDe({ resolucao, fps }: Qualidade): number {
  // "Fonte" pode ser um monitor 4K; orça como 1440p, que é o teto que a rede
  // de uma chamada comum aguenta sem derrubar todo mundo.
  const altura = resolucao === 0 ? 1440 : resolucao;
  const base = { 720: 1_800_000, 1080: 3_500_000, 1440: 6_000_000 }[
    altura as 720 | 1080 | 1440
  ];
  const fator = fps === 60 ? 1.6 : fps === 30 ? 1 : 0.7;
  return Math.round(base * fator);
}

export type ShareCaptureOptions = {
  audio: boolean;
  video: true;
  systemAudio: "include" | "exclude";
  selfBrowserSurface: "include" | "exclude";
  surfaceSwitching: "include" | "exclude";
  suppressLocalAudioPlayback: boolean;
  contentHint: "detail" | "text" | "motion";
  resolution?: { width: number; height: number; frameRate: number };
};

export type SharePublishOptions = {
  simulcast: boolean;
  degradationPreference: "maintain-framerate" | "maintain-resolution" | "balanced";
  screenShareEncoding: { maxBitrate: number; maxFramerate: number; priority: "high" | "medium" };
};

/**
 * O que pedir ao navegador na hora de capturar.
 *
 * `resolution` é a correção central do FPS baixo. Sem ela — e ela NÃO estava
 * sendo passada — o navegador escolhe sozinho, e o Chrome entrega em torno de
 * 30 quadros na captura de tela, com queda livre quando a máquina aperta.
 * Pedir 60 no `frameRate` é a única forma de a fonte sequer produzir 60: nenhum
 * ajuste de codificador inventa quadro que a captura não gerou. É por isso que
 * mexer só no `maxFramerate`, do lado da publicação, não resolveria nada.
 *
 * `contentHint` muda o que o codificador preserva quando falta banda. A 15
 * quadros o que se compartilha é quase sempre texto parado, e "text" mantém as
 * bordas nítidas; a 30 ou 60 o que se quer é fluidez, e "motion" aceita borrar
 * um pouco para não engasgar.
 *
 * `systemAudio: "include"` faz o Chrome OFERECER a caixinha de som do sistema
 * no diálogo de compartilhamento. Sem isso, dependendo do caso, a opção nem
 * aparece — e o som nunca vai junto, por mais que se peça `audio: true`.
 */
export function captureOptions(q: Qualidade): ShareCaptureOptions {
  const base: ShareCaptureOptions = {
    audio: true,
    video: true,
    systemAudio: "include",
    // Compartilhar a própria aba do app é sempre o famoso efeito túnel.
    selfBrowserSurface: "exclude",
    // Deixa trocar a aba compartilhada sem parar e recomeçar.
    surfaceSwitching: "include",
    suppressLocalAudioPlayback: true,
    contentHint: q.fps >= 30 ? "motion" : "text"
  };

  /*
   * "Fonte" pede um teto absurdamente alto em vez de NENHUM teto.
   *
   * Parece contraditório e não é. Deixar `resolution` indefinido faz o LiveKit
   * substituir por conta própria — `if (options.resolution === undefined)
   * options.resolution = ScreenSharePresets.h1080fps30.resolution` — e junto
   * com a resolução vai a TAXA daquele preset. Resultado: quem escolhia
   * "Fonte" com 60 quadros recebia 1080p a 30, sem nada na tela dizendo isso.
   *
   * 8K como `ideal` não amplia nada (um `ideal` nunca faz o navegador inventar
   * pixel), então na prática é "o que a fonte der" — e a taxa escolhida
   * sobrevive, que era o ponto.
   */
  if (q.resolucao === 0) {
    return { ...base, resolution: { width: 7680, height: 4320, frameRate: q.fps } };
  }

  return {
    ...base,
    resolution: { width: larguraDe(q.resolucao), height: q.resolucao, frameRate: q.fps }
  };
}

/**
 * Como publicar a track de tela.
 *
 * `simulcast: false` é a mudança que mais pesa. Para TELA o LiveKit publica
 * duas camadas: a original mais uma com metade da resolução
 * (`computeDefaultScreenShareSimulcastPresets`), e reparte entre elas o mesmo
 * teto de banda — então a camada boa recebia uma fração e o codificador fazia o
 * trabalho duas vezes. Numa chamada pequena isso é só desperdício: aqui a banda
 * inteira vai para uma camada só.
 *
 * Cuidado ao ler o SDK: o comentário "defaults to h180, h360" no `.d.ts` é de
 * `videoSimulcastLayers` (câmera, 3 camadas). Ele NÃO vale para tela.
 *
 * `degradationPreference` é o que decide o que morre quando a banda não dá.
 * A 60 quadros a resposta tem de ser "segure os quadros e perca nitidez" — o
 * contrário transforma 60 em 15 no primeiro aperto, que é justamente a queixa.
 * A 15 o raciocínio se inverte: texto ilegível é pior do que texto que atualiza
 * devagar.
 *
 * Passado por publicação, e não em `publishDefaults`, para não desligar o
 * simulcast da câmera — lá ele é útil, porque quem tem rede ruim cai para uma
 * camada menor em vez de travar.
 */
export function publishOptions(q: Qualidade): SharePublishOptions {
  return {
    simulcast: false,
    degradationPreference: q.fps >= 30 ? "maintain-framerate" : "maintain-resolution",
    screenShareEncoding: {
      maxBitrate: bitrateDe(q),
      maxFramerate: q.fps,
      /*
       * "high" e não "medium": é a prioridade de rede do navegador para esta
       * track. Quando a câmera e a tela disputam a mesma subida, quem precisa
       * de fluidez é a tela — a câmera continua legível a menos quadros.
       */
      priority: "high"
    }
  };
}

/** Um rótulo curto para a escolha atual, do tipo "1080p · 60 fps". */
export function resumo(q: Qualidade, nomeDaFonte: string): string {
  const res = q.resolucao === 0 ? nomeDaFonte : `${q.resolucao}p`;
  return `${res} · ${q.fps} fps`;
}

/* ------------------------------------------------------------------------ */
/* O que vai DIRETO ao navegador                                              */
/* ------------------------------------------------------------------------ */

/**
 * As restrições completas para `getDisplayMedia`, montadas por nós.
 *
 * Por que não deixar o LiveKit montar: o `screenCaptureToDisplayMediaStreamOptions`
 * dele repassa só sete chaves (audio, video, controller, selfBrowserSurface,
 * surfaceSwitching, systemAudio, preferCurrentTab) e DESCARTA as outras. Duas
 * das que ele descarta importam aqui:
 *
 * - `windowAudio: "window"` — Chrome 141+. Ao escolher uma JANELA, o navegador
 *   oferece o áudio só daquela janela (no Windows, por loopback de processo).
 *   Sem isto, a única forma de mandar som era "tela inteira + áudio do
 *   sistema" — e aí vai TUDO: a música, a notificação, a outra chamada. Foi
 *   exatamente a queixa: "queria só o Valorant, foi o sistema todo".
 * - `suppressLocalAudioPlayback: true` — quem compartilha com som não ouve o
 *   próprio som dobrado.
 *
 * O `systemAudio: "include"` continua: para quem escolhe a tela inteira, o áudio
 * do sistema é a única opção que existe, e ela tem de ser oferecida.
 *
 * Em navegador que não conhece `windowAudio` a chave é ignorada, sem erro — é
 * assim que restrições de `getDisplayMedia` se comportam.
 */
export type RestricoesDeTela = {
  audio: boolean;
  video: { width?: { ideal: number }; height?: { ideal: number }; frameRate?: number } | true;
  systemAudio: "include" | "exclude";
  windowAudio: "window" | "system" | "exclude";
  selfBrowserSurface: "include" | "exclude";
  surfaceSwitching: "include" | "exclude";
  suppressLocalAudioPlayback: boolean;
};

export function restricoesDeTela(q: Qualidade): RestricoesDeTela {
  const c = captureOptions(q);
  return {
    audio: c.audio,
    video: c.resolution
      ? {
          width: { ideal: c.resolution.width },
          height: { ideal: c.resolution.height },
          frameRate: c.resolution.frameRate
        }
      : true,
    systemAudio: c.systemAudio,
    windowAudio: "window",
    selfBrowserSurface: c.selfBrowserSurface,
    surfaceSwitching: c.surfaceSwitching,
    suppressLocalAudioPlayback: c.suppressLocalAudioPlayback
  };
}

/**
 * A versão maior do Chromium por trás deste user agent, ou `null` se não for
 * Chromium. Cobre Chrome, Edge e a WebView2 ("Chrome/153.0.0.0 ... Edg/153").
 */
export function versaoDoChromium(ua: string): number | null {
  const m = /Chrom(?:e|ium)\/(\d+)/.exec(ua);
  return m ? Number(m[1]) : null;
}

/** Onde `windowAudio` passou a existir. */
export const CHROMIUM_COM_AUDIO_DE_JANELA = 141;

/**
 * O que dizer quando a captura veio sem som.
 *
 * A frase depende do que o navegador é capaz de oferecer, e isso mudou no
 * Chrome 141: antes, janela nunca tinha áudio; agora tem, se a pessoa marcar.
 * Uma frase só, dizendo "janela não tem áudio", passaria a mentir.
 *
 * Por que pela VERSÃO e não por detecção de recurso: `windowAudio`, como
 * `systemAudio` e `selfBrowserSurface`, é opção do `getDisplayMedia`, não
 * restrição de trilha — e `getSupportedConstraints()` só lista restrições de
 * trilha. Medido no Chrome 152: `systemAudio: false` ali, com o recurso
 * funcionando há anos. A primeira versão desta função usava essa detecção e
 * responderia "não" para sempre.
 */
export function suportaAudioDeJanela(ua: string = navigator.userAgent): boolean {
  const v = versaoDoChromium(ua);
  return v !== null && v >= CHROMIUM_COM_AUDIO_DE_JANELA;
}
