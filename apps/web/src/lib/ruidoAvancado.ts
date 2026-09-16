import type { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";
import { GtcrnWorkletNode, loadGtcrn } from "@sapphi-red/web-noise-suppressor";
import gtcrnWorkletUrl from "@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url";
import gtcrnWasmUrl from "@sapphi-red/web-noise-suppressor/gtcrn.wasm?url";

/**
 * A supressão avançada: uma rede neural entre o microfone e a publicação.
 *
 * É um `TrackProcessor` do LiveKit — o mesmo contrato que o filtro Krisp usa —
 * e por isso entra com `track.setProcessor()` e sai com `track.stopProcessor()`,
 * sem tocar em nada do resto da chamada.
 *
 * O motor é o GTCRN (Rong & Sun, ICASSP 2024), compilado para WebAssembly pelo
 * pacote `@sapphi-red/web-noise-suppressor` (MIT). Foi escolhido no lugar do
 * RNNoise porque aceita o AudioContext a 48 kHz OU a 16 kHz — o RNNoise exige
 * quadros de 480 amostras a 48 kHz e quebra em qualquer outra taxa — e no lugar
 * do DeepFilterNet porque este custa ~40 ms de atraso e ~12 MB de runtime ONNX,
 * para um efeito que ninguém pediu. 197 KB de modelo, 23,7 mil parâmetros.
 *
 * O cadeia: microfone → MediaStreamSource → GtcrnWorkletNode → MediaStreamDestination
 * → a track publicada. O LiveKit troca a track no sender (`replaceTrack`), então
 * não há renegociação e ninguém do outro lado percebe a troca.
 */

/** O binário é baixado uma vez por sessão e reaproveitado entre chamadas. */
let binarioPromessa: Promise<ArrayBuffer> | null = null;

/** Quais AudioContexts já receberam o módulo do worklet — um `addModule` por contexto. */
const contextosPreparados = new WeakSet<AudioContext>();

async function prepararContexto(ctx: AudioContext): Promise<ArrayBuffer> {
  binarioPromessa ??= loadGtcrn({ url: gtcrnWasmUrl });
  if (!contextosPreparados.has(ctx)) {
    await ctx.audioWorklet.addModule(gtcrnWorkletUrl);
    contextosPreparados.add(ctx);
  }
  return binarioPromessa;
}

/**
 * O worklet só sabe trabalhar a 48 kHz e a 16 kHz. Se o contexto que o LiveKit
 * nos deu roda em outra taxa (44,1 kHz acontece em alguns dispositivos no
 * Windows), o processamento vai num contexto próprio a 48 kHz — o navegador
 * faz a conversão de taxa na fronteira do MediaStream, dos dois lados.
 */
function contextoAdequado(fornecido: AudioContext | undefined): {
  ctx: AudioContext;
  proprio: boolean;
} {
  if (fornecido && (fornecido.sampleRate === 48000 || fornecido.sampleRate === 16000)) {
    return { ctx: fornecido, proprio: false };
  }
  return { ctx: new AudioContext({ sampleRate: 48000 }), proprio: true };
}

export class ProcessadorGtcrn implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = "whatscord-gtcrn";
  processedTrack?: MediaStreamTrack;

  private ctx: AudioContext | null = null;
  private contextoProprio = false;
  private fonte: MediaStreamAudioSourceNode | null = null;
  private no: GtcrnWorkletNode | null = null;
  private destino: MediaStreamAudioDestinationNode | null = null;
  private trackOriginal: MediaStreamTrack | null = null;
  private restricoesOriginais: MediaTrackConstraints | null = null;

  async init(opts: AudioProcessorOptions): Promise<void> {
    this.trackOriginal = opts.track;
    const { ctx, proprio } = contextoAdequado(opts.audioContext);
    this.ctx = ctx;
    this.contextoProprio = proprio;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);

    /*
     * A supressão do NAVEGADOR sai do caminho enquanto a rede está ligada. Dois
     * supressores em cadeia não somam: o segundo recebe um sinal já mastigado,
     * com os artefatos do primeiro, e piora. As restrições originais ficam
     * guardadas para voltarem em `destroy`.
     */
    this.restricoesOriginais = opts.track.getConstraints();
    await opts.track
      .applyConstraints({
        ...this.restricoesOriginais,
        noiseSuppression: false,
        // Ainda fora do tipo `MediaTrackConstraints` do TypeScript.
        ...({ voiceIsolation: false } as MediaTrackConstraints)
      })
      .catch(() => undefined);

    const binario = await prepararContexto(ctx);
    this.fonte = ctx.createMediaStreamSource(new MediaStream([opts.track]));
    // Um canal: microfone é mono, e o modelo processa por canal — dois canais
    // seriam o dobro de CPU para o mesmo som.
    this.no = new GtcrnWorkletNode(ctx, { wasmBinary: binario, maxChannels: 1 });
    this.destino = ctx.createMediaStreamDestination();
    this.fonte.connect(this.no);
    this.no.connect(this.destino);
    this.processedTrack = this.destino.stream.getAudioTracks()[0];
  }

  /**
   * Troca de microfone no meio da chamada: só a fonte muda. O worklet, o
   * binário e o destino continuam — trocar tudo custaria um recomeço do modelo
   * e um instante de silêncio.
   */
  async restart(opts: AudioProcessorOptions): Promise<void> {
    if (!this.ctx || !this.no) {
      await this.init(opts);
      return;
    }
    this.fonte?.disconnect();
    this.trackOriginal = opts.track;
    this.fonte = this.ctx.createMediaStreamSource(new MediaStream([opts.track]));
    this.fonte.connect(this.no);
  }

  async destroy(): Promise<void> {
    this.fonte?.disconnect();
    this.no?.disconnect();
    this.no?.destroy();
    this.destino?.disconnect();
    if (this.contextoProprio) await this.ctx?.close().catch(() => undefined);
    this.fonte = null;
    this.no = null;
    this.destino = null;
    this.ctx = null;
    this.processedTrack = undefined;

    // A supressão do navegador volta ao que era: a pessoa desligou a avançada,
    // não pediu para ficar sem nenhuma.
    if (this.trackOriginal && this.restricoesOriginais) {
      await this.trackOriginal.applyConstraints(this.restricoesOriginais).catch(() => undefined);
    }
    this.trackOriginal = null;
    this.restricoesOriginais = null;
  }
}

export function criarProcessadorGtcrn(): ProcessadorGtcrn {
  return new ProcessadorGtcrn();
}
