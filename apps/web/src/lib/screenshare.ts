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
 * Falso na WebView do Android: o wry implementa `onPermissionRequest` para
 * camera e microfone, mas nao ha nada equivalente para `getDisplayMedia` — isso
 * exigiria a API MediaProjection nativa. Melhor desabilitar o botao e dizer o
 * motivo do que deixar a pessoa clicar e nao acontecer nada.
 */
export const canShareScreen =
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

export type ShareMode = "text" | "motion";

const KEY = "whatscord.shareMode";

export function loadShareMode(): ShareMode {
  try {
    return localStorage.getItem(KEY) === "motion" ? "motion" : "text";
  } catch {
    return "text";
  }
}

export function saveShareMode(mode: ShareMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* a escolha só não sobrevive à aba */
  }
}

export type ShareCaptureOptions = {
  audio: boolean;
  video: true;
  systemAudio: "include" | "exclude";
  selfBrowserSurface: "include" | "exclude";
  surfaceSwitching: "include" | "exclude";
  suppressLocalAudioPlayback: boolean;
  contentHint: "detail" | "text" | "motion";
};

export type SharePublishOptions = {
  simulcast: boolean;
  degradationPreference: "maintain-framerate" | "maintain-resolution" | "balanced";
  screenShareEncoding: { maxBitrate: number; maxFramerate: number; priority: "medium" };
};

/**
 * O que pedir ao navegador na hora de capturar.
 *
 * `contentHint` é a peça que mais muda o resultado e não estava sendo passada:
 * sem ela o codificador trata a tela como vídeo em movimento e borra texto para
 * economizar banda. Com "text" ele preserva bordas nítidas — que é o que
 * importa quando o que está na tela é código ou planilha.
 *
 * `systemAudio: "include"` faz o Chrome OFERECER a caixinha de som do sistema
 * no diálogo de compartilhamento. Sem isso, dependendo do caso, a opção nem
 * aparece — e o som nunca vai junto, por mais que se peça `audio: true`.
 *
 * `suppressLocalAudioPlayback` evita ouvir o próprio áudio compartilhado em eco
 * na máquina de quem compartilha.
 */
export function captureOptions(mode: ShareMode): ShareCaptureOptions {
  return {
    audio: true,
    video: true,
    systemAudio: "include",
    // Compartilhar a própria aba do app é sempre o famoso efeito túnel.
    selfBrowserSurface: "exclude",
    // Deixa trocar a aba compartilhada sem parar e recomeçar.
    surfaceSwitching: "include",
    suppressLocalAudioPlayback: true,
    contentHint: mode === "text" ? "text" : "motion"
  };
}

/**
 * Como publicar a track de tela.
 *
 * `simulcast: false` é a mudança que mais pesa. Para TELA o LiveKit publica
 * duas camadas: a original mais uma com metade da resolução
 * (`computeDefaultScreenShareSimulcastPresets`), e reparte entre elas o mesmo
 * teto de banda — então a camada boa recebia uma fração dos 2.5 Mbps e o
 * codificador fazia o trabalho duas vezes. Numa chamada pequena isso é só
 * desperdício: aqui a banda inteira vai para uma camada só.
 *
 * Cuidado ao ler o SDK: o comentário "defaults to h180, h360" no `.d.ts` é de
 * `videoSimulcastLayers` (câmera, 3 camadas). Ele NÃO vale para tela.
 *
 * Passado por publicação, e não em `publishDefaults`, para não desligar o
 * simulcast da câmera — lá ele é útil, porque quem tem rede ruim cai para uma
 * camada menor em vez de travar.
 */
export function publishOptions(mode: ShareMode): SharePublishOptions {
  return mode === "text"
    ? {
        simulcast: false,
        // Texto ilegível é pior do que texto que atualiza devagar.
        degradationPreference: "maintain-resolution",
        screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 15, priority: "medium" }
      }
    : {
        simulcast: false,
        // Em vídeo, o contrário: engasgar é pior do que perder nitidez.
        degradationPreference: "maintain-framerate",
        screenShareEncoding: { maxBitrate: 4_000_000, maxFramerate: 30, priority: "medium" }
      };
}

/**
 * A ordem em que os modos aparecem na tela.
 *
 * Os rótulos saíram daqui: um objeto de strings no escopo do módulo é avaliado
 * na importação, antes de o catálogo de tradução carregar, e não reavalia
 * quando o idioma muda — ficaria congelado em inglês. Quem desenha a lista é
 * quem traduz.
 */
export const SHARE_MODES: ShareMode[] = ["text", "motion"];
