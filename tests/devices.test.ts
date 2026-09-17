/**
 * Testes da escolha de dispositivos e dos avisos sonoros de chamada.
 *
 *   npx tsx tests/devices.test.ts
 *
 * Roda sem navegador: as duas partes que importam — decidir qual dispositivo
 * usar, e gerar o som — foram escritas sem depender de API do navegador
 * justamente para poderem ser verificadas aqui.
 *
 * Código de saída: 0 tudo passou · 1 houve FAIL.
 */
import { readFileSync } from "node:fs";
import {
  cameraParaFacing,
  deveUsarFacingMode,
  deviceLabel,
  facingDoRotulo,
  needsPermission,
  pedirPermissaoAdianta,
  proximoFacingMode,
  resolveDeviceId,
  selectableDevices,
  trocouDeCamera
} from "../apps/web/src/lib/devices";
import {
  CUES,
  TIMBRES,
  TOQUES,
  cueDataUrl,
  ehTimbre,
  toDataUrl,
  type Timbre,
  encodeWav,
  renderTone,
  toBase64,
  type ToneStep
} from "../apps/web/src/lib/sounds";
import {
  ESPERA_MS,
  SONS,
  bandejaSilenciada,
  ehEnderecoNosso,
  ehSomId,
  empacotarSom,
  favoritosDaSala,
  lerRecadoDeSom,
  ordenarBandeja,
  salvarBandejaSilenciada,
  salvarFavoritosDaSala,
  type SomId
} from "../apps/web/src/lib/soundboard";
import {
  ORDEM_DOS_GRUPOS,
  agruparMembros,
  contarOnline,
  painelDeMembrosAberto,
  salvarPainelDeMembros,
  vozPorPessoa,
  type MembroCru
} from "../apps/web/src/lib/membros";
import {
  naoLidasForaDosEspacos,
  naoLidasNaVista,
  naoLidasPorEspaco,
  rotuloDeContador,
  somarEspacos
} from "../apps/web/src/lib/naoLidas";
import {
  SUPRESSAO_PADRAO,
  SUPRESSOES,
  ehSupressao,
  restricoesDeCaptura,
  supressaoOuPadrao,
  usaProcessador
} from "../apps/web/src/lib/ruido";
import {
  VOLUME_MAX,
  VOLUME_PADRAO,
  chaveDeAudio,
  limitarVolume,
  rotuloDeVolume,
  salvarVolume,
  volumeDe
} from "../apps/web/src/lib/volumeDaChamada";
import {
  CHROMIUM_COM_AUDIO_DE_JANELA,
  bitrateDe,
  captureOptions,
  restricoesDeTela,
  suportaAudioDeJanela,
  versaoDoChromium,
  ehFps,
  ehResolucao,
  loadQualidade,
  publishOptions,
  QUALIDADE_PADRAO,
  RESOLUCOES,
  TAXAS,
  resumo,
  type Fps,
  type Qualidade,
  type Resolucao
} from "../apps/web/src/lib/screenshare";
import {
  ESPERA_ANTES_DE_VERIFICAR_MS,
  INTERVALO_ENTRE_VERIFICACOES_MS,
  CONTAGEM_MS,
  JANELA_DE_ABERTURA_MS,
  OCIOSO_ESCONDIDO_MS,
  OCIOSO_VISIVEL_MS,
  PENDENTE_ESCALA_MS,
  PENDENTE_LIMITE_MS,
  adiadoAte,
  adiar,
  adiarPorMs,
  atualizarAutomaticamente,
  decidirInstalacao,
  haRascunho,
  instalarAoSair,
  limparAdiamento,
  salvarAtualizarAutomaticamente,
  vistaPelaPrimeiraVez,
  PROGRESSO_INICIAL,
  aplicarEvento,
  deveVerificar,
  ehAppDesktop,
  marcarVerificacao,
  porcentagem,
  tipoDeErro,
  ultimaVerificacao,
  type EventoDeDownload,
  type Progresso
} from "../apps/web/src/lib/atualizacao";

let passed = 0;
const failures: string[] = [];

function check(desc: string, ok: boolean, expected?: unknown, actual?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ok   ${desc}`);
  } else {
    failures.push(desc);
    console.log(`  FAIL ${desc}`);
    if (expected !== undefined) console.log(`         esperado: ${JSON.stringify(expected)}`);
    if (actual !== undefined) console.log(`         obtido  : ${JSON.stringify(actual)}`);
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

const dev = (deviceId: string, label = "", kind: MediaDeviceKind = "audioinput") =>
  ({ deviceId, label, kind }) as MediaDeviceInfo;

// ---------------------------------------------------------------------------
section("resolveDeviceId — qual dispositivo usar de verdade");

check("sem preferência salva, não força nada", resolveDeviceId(undefined, [dev("a")]) === undefined);

check(
  "preferência salva que ainda existe é respeitada",
  resolveDeviceId("mic-b", [dev("mic-a"), dev("mic-b")]) === "mic-b"
);

check(
  "preferência salva que sumiu volta para o padrão do sistema",
  resolveDeviceId("headset-desconectado", [dev("mic-a")]) === undefined,
  undefined,
  resolveDeviceId("headset-desconectado", [dev("mic-a")])
);

check(
  "lista vazia (nenhum dispositivo) também cai no padrão",
  resolveDeviceId("mic-a", []) === undefined
);

check(
  '"default" é sempre válido, mesmo sem constar na lista',
  resolveDeviceId("default", []) === "default"
);

check(
  "string vazia não é tratada como escolha",
  resolveDeviceId("", [dev("mic-a")]) === undefined
);

// ---------------------------------------------------------------------------
section("placeholders e permissão — o caso que passou batido no navegador");

/*
 * Antes da permissão o Chrome NÃO devolve lista vazia: devolve uma entrada por
 * tipo, com id e rótulo vazios. Oferecer isso no seletor faz a escolha não
 * surtir efeito nenhum, em silêncio.
 */
check(
  "placeholder sem deviceId fica fora da lista",
  selectableDevices([dev(""), dev("mic-a")]).length === 1,
  1,
  selectableDevices([dev(""), dev("mic-a")]).length
);
check(
  "com permissão, nada é descartado",
  selectableDevices([dev("mic-a"), dev("mic-b")]).length === 2
);
check("lista vazia continua vazia", selectableDevices([]).length === 0);

check(
  "um tipo sem nenhum rótulo está aguardando permissão",
  needsPermission([{ label: "" }]) === true
);
check(
  "basta um rótulo conhecido para o tipo estar liberado",
  needsPermission([{ label: "" }, { label: "Headset" }]) === false,
  false,
  needsPermission([{ label: "" }, { label: "Headset" }])
);
check(
  "sem dispositivo desse tipo não é falta de permissão",
  needsPermission([]) === false
);

/*
 * O caso real desta máquina: câmera liberada, microfone não. Um teste global
 * de "existe algum rótulo?" dava permissão por concedida e escondia o aviso,
 * deixando o microfone inutilizável sem explicação.
 */
{
  const camerasLiberadas = [{ label: "OBS Virtual Camera" }, { label: "DroidCam Video" }];
  const microfoneBloqueado = [{ label: "" }];
  check(
    "câmera liberada e microfone bloqueado são avaliados separadamente",
    needsPermission(camerasLiberadas) === false && needsPermission(microfoneBloqueado) === true,
    "câmera livre, microfone bloqueado",
    { camera: needsPermission(camerasLiberadas), microfone: needsPermission(microfoneBloqueado) }
  );
  check(
    "e o microfone bloqueado não oferece opção nenhuma",
    selectableDevices([dev("")]).length === 0
  );
}

check(
  "rótulo real vence",
  deviceLabel({ label: "Jabra Evolve", kind: "audioinput" }, 0) === "Jabra Evolve"
);
check(
  "sem rótulo, microfone é numerado a partir de 1",
  deviceLabel({ label: "", kind: "audioinput" }, 1) === "Microphone 2",
  "Microphone 2",
  deviceLabel({ label: "", kind: "audioinput" }, 1)
);
check(
  "sem rótulo, câmera é nomeada como câmera",
  deviceLabel({ label: "", kind: "videoinput" }, 0) === "Camera 1"
);
check(
  "sem rótulo, saída é nomeada como alto-falante",
  deviceLabel({ label: "", kind: "audiooutput" }, 0) === "Speaker 1"
);

// ---------------------------------------------------------------------------
section("renderTone — a forma de onda do aviso");

const rate = 44100;
const oneStep: ToneStep[] = [{ freq: 440, ms: 100 }];
const wave = renderTone(oneStep, rate);

check(
  "duração em amostras bate com os milissegundos pedidos",
  wave.length === Math.round(0.1 * rate),
  Math.round(0.1 * rate),
  wave.length
);

check(
  "duração soma todos os passos",
  renderTone(
    [
      { freq: 440, ms: 50 },
      { freq: 660, ms: 70 }
    ],
    rate
  ).length ===
    Math.round(0.05 * rate) + Math.round(0.07 * rate)
);

let maxAmp = 0;
for (const v of wave) maxAmp = Math.max(maxAmp, Math.abs(v));
check(
  "amplitude fica abaixo do fundo de escala (não estoura, não assusta)",
  maxAmp > 0.1 && maxAmp <= 0.23,
  "entre 0.1 e 0.23",
  maxAmp
);

// A razão de existir do envelope: começar ou terminar no meio do ciclo estala.
check("começa em silêncio, sem estalo", Math.abs(wave[0]) < 0.005, "< 0.005", Math.abs(wave[0]));
check(
  "termina em silêncio, sem estalo",
  Math.abs(wave[wave.length - 1]) < 0.005,
  "< 0.005",
  Math.abs(wave[wave.length - 1])
);

/**
 * Frequência a partir dos cruzamentos por zero na subida.
 *
 * Contar cruzamentos e dividir pela janela dá resolução de ±17 Hz numa janela
 * curta — o bastante para reprovar um tom correto. Interpolando a posição exata
 * de cada cruzamento e medindo do primeiro ao último, o erro cai para menos de
 * 1 Hz, que é o que se quer de um teste de frequência.
 */
function frequencyOf(samples: Float32Array, sampleRate: number): number {
  const from = Math.floor(samples.length * 0.2);
  const to = Math.floor(samples.length * 0.8);
  const crossings: number[] = [];
  for (let i = from + 1; i < to; i++) {
    const before = samples[i - 1];
    const now = samples[i];
    if (before < 0 && now >= 0) crossings.push(i - 1 + before / (before - now));
  }
  if (crossings.length < 2) return NaN;
  const span = crossings[crossings.length - 1] - crossings[0];
  return ((crossings.length - 1) * sampleRate) / span;
}

for (const freq of [440, 880]) {
  const medida = frequencyOf(renderTone([{ freq, ms: 100 }], rate), rate);
  check(
    `a frequência gerada é a pedida (${freq} Hz)`,
    Math.abs(medida - freq) < 1,
    `≈${freq} Hz`,
    Number(medida.toFixed(2))
  );
}

// ---------------------------------------------------------------------------
section("os dois avisos são distinguíveis");

check("entrar tem dois tons", CUES.join.length === 2);
check("sair tem dois tons", CUES.leave.length === 2);
check(
  "entrar sobe de tom",
  CUES.join[1].freq > CUES.join[0].freq,
  "segundo tom mais agudo",
  CUES.join.map((s) => s.freq)
);
check(
  "sair desce de tom",
  CUES.leave[1].freq < CUES.leave[0].freq,
  "segundo tom mais grave",
  CUES.leave.map((s) => s.freq)
);
check(
  "os dois avisos geram áudio diferente",
  cueDataUrl("join") !== cueDataUrl("leave")
);

const joinWave = renderTone(CUES.join);
check(
  "o aviso dura pouco, para não atrapalhar a conversa",
  joinWave.length / 44100 < 0.35,
  "< 0.35 s",
  joinWave.length / 44100
);

// ---------------------------------------------------------------------------
section("encodeWav — cabeçalho de arquivo válido");

const bytes = encodeWav(wave, rate);
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const ascii = (at: number, len: number) =>
  String.fromCharCode(...bytes.subarray(at, at + len));

check("assinatura RIFF", ascii(0, 4) === "RIFF", "RIFF", ascii(0, 4));
check("tipo WAVE", ascii(8, 4) === "WAVE", "WAVE", ascii(8, 4));
check("bloco fmt", ascii(12, 4) === "fmt ", "fmt ", ascii(12, 4));
check("bloco data", ascii(36, 4) === "data", "data", ascii(36, 4));
check("PCM sem compressão", view.getUint16(20, true) === 1);
check("mono", view.getUint16(22, true) === 1);
check("taxa de amostragem", view.getUint32(24, true) === rate, rate, view.getUint32(24, true));
check("16 bits por amostra", view.getUint16(34, true) === 16);
check(
  "bytes por segundo coerentes com taxa e profundidade",
  view.getUint32(28, true) === rate * 2
);
check(
  "tamanho declarado do bloco data bate com os dados",
  view.getUint32(40, true) === wave.length * 2,
  wave.length * 2,
  view.getUint32(40, true)
);
check(
  "tamanho total do arquivo é cabeçalho + dados",
  bytes.length === 44 + wave.length * 2,
  44 + wave.length * 2,
  bytes.length
);
check(
  "tamanho declarado no RIFF bate com o arquivo",
  view.getUint32(4, true) === bytes.length - 8
);

// As amostras têm que sobreviver à conversão para inteiro de 16 bits.
let maiorErro = 0;
for (let i = 0; i < wave.length; i++) {
  const decoded = view.getInt16(44 + i * 2, true) / 32767;
  maiorErro = Math.max(maiorErro, Math.abs(decoded - wave[i]));
}
check(
  "as amostras voltam iguais ao decodificar (erro só de quantização)",
  maiorErro < 1 / 32000,
  "< 3.1e-5",
  maiorErro
);

// ---------------------------------------------------------------------------
section("toBase64 e a data URL");

check(
  "base64 confere com a decodificação do próprio runtime",
  Buffer.from(toBase64(bytes), "base64").equals(Buffer.from(bytes)),
  "bytes idênticos"
);

// O caminho em blocos existe por causa de arrays grandes; precisa dar o mesmo
// resultado que o caminho curto.
const grande = new Uint8Array(0x2000 * 2 + 123).map((_, i) => i % 251);
check(
  "base64 correto acima do tamanho de um bloco (0x2000)",
  Buffer.from(toBase64(grande), "base64").equals(Buffer.from(grande)),
  "bytes idênticos"
);

const url = cueDataUrl("join");
check("data URL tem o tipo certo", url.startsWith("data:audio/wav;base64,"));
check(
  "o conteúdo da data URL é um WAV",
  Buffer.from(url.slice("data:audio/wav;base64,".length), "base64")
    .subarray(0, 4)
    .toString() === "RIFF"
);

// ---------------------------------------------------------------------------
section("pedir permissão só quando adianta");

/*
 * O caso que motivou isto: no app instalado a WebView recebe
 * `--auto-accept-camera-and-microphone-capture`, que aceita o aviso sem gravar
 * a permissão. A captura funciona e os nomes nunca aparecem — então a tela
 * oferecia um botão "permitir" que chamava `getUserMedia`, era auto-aceito de
 * novo, e nada mudava. Clicar dez vezes dava o mesmo nada.
 */
check(
  "bloqueado e SEM track viva: pedir adianta",
  pedirPermissaoAdianta(true, false) === true
);
check(
  "bloqueado mas COM microfone aberto: pedir NÃO adianta (a permissão já existe)",
  pedirPermissaoAdianta(true, true) === false,
  false,
  pedirPermissaoAdianta(true, true)
);
check(
  "sem bloqueio nenhum, não há o que pedir",
  pedirPermissaoAdianta(false, false) === false && pedirPermissaoAdianta(false, true) === false
);

// ---------------------------------------------------------------------------
section("compartilhamento de tela — o que se pede ao navegador");

const q = (resolucao: Resolucao, fps: Fps): Qualidade => ({ resolucao, fps });

for (const alvo of [q(720, 15), q(1080, 30), q(1440, 60), q(0, 60)]) {
  const nome = `${alvo.resolucao}p${alvo.fps}`;
  const c = captureOptions(alvo);
  check(`[${nome}] pede áudio junto`, c.audio === true);
  check(
    `[${nome}] pede que o som do sistema seja OFERECIDO no diálogo`,
    c.systemAudio === "include",
    "include",
    c.systemAudio
  );
  check(
    `[${nome}] não oferece compartilhar a própria aba (efeito túnel)`,
    c.selfBrowserSurface === "exclude"
  );
  check(
    `[${nome}] deixa trocar a aba compartilhada sem recomeçar`,
    c.surfaceSwitching === "include"
  );
  check(
    `[${nome}] evita eco do próprio áudio em quem compartilha`,
    c.suppressLocalAudioPlayback === true
  );
}

/*
 * O CORAÇÃO DA QUEIXA DE "POUCOS FPS".
 *
 * Sem `frameRate` na captura, nenhum ajuste do lado da publicação produz 60:
 * o codificador não inventa quadro que a fonte não gerou. Este é o teste que
 * trava a regressão.
 */
for (const fps of TAXAS) {
  const c = captureOptions(q(1080, fps));
  check(
    `[${fps} fps] a captura PEDE a taxa ao navegador`,
    c.resolution?.frameRate === fps,
    fps,
    c.resolution?.frameRate
  );
}

check(
  "1080p pede 1920 de largura, mantendo 16:9",
  captureOptions(q(1080, 30)).resolution?.width === 1920,
  1920,
  captureOptions(q(1080, 30)).resolution?.width
);
check(
  "1440p pede 2560 de largura",
  captureOptions(q(1440, 60)).resolution?.width === 2560,
  2560,
  captureOptions(q(1440, 60)).resolution?.width
);
/*
 * "Fonte" e o teto absurdo.
 *
 * Este teste dizia o contrário — que "fonte" não mandava medida nenhuma — e
 * estava verificando um DEFEITO. Deixar `resolution` indefinido faz o LiveKit
 * substituir por conta própria pelo preset h1080fps30, e junto com a resolução
 * vai a TAXA: quem escolhia "Fonte" com 60 quadros recebia 30, sem nada na tela
 * dizendo isso. Um `ideal` de 8K não amplia nada — nenhum navegador inventa
 * pixel que a fonte não tem — então na prática continua sendo "o que a fonte
 * der", e a taxa escolhida sobrevive, que era o ponto.
 */
check(
  "'fonte' pede um teto alto demais para limitar, e não medida nenhuma",
  captureOptions(q(0, 60)).resolution?.height === 4320,
  4320,
  captureOptions(q(0, 60)).resolution?.height
);
for (const fps of TAXAS) {
  check(
    `'fonte' com ${fps} quadros carrega os ${fps} — sem isso o LiveKit troca por 30`,
    captureOptions(q(0, fps)).resolution?.frameRate === fps,
    fps,
    captureOptions(q(0, fps)).resolution?.frameRate
  );
}

check(
  "15 quadros pede contentHint 'text' (preserva borda, não borra letra)",
  captureOptions(q(1080, 15)).contentHint === "text",
  "text",
  captureOptions(q(1080, 15)).contentHint
);
for (const fps of [30, 60] as Fps[]) {
  check(
    `${fps} quadros pede contentHint 'motion'`,
    captureOptions(q(1080, fps)).contentHint === "motion"
  );
}

// ---------------------------------------------------------------------------
section("compartilhamento de tela — como se publica");

/*
 * A correção que mais pesa: o padrão do LiveKit publica duas camadas na tela e
 * reparte entre elas o mesmo teto de banda, então a camada boa recebia uma
 * fração. Se este teste falhar, a qualidade regrediu.
 */
for (const alvo of [q(720, 15), q(1080, 30), q(1440, 60)]) {
  const nome = `${alvo.resolucao}p${alvo.fps}`;
  check(`[${nome}] simulcast DESLIGADO na tela`, publishOptions(alvo).simulcast === false);
  check(
    `[${nome}] o teto de quadros publicado é o que a pessoa escolheu`,
    publishOptions(alvo).screenShareEncoding.maxFramerate === alvo.fps,
    alvo.fps,
    publishOptions(alvo).screenShareEncoding.maxFramerate
  );
  check(
    `[${nome}] a tela tem prioridade de rede alta (disputa com a câmera)`,
    publishOptions(alvo).screenShareEncoding.priority === "high"
  );
}

check(
  "15 quadros prioriza resolução (letra ilegível é pior que letra que atualiza devagar)",
  publishOptions(q(1080, 15)).degradationPreference === "maintain-resolution",
  "maintain-resolution",
  publishOptions(q(1080, 15)).degradationPreference
);
/*
 * A 60 a preferência TEM de ser manter os quadros. O contrário é o defeito
 * clássico: a rede aperta, o codificador segura a resolução, e os 60 viram 20
 * sem ninguém ter pedido — exatamente a queixa que chegou.
 */
for (const fps of [30, 60] as Fps[]) {
  check(
    `${fps} quadros prioriza a taxa (engasgar é pior que perder nitidez)`,
    publishOptions(q(1080, fps)).degradationPreference === "maintain-framerate"
  );
}

check(
  "mais quadros pedem mais banda",
  bitrateDe(q(1080, 60)) > bitrateDe(q(1080, 30)) &&
    bitrateDe(q(1080, 30)) > bitrateDe(q(1080, 15)),
  "60 > 30 > 15",
  [bitrateDe(q(1080, 15)), bitrateDe(q(1080, 30)), bitrateDe(q(1080, 60))]
);
check(
  "mais pixels pedem mais banda",
  bitrateDe(q(1440, 30)) > bitrateDe(q(1080, 30)) &&
    bitrateDe(q(1080, 30)) > bitrateDe(q(720, 30)),
  "1440 > 1080 > 720",
  [bitrateDe(q(720, 30)), bitrateDe(q(1080, 30)), bitrateDe(q(1440, 30))]
);
check(
  "dobrar os quadros NÃO dobra a banda (quadros vizinhos são parecidos)",
  bitrateDe(q(1080, 60)) < bitrateDe(q(1080, 30)) * 2,
  "< o dobro",
  { f30: bitrateDe(q(1080, 30)), f60: bitrateDe(q(1080, 60)) }
);
check(
  "'fonte' é orçada como 1440p, e não como infinito",
  bitrateDe(q(0, 60)) === bitrateDe(q(1440, 60))
);

// ---------------------------------------------------------------------------
section("compartilhamento de tela — a escolha guardada");

check("toda resolução da lista é reconhecida", RESOLUCOES.every(ehResolucao));
check("toda taxa da lista é reconhecida", TAXAS.every(ehFps));
check("uma resolução inventada é recusada", !ehResolucao(900));
check("uma taxa inventada é recusada", !ehFps(24));
check("texto não passa por número", !ehFps("30" as unknown));

/*
 * O padrão MUDOU de propósito: era 15 quadros, e foi exatamente essa a queixa
 * dos testes. Se alguém baixar de novo sem querer, este teste falha.
 */
check(
  "o padrão são 30 quadros, e não 15",
  QUALIDADE_PADRAO.fps === 30,
  30,
  QUALIDADE_PADRAO.fps
);
check("o padrão é 1080p", QUALIDADE_PADRAO.resolucao === 1080);

// Sem localStorage (é o caso aqui no node) nada pode explodir: cai no padrão.
check(
  "sem armazenamento disponível, cai no padrão",
  loadQualidade().fps === QUALIDADE_PADRAO.fps &&
    loadQualidade().resolucao === QUALIDADE_PADRAO.resolucao,
  QUALIDADE_PADRAO,
  loadQualidade()
);

check("o resumo diz resolução e taxa", resumo(q(1080, 60), "Fonte") === "1080p · 60 fps");
check("o resumo usa o nome dado para 'fonte'", resumo(q(0, 30), "Fonte") === "Fonte · 30 fps");

// ---------------------------------------------------------------------------
section("som por conversa — dá para saber de onde veio sem olhar");

check("existem timbres suficientes para distinguir conversas", TIMBRES.length >= 4);
check("todo timbre da lista é reconhecido", TIMBRES.every(ehTimbre));
check("um timbre inventado é recusado", !ehTimbre("funk"));
check("texto vazio não passa por timbre", !ehTimbre(""));

for (const timbre of TIMBRES) {
  const toques = TOQUES[timbre];
  check(`[${timbre}] tem os três tipos de aviso`, Boolean(toques.join && toques.leave && toques.mensagem));
  if (timbre === "mudo") continue;
  check(
    `[${timbre}] entrar SOBE e sair DESCE (a direção é o que carrega o sentido)`,
    toques.join.at(-1)!.freq > toques.join[0].freq &&
      toques.leave.at(-1)!.freq < toques.leave[0].freq,
    "join sobe, leave desce",
    { join: toques.join.map((x) => x.freq), leave: toques.leave.map((x) => x.freq) }
  );
}

/*
 * O ponto da funcionalidade: dois grupos NÃO podem soar igual. Se dois timbres
 * tiverem a mesma nota inicial, a pessoa não distingue de costas para a tela —
 * que é exatamente o uso.
 */
const primeirasNotas = TIMBRES.filter((v) => v !== "mudo").map((v) => TOQUES[v].mensagem[0].freq);
check(
  "cada timbre começa numa nota diferente",
  new Set(primeirasNotas).size === primeirasNotas.length,
  "todas distintas",
  primeirasNotas
);

check(
  "mudo é silêncio de verdade, e não volume zero",
  TOQUES.mudo.join.length === 0 &&
    TOQUES.mudo.leave.length === 0 &&
    TOQUES.mudo.mensagem.length === 0
);

/*
 * Silenciar a mensagem e continuar anunciando quem entrou na chamada daquele
 * mesmo grupo seria incoerente — "não me interrompa" vale para os três.
 */
check(
  "mudo cala os três tipos, não só a mensagem",
  (["join", "leave", "mensagem"] as const).every((k) => TOQUES.mudo[k].length === 0)
);

for (const timbre of TIMBRES.filter((v) => v !== "mudo")) {
  const url = toDataUrl(TOQUES[timbre as Timbre].mensagem);
  check(
    `[${timbre}] o toque de mensagem vira um WAV válido`,
    url.startsWith("data:audio/wav;base64,") &&
      Buffer.from(url.slice("data:audio/wav;base64,".length), "base64")
        .subarray(0, 4)
        .toString() === "RIFF"
  );
}

check(
  "o timbre padrão continua sendo o par de notas original da chamada",
  JSON.stringify(TOQUES.padrao.join) === JSON.stringify(CUES.join) &&
    JSON.stringify(TOQUES.padrao.leave) === JSON.stringify(CUES.leave)
);

// ---------------------------------------------------------------------------
section("virar a câmera — de que lado é cada câmera");

const cam = (deviceId: string, label = "") =>
  ({ deviceId, label, kind: "videoinput" }) as MediaDeviceInfo;

check("virar de frontal dá traseira", proximoFacingMode("user") === "environment");
check("virar de traseira dá frontal", proximoFacingMode("environment") === "user");
check(
  "virar duas vezes volta ao começo",
  proximoFacingMode(proximoFacingMode("user")) === "user"
);

// Rótulos reais: Android ("camera2 0, facing back"), iOS ("Back Dual Wide Camera").
check("rótulo do Android traseira", facingDoRotulo("camera2 0, facing back") === "environment");
check("rótulo do Android frontal", facingDoRotulo("camera2 1, facing front") === "user");
check("rótulo do iOS frontal", facingDoRotulo("Front Camera") === "user");
check("rótulo do iOS traseira", facingDoRotulo("Back Dual Wide Camera") === "environment");
check("rótulo em português", facingDoRotulo("Câmera traseira") === "environment");
check("webcam de mesa não anuncia lado", facingDoRotulo("HD Pro Webcam C920") === null);
check("rótulo vazio não anuncia lado", facingDoRotulo("") === null);
check("rótulo ausente não quebra", facingDoRotulo(undefined) === null);
/*
 * "user" e "environment" são valores da API, não palavras de rótulo. Se
 * entrassem na busca, uma webcam chamada "User's Webcam" viraria "frontal" e o
 * botão apareceria num computador.
 */
check(
  '"User\'s Webcam" NÃO é lido como câmera frontal',
  facingDoRotulo("User's Webcam") === null,
  null,
  facingDoRotulo("User's Webcam")
);

// ---------------------------------------------------------------------------
section("virar a câmera — quando o botão pode aparecer");

check(
  "computador com duas webcams nomeadas: troca por id, sem botão",
  deveUsarFacingMode([cam("a", "HD Pro Webcam C920"), cam("b", "Integrated Camera")]) === false,
  false,
  deveUsarFacingMode([cam("a", "HD Pro Webcam C920"), cam("b", "Integrated Camera")])
);
check(
  "uma câmera só nunca mostra o botão, mesmo num telefone",
  deveUsarFacingMode([cam("a", "camera2 0, facing back")]) === false
);
check("lista vazia não mostra o botão", deveUsarFacingMode([]) === false);
check(
  "(a) alguma câmera sem deviceId: não há id para passar, usa o lado",
  deveUsarFacingMode([cam(""), cam("b", "Integrated Camera")]) === true
);
check(
  "(b) tem id mas nenhuma tem nome — a WebView do Android",
  deveUsarFacingMode([cam("a"), cam("b")]) === true
);
check(
  "(c) o rótulo anuncia o lado — o próprio aparelho está dizendo",
  deveUsarFacingMode([cam("a", "camera2 0, facing back"), cam("b", "camera2 1, facing front")]) ===
    true
);
check(
  "basta UMA anunciar o lado",
  deveUsarFacingMode([cam("a", "Front Camera"), cam("b", "Desk View Camera")]) === true
);
/*
 * O placeholder de antes da permissão (id e nome vazios) vem sozinho, um por
 * tipo — então não dispara o botão antes de a pessoa liberar a câmera.
 */
check(
  "placeholder solitário de antes da permissão não mostra o botão",
  deveUsarFacingMode([cam("")]) === false
);

// ---------------------------------------------------------------------------
section("virar a câmera — o plano B, por deviceId");

const doTelefone = [cam("tras-1", "camera2 0, facing back"), cam("frente-1", "camera2 1, facing front")];
check(
  "com rótulo, escolhe a câmera do lado pedido",
  cameraParaFacing(doTelefone, "environment", "frente-1") === "tras-1",
  "tras-1",
  cameraParaFacing(doTelefone, "environment", "frente-1")
);
check(
  "com rótulo, o outro lado também",
  cameraParaFacing(doTelefone, "user", "tras-1") === "frente-1"
);
check(
  "sem rótulo que ajude, pega a outra que não a de agora",
  cameraParaFacing([cam("a"), cam("b")], "environment", "a") === "b",
  "b",
  cameraParaFacing([cam("a"), cam("b")], "environment", "a")
);
check(
  "nunca devolve um deviceId vazio (o placeholder não serve de alvo)",
  cameraParaFacing([cam(""), cam("b")], "environment", "b") === undefined,
  undefined,
  cameraParaFacing([cam(""), cam("b")], "environment", "b")
);
check(
  "com uma câmera usável só, e sendo a atual, não há alvo",
  cameraParaFacing([cam("a")], "environment", "a") === undefined
);

// ---------------------------------------------------------------------------
section("virar a câmera — descobrir se a troca aconteceu de verdade");

/*
 * A armadilha que este teste tranca: `restartTrack({ facingMode })` não exige
 * nada do navegador. O `constraintsForOptions` do livekit-client ainda injeta
 * `deviceId ??= { ideal: "default" }`, e `facingMode` vai como valor nu — os
 * dois são "ideal". A promessa então RESOLVE COM SUCESSO devolvendo a mesma
 * câmera. Sem esta checagem o plano B nunca rodaria justamente onde é preciso.
 */
check(
  "o lado mudou para o pedido: trocou",
  trocouDeCamera({ facingMode: "user" }, { facingMode: "environment" }, "environment") === true
);
check(
  "o lado continua o mesmo: NÃO trocou (sucesso silencioso)",
  trocouDeCamera({ facingMode: "user" }, { facingMode: "user" }, "environment") === false,
  false,
  trocouDeCamera({ facingMode: "user" }, { facingMode: "user" }, "environment")
);
check(
  "sem facingMode, um deviceId diferente também prova a troca",
  trocouDeCamera({ deviceId: "a" }, { deviceId: "b" }, "environment") === true
);
check(
  "sem facingMode e com o mesmo deviceId: não trocou",
  trocouDeCamera({ deviceId: "a" }, { deviceId: "a" }, "environment") === false
);
check(
  "sem pista nenhuma, aceita — reabrir a câmera à toa é pior",
  trocouDeCamera({}, {}, "environment") === true
);
check(
  "facingMode manda mais que deviceId (a mesma câmera pode virar sozinha)",
  trocouDeCamera({ deviceId: "a", facingMode: "user" }, { deviceId: "a", facingMode: "environment" }, "environment") === true
);

// ---------------------------------------------------------------------------
section("tela compartilhada esticada — a regra de CSS que a medição apontou");

/*
 * MEDIÇÃO (servidor em 5175, aba própria no Playwright, DOM real da chamada numa
 * caixa de 1280x760, fonte = canvas.captureStream de proporção conhecida):
 *
 *   fonte 1000x1000 · videoWidth/Height 1000x1000 · tile 996x443,4
 *   caixa do <video> medida: 996x996  →  552,6px A MAIS que o tile
 *
 * 1 e 2 batendo provam que a captura está certa. O defeito é que `height: 100%`
 * não resolve dentro de `.tile` (grid com `place-items: center`, linha `auto`):
 * o elemento substituído toma largura/proporção, transborda, e o
 * `overflow: hidden` do tile corta em cima e embaixo. `object-fit: contain`
 * encaixa a imagem na CAIXA DO ELEMENTO — e era a caixa que estava errada.
 *
 * O conserto é tirar o vídeo do fluxo do grid. Se alguém reescrever a regra sem
 * `position: absolute`, o corte volta — e é isso que este bloco tranca.
 */
const css = readFileSync(new URL("../apps/web/src/styles.css", import.meta.url), "utf8");
const regraDoVideo = /\.tile\s+video\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

check("a regra `.tile video` existe na folha de estilo", regraDoVideo.length > 0);
check(
  "o vídeo sai do fluxo do grid (position: absolute)",
  /position:\s*absolute/.test(regraDoVideo),
  "position: absolute",
  regraDoVideo.trim()
);
check(
  "e é colado nos quatro lados do tile (inset: 0)",
  /inset:\s*0/.test(regraDoVideo),
  "inset: 0",
  regraDoVideo.trim()
);
check(
  "continua encaixando por dentro, sem cortar (object-fit: contain)",
  /object-fit:\s*contain/.test(regraDoVideo)
);
check(
  "o tile continua sendo o bloco de referência (position: relative)",
  /\.tile\s*\{[^}]*position:\s*relative/.test(css)
);

/*
 * A conta que o navegador fazia, reproduzida aqui para o número da medição não
 * virar folclore: sem sair do fluxo, a altura do <video> é largura/proporção,
 * independente da altura do tile.
 */
const alturaSolta = (larguraDoTile: number, proporcaoDaFonte: number) =>
  larguraDoTile / proporcaoDaFonte;
check(
  "a conta bate com os 996x996 medidos numa fonte quadrada",
  Math.round(alturaSolta(996, 1)) === 996
);
check(
  "e com o transbordo de 552,6px sobre um tile de 443,4px de altura",
  Math.abs(alturaSolta(996, 1) - 443.4 - 552.6) < 0.1,
  552.6,
  alturaSolta(996, 1) - 443.4
);
check(
  "a tira também sofria: 1280x1024 num tile 16/10 de 168x105 dava 134,4",
  Math.abs(alturaSolta(168, 1280 / 1024) - 134.4) < 0.1,
  134.4,
  alturaSolta(168, 1280 / 1024)
);

// ---------------------------------------------------------------------------
section("bandeja de sons — o recado que viaja pela chamada");

/*
 * Por que o recado, e não o áudio: apertar um som publica alguns bytes no canal
 * de dados e cada aparelho sintetiza o mesmo som. Isso só funciona se as duas
 * pontas concordarem — e é exatamente esse acordo que se verifica aqui, porque
 * ele quebra em silêncio: um recado que não é entendido não dá erro, só não
 * toca, e quem apertou continua ouvindo o próprio som achando que deu certo.
 */

for (const som of SONS) {
  check(
    `"${som.id}" volta inteiro do empacotamento`,
    lerRecadoDeSom(empacotarSom(som.id))?.id === som.id,
    som.id,
    lerRecadoDeSom(empacotarSom(som.id))?.id
  );
}

check("o recado é pequeno o bastante para não pesar", empacotarSom("fanfarra").length < 64);
check(
  "um embutido não carrega endereço — ele é sintetizado dos dois lados",
  lerRecadoDeSom(empacotarSom("sino"))?.url === null
);

const lixo = (texto: string) => new TextEncoder().encode(texto);

check("lixo que não é JSON não derruba nada", lerRecadoDeSom(lixo("nada disso")) === null);
check(
  "outro tipo de recado no mesmo canal é ignorado",
  lerRecadoDeSom(lixo(JSON.stringify({ tipo: "digitando", de: "x" }))) === null
);
/*
 * O caso que importa de verdade: alguém com o app mais novo aperta um som que
 * esta versão ainda não tem. Tem de virar silêncio, nunca exceção — uma exceção
 * dentro do handler de dados derruba a chamada de quem ficou para trás.
 */
check(
  "som desconhecido (app mais novo) vira silêncio, não erro",
  lerRecadoDeSom(lixo(JSON.stringify({ tipo: "som", id: "trompete-do-futuro" }))) === null
);
check(
  "e um id que não é texto também não passa",
  lerRecadoDeSom(lixo(JSON.stringify({ tipo: "som", id: 7 }))) === null
);

// ---------------------------------------------------------------------------
section("bandeja de sons — o endereço que chega pelo canal de dados");

/*
 * A parte perigosa do recurso, e o motivo de estes testes existirem.
 *
 * Um som que alguém subiu não pode ser sintetizado do outro lado — o arquivo é
 * dele. Então o recado carrega um ENDEREÇO, e quem recebe vai buscar e tocar.
 * Ou seja: qualquer pessoa da chamada consegue fazer o aparelho de todo mundo
 * baixar algo. Sem a validação, bastaria mandar um `https://` qualquer para
 * transformar cada participante em cliente de um servidor escolhido por ela —
 * e o dono desse servidor veria o IP de todos.
 *
 * A regra é: só passa endereço RELATIVO, com a forma exata que a nossa API
 * emite. O host final é montado do lado de cá, contra a nossa própria base.
 */
const comUrl = (url: unknown) =>
  lerRecadoDeSom(lixo(JSON.stringify({ tipo: "som", id: "abc123", url })));

check(
  "um endereço nosso passa, e volta junto com o id",
  comUrl("/files/9f8e7d6c-1234")?.url === "/files/9f8e7d6c-1234",
  "/files/9f8e7d6c-1234",
  comUrl("/files/9f8e7d6c-1234")?.url
);
check("e um som subido não precisa ser um id embutido", comUrl("/files/abc")?.id === "abc123");

for (const perigo of [
  "https://malicioso.example/rastreador.mp3",
  "http://127.0.0.1:9/algo.mp3",
  "//malicioso.example/x.mp3",
  "/files/../../etc/passwd",
  "/outra-rota/arquivo.mp3",
  "javascript:alert(1)",
  "data:audio/wav;base64,AAAA",
  "files/sem-barra",
  "/files/",
  ""
]) {
  check(`endereço recusado: ${JSON.stringify(perigo)}`, comUrl(perigo) === null, null, comUrl(perigo));
}
check("endereço que não é texto também cai", comUrl(42) === null);
/*
 * Um endereço ruim descarta o recado INTEIRO, em vez de cair para "toca o
 * embutido com esse id". Se caísse, um id embutido com url maliciosa tocaria —
 * e a próxima pessoa a mexer no código concluiria que a url é confiável.
 */
check(
  "url ruim invalida o recado todo, mesmo com id de embutido",
  lerRecadoDeSom(lixo(JSON.stringify({ tipo: "som", id: "sino", url: "https://x.example/a.mp3" }))) ===
    null
);

const empacotado = lerRecadoDeSom(empacotarSom("cuid123", "/files/xyz"));
check(
  "empacotar com endereço leva o endereço",
  empacotado?.id === "cuid123" && empacotado?.url === "/files/xyz",
  { id: "cuid123", url: "/files/xyz" },
  empacotado
);

check("ehEnderecoNosso aceita o que a API emite", ehEnderecoNosso("/files/abc-123_x.mp3"));
check("e recusa barra a mais", !ehEnderecoNosso("/files/a/b"));
check("ehSomId aceita os oito e recusa o resto", SONS.every((s) => ehSomId(s.id)) && !ehSomId("x"));

check(
  "todo som tem uma face para ser lido de relance",
  SONS.every((s) => s.face.length > 0)
);
check(
  "não há id repetido no catálogo",
  new Set(SONS.map((s) => s.id)).size === SONS.length
);

/*
 * A espera entre um som e outro. Sem ela a bandeja vira arma: alguém segura o
 * botão e ninguém mais consegue conversar.
 */
check("existe espera entre um som e outro", ESPERA_MS >= 1000, ">= 1000", ESPERA_MS);
check("e ela não é longa a ponto de matar a brincadeira", ESPERA_MS <= 5000, "<= 5000", ESPERA_MS);

// ---------------------------------------------------------------------------
section("bandeja de sons — o mesmo som em todo mundo");

/*
 * A promessa central: o som é gerado localmente em cada aparelho, então ele
 * TEM de sair idêntico. Se a percussão usasse `Math.random()`, cada pessoa
 * ouviria uma coisa diferente e ninguém descobriria — a chamada não tem como
 * comparar. Renderizar duas vezes e exigir bytes iguais é o que prende isso.
 */
for (const som of SONS) {
  const a = toDataUrl(som.passos);
  const b = toDataUrl(som.passos);
  check(`"${som.id}" sai byte a byte igual toda vez`, a === b && a.length > 100);
}

check(
  "os oito sons são diferentes entre si",
  new Set(SONS.map((s) => toDataUrl(s.passos))).size === SONS.length
);

// ---------------------------------------------------------------------------
section("bandeja de sons — favoritos por conversa");

/*
 * `localStorage` não existe em Node. As funções são escritas para sobreviver a
 * isso (modo privado do navegador faz o mesmo), então primeiro se confirma que
 * a falta dele degrada em vez de explodir — e só depois se coloca um de mentira
 * para verificar a ordenação.
 */
check("sem localStorage, os favoritos são uma lista vazia", favoritosDaSala("sala-1").length === 0);
check("e a bandeja sai na ordem do catálogo", ordenarBandeja("sala-1")[0].id === SONS[0].id);

const memoria = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => void memoria.set(k, v),
  removeItem: (k: string) => void memoria.delete(k)
};

salvarFavoritosDaSala("trabalho", ["sino", "erro"]);
salvarFavoritosDaSala("amigos", ["buzina"]);

check(
  "o favorito da conversa vai para a frente",
  ordenarBandeja("trabalho")[0].id === "sino",
  "sino",
  ordenarBandeja("trabalho")[0].id
);
check(
  "e o segundo favorito vem logo atrás, na ordem em que foi fixado",
  ordenarBandeja("trabalho")[1].id === "erro",
  "erro",
  ordenarBandeja("trabalho")[1].id
);
check(
  "cada conversa tem a sua — é essa a parte 'por grupo'",
  ordenarBandeja("amigos")[0].id === "buzina",
  "buzina",
  ordenarBandeja("amigos")[0].id
);
check(
  "uma conversa sem favorito não herda a das outras",
  ordenarBandeja("sala-nova")[0].id === SONS[0].id
);
check(
  "ordenar não perde nem duplica som nenhum",
  ordenarBandeja("trabalho").length === SONS.length &&
    new Set(ordenarBandeja("trabalho").map((s) => s.id)).size === SONS.length
);
/*
 * Um favorito gravado por uma versão mais nova (ou um localStorage adulterado)
 * não pode virar um botão fantasma na bandeja.
 */
memoria.set("whatscord.somsFavoritos.estranha", JSON.stringify(["sino", "som-que-nao-existe"]));
check(
  "favorito desconhecido é descartado na leitura",
  favoritosDaSala("estranha").join(",") === "sino",
  "sino",
  favoritosDaSala("estranha").join(",")
);
memoria.set("whatscord.somsFavoritos.torta", "{isto nao e json");
check("e um valor corrompido não derruba a bandeja", favoritosDaSala("torta").length === 0);

const ids: SomId[] = SONS.map((s) => s.id);
check("o catálogo continua com oito sons", ids.length === 8, 8, ids.length);

// ---------------------------------------------------------------------------
section("bandeja de sons — as regras de estilo que a bandeja depende");

/*
 * Mesma ideia da seção da tela esticada: o comportamento mora no CSS, então é
 * o CSS que se verifica. Não substitui olhar a tela — e a aparência continua
 * NÃO conferida em execução — mas impede a regressão silenciosa de alguém
 * limpar a folha e a bandeja virar uma coluna só.
 */
const regraDaGrade = /\.soundboard-grade\s*\{[^}]*\}/.exec(css)?.[0] ?? "";

check("a grade da bandeja existe na folha de estilo", regraDaGrade.length > 0);
/*
 * Três colunas FIXAS, e não `auto-fill`: a posição de cada som tem de ser a
 * mesma toda vez que a bandeja abre, porque a mão aprende o lugar antes de o
 * olho ler o nome. Uma grade que se reflui com a largura destrói isso.
 */
check(
  "são três colunas fixas, para o som não mudar de lugar entre uma abertura e outra",
  /grid-template-columns:\s*repeat\(3,\s*1fr\)/.test(regraDaGrade)
);
check(
  "o botão esmaece durante a espera, em vez de só ignorar o clique",
  /\.soundboard-som:disabled\s*\{[^}]*opacity:\s*0\.4/.test(css)
);
check(
  "o som fixado se distingue pela borda, sem trocar de cor de fundo",
  /\.soundboard-som\.fixado\s*\{[^}]*border-color:\s*var\(--accent-bright\)/.test(css)
);
check(
  "nome comprido não alarga a coluna e desalinha a grade",
  /\.soundboard-som em\s*\{[^}]*text-overflow:\s*ellipsis/.test(css)
);

// ---------------------------------------------------------------------------
section("silenciar a bandeja — para quem nao quer ouvir");

/*
 * O localStorage de mentira instalado na secao dos favoritos continua valendo
 * daqui para baixo.
 */
check("por padrao a bandeja toca", bandejaSilenciada() === false);
salvarBandejaSilenciada(true);
check("silenciada, fica silenciada", bandejaSilenciada() === true);
salvarBandejaSilenciada(false);
check("e volta a tocar quando desmarcado", bandejaSilenciada() === false);
/*
 * Desligar apaga a chave em vez de gravar "nao". Sem isso, todo mundo que
 * alguma vez abriu a bandeja carregaria uma entrada para sempre.
 */
salvarBandejaSilenciada(true);
salvarBandejaSilenciada(false);
check(
  "desligar nao deixa lixo guardado",
  memoria.get("whatscord.bandejaSilenciada") === undefined,
  undefined,
  memoria.get("whatscord.bandejaSilenciada")
);

// ---------------------------------------------------------------------------
section("volume por participante e por fonte");

/*
 * O ponto inteiro: a tela de alguem e a voz da MESMA pessoa sao dois volumes
 * diferentes. Se as duas coisas dividissem uma chave, abaixar o jogo mudo a
 * pessoa junto — que e exatamente o que o volume do sistema faz de errado e o
 * motivo de isto existir.
 */
const vozDoJoao = chaveDeAudio("joao", "microphone");
const telaDoJoao = chaveDeAudio("joao", "screen_share_audio");
check("voz e tela da mesma pessoa sao chaves diferentes", vozDoJoao !== telaDoJoao);

salvarVolume(telaDoJoao, 0.3);
check("a tela guardou o que foi escolhido", volumeDe(telaDoJoao) === 0.3, 0.3, volumeDe(telaDoJoao));
check(
  "e a voz da mesma pessoa continua intacta",
  volumeDe(vozDoJoao) === VOLUME_PADRAO,
  VOLUME_PADRAO,
  volumeDe(vozDoJoao)
);

salvarVolume(vozDoJoao, 0);
check("mudo e um volume valido, nao um valor invalido", volumeDe(vozDoJoao) === 0);
check("e nao vazou para a tela", volumeDe(telaDoJoao) === 0.3);

/*
 * O padrao nao fica guardado: a lista nao pode crescer para sempre com gente
 * que se ouviu uma vez, e "nunca mexi nisso" tem de continuar querendo dizer
 * isso.
 */
salvarVolume(telaDoJoao, VOLUME_PADRAO);
check(
  "voltar ao padrao apaga a entrada em vez de grava-la",
  memoria.get("whatscord.volume." + telaDoJoao) === undefined,
  undefined,
  memoria.get("whatscord.volume." + telaDoJoao)
);
check("e a leitura devolve o padrao", volumeDe(telaDoJoao) === VOLUME_PADRAO);

check("acima do teto e cortado no teto", limitarVolume(9) === VOLUME_MAX, VOLUME_MAX, limitarVolume(9));
check("abaixo de zero vira zero", limitarVolume(-3) === 0);
check("no meio passa intacto", limitarVolume(0.42) === 0.42);
/*
 * O teto e 1 porque passar disso exigiria tirar o som do elemento e manda-lo
 * por um GainNode, o que brigaria com a escolha de alto-falante (`setSinkId`
 * vive no elemento). Uma barra que anda ate 200% sem efeito acima de 100% seria
 * pior do que nao ter barra.
 */
check("o teto e 100%, e o codigo concorda com a barra", VOLUME_MAX === 1, 1, VOLUME_MAX);

/*
 * O fracasso que nao pode acontecer: silencio por acidente. Um valor ilegivel
 * no armazenamento tem de virar o PADRAO, nunca zero — a pessoa nao ouviria
 * ninguem, nao teria feito nada para isso e nao teria como desconfiar da causa.
 */
memoria.set("whatscord.volume." + chaveDeAudio("maria", "microphone"), "isto-nao-e-numero");
check(
  "valor corrompido volta ao padrao, e nao a zero",
  volumeDe(chaveDeAudio("maria", "microphone")) === VOLUME_PADRAO,
  VOLUME_PADRAO,
  volumeDe(chaveDeAudio("maria", "microphone"))
);
memoria.set("whatscord.volume." + chaveDeAudio("maria", "microphone"), "");
check(
  "vazio tambem volta ao padrao",
  volumeDe(chaveDeAudio("maria", "microphone")) === VOLUME_PADRAO,
  VOLUME_PADRAO,
  volumeDe(chaveDeAudio("maria", "microphone"))
);
memoria.set("whatscord.volume." + chaveDeAudio("maria", "microphone"), "5");
check(
  "um numero grande demais guardado por engano e cortado na leitura",
  volumeDe(chaveDeAudio("maria", "microphone")) === VOLUME_MAX
);

check("o rotulo mostra porcentagem inteira", rotuloDeVolume(0.35, "mudo") === "35%");
check("zero diz 'mudo', e nao '0%'", rotuloDeVolume(0, "mudo") === "mudo");
check("cem por cento tambem tem rotulo", rotuloDeVolume(1, "mudo") === "100%");

// ---------------------------------------------------------------------------
section("tela cheia — as regras de estilo do quadro ampliado");

check(
  "o tile em tela cheia larga a proporcao fixa da grade",
  /\.tile:fullscreen\s*\{[^}]*aspect-ratio:\s*auto/.test(css)
);
check(
  "e ocupa a tela inteira",
  /\.tile:fullscreen\s*\{[^}]*width:\s*100vw/.test(css) &&
    /\.tile:fullscreen\s*\{[^}]*height:\s*100vh/.test(css)
);
check(
  "o video continua encaixando por dentro, sem cortar",
  /\.tile:fullscreen video\s*\{[^}]*object-fit:\s*contain/.test(css)
);
/*
 * Em tela cheia o ponteiro costuma estar parado no meio do quadro. Se os
 * controles so aparecessem no hover, a pessoa que nao conhece o Esc ficaria
 * presa sem saida visivel.
 */
check(
  "em tela cheia os controles ficam sempre a vista",
  /\.tile\.cheia \.tile-acoes\s*\{[^}]*opacity:\s*1/.test(css)
);
/*
 * `opacity` e nao `display:none`: um elemento com `display:none` nao existe
 * para o Tab, e o botao de tela cheia precisa ser alcancavel pelo teclado.
 */
check(
  "os controles escondidos continuam alcancaveis pelo teclado",
  /\.tile-acoes\s*\{[^}]*opacity:\s*0/.test(css) &&
    !/\.tile-acoes\s*\{[^}]*display:\s*none/.test(css)
);
check(
  "e reaparecem quando algo dentro deles recebe foco",
  /\.tile:focus-within \.tile-acoes/.test(css)
);

// ---------------------------------------------------------------------------
section("quem está aqui — o agrupamento do painel de membros");

const pessoa = (id: string, displayName: string, role?: MembroCru["role"]): MembroCru => ({
  id,
  username: id,
  displayName,
  avatarUrl: null,
  role
});

const dona = pessoa("ana", "Ana", "OWNER");
const adm = pessoa("bia", "Bia", "ADMIN");
const carlos = pessoa("carlos", "Carlos", "MEMBER");
const dora = pessoa("dora", "Dora", "MEMBER");
const eu = pessoa("eu", "Eu", "MEMBER");
const todos = [dora, carlos, eu, adm, dona];

const semVoz = new Map();

{
  const g = agruparMembros(todos, new Set(["ana", "carlos", "eu"]), semVoz, "eu");
  const nomes = (grupo: string) =>
    g.find((x) => x.grupo === grupo)?.membros.map((m) => m.displayName) ?? [];

  check("quem administra e está online vai para o próprio grupo", nomes("administracao").join(",") === "Ana", "Ana", nomes("administracao").join(","));
  check(
    "membros online ficam em 'online', por nome",
    nomes("online").join(",") === "Carlos,Eu",
    "Carlos,Eu",
    nomes("online").join(",")
  );
  check(
    "quem não está aparece em offline — a lista também diz quem faz parte daqui",
    nomes("offline").join(",") === "Bia,Dora",
    "Bia,Dora",
    nomes("offline").join(",")
  );
  check("sem ninguém em chamada, o grupo 'chamada' nem aparece", !g.some((x) => x.grupo === "chamada"));
  check("a própria pessoa vem marcada", g.flatMap((x) => x.membros).find((m) => m.id === "eu")?.souEu === true);
  check("e as outras não", g.flatMap((x) => x.membros).find((m) => m.id === "ana")?.souEu === false);
  check(
    "os grupos saem sempre na mesma ordem",
    g.map((x) => x.grupo).join(",") === "administracao,online,offline",
    "administracao,online,offline",
    g.map((x) => x.grupo).join(",")
  );
  check("3 online, contando por grupo", contarOnline(g) === 3, 3, contarOnline(g));
}

/*
 * Dentro do grupo offline, quem administra também vem antes: a pessoa que se
 * procura para resolver algo tem de ser fácil de achar mesmo quando não está.
 */
{
  const g = agruparMembros(todos, new Set(), semVoz, null);
  const off = g.find((x) => x.grupo === "offline")?.membros.map((m) => m.displayName) ?? [];
  check(
    "todo mundo offline: dona, admin, depois membros por nome",
    off.join(",") === "Ana,Bia,Carlos,Dora,Eu",
    "Ana,Bia,Carlos,Dora,Eu",
    off.join(",")
  );
  check("com ninguém online, o contador diz 0", contarOnline(g) === 0);
}

/*
 * Estar em chamada PROVA presença. A presença de voz e a de conexão viajam por
 * caminhos diferentes e podem chegar fora de ordem — sem isto, alguém apareceria
 * em "Em chamada" e, um instante depois, também em "Offline".
 */
{
  const voz = vozPorPessoa({ "sala-1": ["dora", "ana"] }, new Map([["sala-1", "salve"]]));
  const g = agruparMembros(todos, new Set(["ana"]), voz, null);
  const emChamada = g.find((x) => x.grupo === "chamada")?.membros ?? [];
  check(
    "quem está numa sala de voz vai para 'chamada', mesmo sem evento de online",
    emChamada.map((m) => m.displayName).join(",") === "Ana,Dora",
    "Ana,Dora",
    emChamada.map((m) => m.displayName).join(",")
  );
  check("e é contada como online", emChamada.every((m) => m.online));
  check(
    "a linha sabe em que canal a pessoa está, e a sala para entrar junto",
    emChamada[1]?.canalDeVoz?.nome === "salve" && emChamada[1]?.canalDeVoz?.salaId === "sala-1"
  );
  check("Dora não aparece também em offline", !(g.find((x) => x.grupo === "offline")?.membros.some((m) => m.id === "dora")));
  check("'chamada' vem primeiro na ordem", g[0].grupo === "chamada");
}

/*
 * A virada de "sala → ids" para "id → canal". Sala que não é deste espaço não
 * conta, e uma pessoa em duas salas (dois aparelhos) fica com a primeira.
 */
{
  const voz = vozPorPessoa(
    { "sala-1": ["ana"], "sala-2": ["ana", "bia"], "de-outro-espaco": ["carlos"] },
    new Map([["sala-1", "geral"], ["sala-2", "salve"]])
  );
  check("sala desconhecida é ignorada", !voz.has("carlos"));
  check("pessoa em duas salas fica com a primeira", voz.get("ana")?.nome === "geral", "geral", voz.get("ana")?.nome);
  check("e quem está só na segunda fica nela", voz.get("bia")?.nome === "salve");
}

check("um espaço vazio não produz grupo nenhum", agruparMembros([], new Set(), semVoz, null).length === 0);
check("a ordem dos grupos tem quatro posições fixas", ORDEM_DOS_GRUPOS.join(",") === "chamada,administracao,online,offline");

// O localStorage de mentira instalado mais acima continua valendo.
check("o painel nasce aberto", painelDeMembrosAberto() === true);
salvarPainelDeMembros(false);
check("fechado, fica fechado", painelDeMembrosAberto() === false);
salvarPainelDeMembros(true);
check("reabrir apaga a chave em vez de gravar 'aberto'", memoria.get("whatscord.painelDeMembros") === undefined);

// ---------------------------------------------------------------------------
section("contadores do rail — cada um responde a uma pergunta diferente");

const salas = [
  { unread: 2, space: null },                 // conversa direta
  { unread: 0, space: null },                 // grupo sem nada
  { unread: 3, space: { id: "trabalho" } },   // canal do espaco "trabalho"
  { unread: 4, space: { id: "trabalho" } },
  { unread: 1, space: { id: "amigos" } },
  { unread: 0, space: { id: "vazio" } }
];

/*
 * O defeito que existia: o botao de conversas somava TUDO (10) e mentia. Quem
 * clicava nao achava nada novo la e concluia que o contador estava quebrado.
 */
check("botao de conversas conta so o que esta fora dos espacos", naoLidasForaDosEspacos(salas) === 2, 2, naoLidasForaDosEspacos(salas));

const porEspaco = naoLidasPorEspaco(salas);
check("cada espaco soma os proprios canais", porEspaco.get("trabalho") === 7, 7, porEspaco.get("trabalho"));
check("um canal so tambem conta", porEspaco.get("amigos") === 1);
check("espaco sem nada nem entra no mapa — sem zero para desenhar", !porEspaco.has("vazio"));

check("na vista de conversas, o filtro 'nao lidas' conta as conversas", naoLidasNaVista(salas, null) === 2);
check("dentro de um espaco, conta so aquele espaco", naoLidasNaVista(salas, "trabalho") === 7, 7, naoLidasNaVista(salas, "trabalho"));
check("num espaco sem nada, zero", naoLidasNaVista(salas, "vazio") === 0);

/*
 * Pasta fechada esconde os chips e, com eles, os contadores. Sem a soma,
 * guardar um espaco numa pasta seria a mesma coisa que silencia-lo.
 */
check("a pasta soma o que tem dentro", somarEspacos(porEspaco, ["trabalho", "amigos"]) === 8, 8, somarEspacos(porEspaco, ["trabalho", "amigos"]));
check("espaco desconhecido na pasta vale zero, nao erro", somarEspacos(porEspaco, ["trabalho", "sumiu"]) === 7);
check("pasta vazia soma zero", somarEspacos(porEspaco, []) === 0);

check("ate 99 mostra o numero", rotuloDeContador(99) === "99");
check("acima disso, '99+' — tres digitos nao cabem num circulo de 18px", rotuloDeContador(100) === "99+");

// ---------------------------------------------------------------------------
section("supressao de ruido — a escolha vira restricao de captura");

check("tres niveis, nesta ordem", SUPRESSOES.join(",") === "padrao,avancada,desligada");
check("o padrao e a supressao do navegador — o que o app sempre fez", SUPRESSAO_PADRAO === "padrao");
check("valor guardado desconhecido volta ao padrao", supressaoOuPadrao("krisp") === "padrao");
check("ausente tambem", supressaoOuPadrao(undefined) === "padrao");
check("ehSupressao recusa lixo", !ehSupressao("") && !ehSupressao(1) && ehSupressao("avancada"));

/*
 * A regra que nao e obvia e que o filtro Krisp do LiveKit tambem aplica: com a
 * AVANCADA ligada, a supressao do navegador tem de sair. Dois supressores em
 * cadeia nao somam — o segundo recebe o sinal ja mastigado pelo primeiro.
 */
check("padrao: a do navegador fica ligada", restricoesDeCaptura("padrao").noiseSuppression === true);
check("padrao: voiceIsolation tambem", restricoesDeCaptura("padrao").voiceIsolation === true);
check("avancada DESLIGA a do navegador para nao empilhar dois supressores", restricoesDeCaptura("avancada").noiseSuppression === false);
check("avancada desliga voiceIsolation pelo mesmo motivo", restricoesDeCaptura("avancada").voiceIsolation === false);
check("desligada: nada", restricoesDeCaptura("desligada").noiseSuppression === false && restricoesDeCaptura("desligada").voiceIsolation === false);

check("so a avancada pede o processador neural", usaProcessador("avancada") && !usaProcessador("padrao") && !usaProcessador("desligada"));

// ---------------------------------------------------------------------------
section("compartilhar tela — as restricoes que vao DIRETO ao navegador");

/*
 * O LiveKit descartava duas chaves ao montar o getDisplayMedia. A queixa real:
 * "queria compartilhar so o Valorant, e foi o audio do sistema inteiro". Com
 * `windowAudio: "window"` (Chrome 141+), escolher uma janela oferece so o som
 * dela. Estas linhas prendem as chaves que nao podem sumir de novo.
 */
const r1080 = restricoesDeTela({ resolucao: 1080, fps: 60 });
check("pede audio", r1080.audio === true);
check("janela: so o som da janela", r1080.windowAudio === "window", "window", r1080.windowAudio);
check("tela inteira: o som do sistema continua sendo oferecido", r1080.systemAudio === "include");
check("quem compartilha nao ouve o proprio som dobrado", r1080.suppressLocalAudioPlayback === true);
check("a propria aba do app fica fora da lista", r1080.selfBrowserSurface === "exclude");
check("da para trocar a superficie sem parar", r1080.surfaceSwitching === "include");
check(
  "a resolucao vai como ideal, nunca como exigencia",
  typeof r1080.video === "object" && r1080.video.width?.ideal === 1920 && r1080.video.height?.ideal === 1080 && r1080.video.frameRate === 60
);
const rFonte = restricoesDeTela({ resolucao: 0, fps: 30 });
check(
  "'fonte' leva o teto de 8K e a taxa escolhida (o conserto do FPS continua valendo por aqui)",
  typeof rFonte.video === "object" && rFonte.video.height?.ideal === 4320 && rFonte.video.frameRate === 30
);

// ---------------------------------------------------------------------------
section("audio de janela — saber se ESTE navegador oferece");

/*
 * Por versao, e nao por `getSupportedConstraints()`: medido no Chrome 152, ele
 * devolve `systemAudio: false` — porque so lista restricoes de TRILHA, e as
 * opcoes do getDisplayMedia nao sao trilha. A primeira versao da deteccao
 * responderia "nao" para sempre e a frase de ajuda mentiria.
 */
const UA_WEBVIEW2 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0";
const UA_CHROME_140 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const UA_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0";
const UA_SAFARI_IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

check("le a versao da WebView2 (que se apresenta como Chrome e Edg)", versaoDoChromium(UA_WEBVIEW2) === 153, 153, versaoDoChromium(UA_WEBVIEW2));
check("Firefox nao e Chromium", versaoDoChromium(UA_FIREFOX) === null);
check("Safari nao e Chromium", versaoDoChromium(UA_SAFARI_IPAD) === null);
check("o limiar e o Chrome 141", CHROMIUM_COM_AUDIO_DE_JANELA === 141);
check("WebView2 153 oferece audio de janela", suportaAudioDeJanela(UA_WEBVIEW2) === true);
check("Chrome 140 nao", suportaAudioDeJanela(UA_CHROME_140) === false);
check("Firefox nao", suportaAudioDeJanela(UA_FIREFOX) === false);

// ---------------------------------------------------------------------------
section("atualizacao do app desktop — onde ela existe");

/*
 * O APK tambem e Tauri e tambem tem `__TAURI_INTERNALS__`, mas o plugin de
 * atualizacao nao e registrado la. Se a deteccao olhasse so a variavel, o
 * Android ganharia uma secao em Configuracoes cujo botao so da erro.
 */
const UA_ANDROID_WEBVIEW = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36";
const UA_ANDROID_MINUSCULO = "mozilla/5.0 (linux; android 13) applewebkit/537.36";

check("app desktop (WebView2 com Tauri) tem atualizacao", ehAppDesktop(true, UA_WEBVIEW2) === true);
check("navegador comum (sem Tauri) nao tem", ehAppDesktop(false, UA_CHROME_140) === false);
check("Firefox sem Tauri nao tem", ehAppDesktop(false, UA_FIREFOX) === false);
check("APK (Tauri no Android) nao tem", ehAppDesktop(true, UA_ANDROID_WEBVIEW) === false);
check("e o teste do Android ignora maiusculas", ehAppDesktop(true, UA_ANDROID_MINUSCULO) === false);
check("Chrome no celular Android, sem Tauri, nao tem", ehAppDesktop(false, UA_ANDROID_WEBVIEW) === false);

// ---------------------------------------------------------------------------
section("atualizacao do app desktop — de quanto em quanto tempo procurar");

const HORA = 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 8, 17, 12, 0, 0);

check("o intervalo e de 2 horas (o app vive dias na bandeja)", INTERVALO_ENTRE_VERIFICACOES_MS === 2 * HORA, 2 * HORA, INTERVALO_ENTRE_VERIFICACOES_MS);
check(
  "a primeira verificacao espera alguns segundos (nao segura a abertura)",
  ESPERA_ANTES_DE_VERIFICAR_MS >= 3000 && ESPERA_ANTES_DE_VERIFICAR_MS <= 30_000,
  "entre 3 e 30 s",
  ESPERA_ANTES_DE_VERIFICAR_MS
);
check("nunca verificou: procura", deveVerificar(null, AGORA) === true);
check("verificou agora mesmo: nao procura", deveVerificar(AGORA, AGORA) === false);
check("verificou ha 1h59: nao procura", deveVerificar(AGORA - 2 * HORA + 60_000, AGORA) === false);
check("verificou ha exatamente 2h: procura", deveVerificar(AGORA - 2 * HORA, AGORA) === true);
check("verificou ontem: procura", deveVerificar(AGORA - 24 * HORA, AGORA) === true);
check(
  "marca no futuro (relogio voltou) nao cala a verificacao",
  deveVerificar(AGORA + 3 * 24 * HORA, AGORA) === true
);
check("marca ilegivel (NaN) conta como nunca", deveVerificar(Number.NaN, AGORA) === true);

// O localStorage de mentira instalado mais acima continua valendo.
memoria.delete("whatscord.atualizacao.ultimaVerificacao");
check("sem marca gravada, a ultima verificacao e null", ultimaVerificacao() === null);
marcarVerificacao(AGORA);
check("a marca gravada volta igual", ultimaVerificacao() === AGORA, AGORA, ultimaVerificacao());
check("e com ela, uma hora depois, nao procura", deveVerificar(ultimaVerificacao(), AGORA + HORA) === false);
memoria.set("whatscord.atualizacao.ultimaVerificacao", "");
check("marca vazia e null, nao 1970", ultimaVerificacao() === null, null, ultimaVerificacao());
memoria.set("whatscord.atualizacao.ultimaVerificacao", "ontem");
check("marca corrompida e null", ultimaVerificacao() === null, null, ultimaVerificacao());

/*
 * Um localStorage que LANCA (modo privado, cota estourada) nao pode derrubar a
 * abertura do app: le como "nunca verificou" e a gravacao some em silencio.
 */
const lsDeMentira = (globalThis as { localStorage?: unknown }).localStorage;
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {}
};
let explodiu = false;
try {
  marcarVerificacao(AGORA);
  check("localStorage que lanca: a leitura vira null", ultimaVerificacao() === null);
} catch {
  explodiu = true;
}
check("e nada explode", explodiu === false);
(globalThis as { localStorage?: unknown }).localStorage = lsDeMentira;

// ---------------------------------------------------------------------------
section("atualizacao do app desktop — progresso do download");

function rodar(eventos: EventoDeDownload[]): Progresso {
  return eventos.reduce(aplicarEvento, PROGRESSO_INICIAL);
}

check("antes de comecar nao ha porcentagem", porcentagem(PROGRESSO_INICIAL) === null);

const comTotal = rodar([{ event: "Started", data: { contentLength: 1000 } }]);
check("comecou com tamanho conhecido: 0%", porcentagem(comTotal) === 0, 0, porcentagem(comTotal));

const metade = rodar([
  { event: "Started", data: { contentLength: 1000 } },
  { event: "Progress", data: { chunkLength: 300 } },
  { event: "Progress", data: { chunkLength: 200 } }
]);
check("soma os pedacos: 500 de 1000 = 50%", porcentagem(metade) === 50, 50, porcentagem(metade));

const quase = rodar([
  { event: "Started", data: { contentLength: 1000 } },
  { event: "Progress", data: { chunkLength: 999 } }
]);
check("arredonda para baixo: 99,9% mostra 99", porcentagem(quase) === 99, 99, porcentagem(quase));

const tudoSemFinished = rodar([
  { event: "Started", data: { contentLength: 1000 } },
  { event: "Progress", data: { chunkLength: 1000 } }
]);
check(
  "todos os bytes chegaram mas sem Finished: ainda 99, nao 100",
  porcentagem(tudoSemFinished) === 99,
  99,
  porcentagem(tudoSemFinished)
);

const terminou = rodar([
  { event: "Started", data: { contentLength: 1000 } },
  { event: "Progress", data: { chunkLength: 1000 } },
  { event: "Finished" }
]);
check("Finished: 100%", porcentagem(terminou) === 100, 100, porcentagem(terminou));

const passou = rodar([
  { event: "Started", data: { contentLength: 1000 } },
  { event: "Progress", data: { chunkLength: 5000 } }
]);
check("servidor mandou mais que o anunciado: nao passa de 99", porcentagem(passou) === 99, 99, porcentagem(passou));

const semTamanho = rodar([
  { event: "Started", data: {} },
  { event: "Progress", data: { chunkLength: 4096 } }
]);
check("sem contentLength: porcentagem desconhecida (null)", porcentagem(semTamanho) === null, null, porcentagem(semTamanho));
check("mas os bytes baixados continuam contados", semTamanho.baixado === 4096, 4096, semTamanho.baixado);
check(
  "sem contentLength e Finished: 100%",
  porcentagem(aplicarEvento(semTamanho, { event: "Finished" })) === 100
);

const tamanhoZero = rodar([
  { event: "Started", data: { contentLength: 0 } },
  { event: "Progress", data: { chunkLength: 10 } }
]);
check("contentLength 0 e tratado como desconhecido (sem dividir por zero)", porcentagem(tamanhoZero) === null, null, porcentagem(tamanhoZero));

const recomecou = rodar([
  { event: "Started", data: { contentLength: 1000 } },
  { event: "Progress", data: { chunkLength: 800 } },
  { event: "Started", data: { contentLength: 2000 } }
]);
check("um Started novo zera a contagem", recomecou.baixado === 0 && porcentagem(recomecou) === 0);

const pedacoRuim = rodar([
  { event: "Started", data: { contentLength: 1000 } },
  { event: "Progress", data: { chunkLength: Number.NaN } },
  { event: "Progress", data: { chunkLength: -50 } },
  { event: "Progress", data: { chunkLength: 100 } }
]);
check("pedaco NaN ou negativo nao estraga a soma", pedacoRuim.baixado === 100, 100, pedacoRuim.baixado);
check("aplicarEvento nao altera o progresso inicial", PROGRESSO_INICIAL.baixado === 0 && PROGRESSO_INICIAL.total === null);

// ---------------------------------------------------------------------------
section("atualizacao do app desktop — que tipo de erro foi");

check("sem internet (navigator.onLine falso) e offline, seja qual for o texto", tipoDeErro(new Error("qualquer coisa"), false) === "offline");
check(
  "nenhuma release publicada (texto do plugin)",
  tipoDeErro("Could not fetch a valid release JSON from the remote") === "sem-versao-publicada"
);
check(
  "release sem build para esta plataforma conta como nao publicada",
  tipoDeErro("the platform `windows-x86_64` was not found in the response `platforms` object") === "sem-versao-publicada"
);
check(
  "erro de rede do reqwest",
  tipoDeErro("error sending request for url (https://github.com/x/latest.json)") === "offline"
);
check(
  "assinatura que nao decodifica",
  tipoDeErro(new Error("The signature abc could not be decoded, please check if it is a valid base64 string.")) === "assinatura"
);
check("assinatura invalida", tipoDeErro("Invalid signature") === "assinatura");
check("o resto cai em outro", tipoDeErro("Failed to install package") === "outro");
check("undefined nao explode", tipoDeErro(undefined) === "outro");
check("objeto qualquer nao explode", tipoDeErro({ codigo: 1 }) === "outro");

// ---------------------------------------------------------------------------
section("atualizacao — QUANDO instalar sem estragar nada");

/*
 * O Windows FECHA o app para instalar. Estes testes prendem a regra que impede
 * uma atualizacao de derrubar uma chamada ou apagar uma mensagem pela metade —
 * e a que decide instalar ao abrir, ao sair e quando ninguem esta usando, como
 * Discord, Teams, Chrome e o electron-updater fazem (docs/decisoes.md).
 */
const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const base = {
  emChamada: false,
  temRascunho: false,
  janelaVisivel: true,
  ociosoMs: 0,
  desdeQueAbriuMs: 60 * MIN,
  interagiuDesdeQueAbriu: true,
  pendenteHaMs: 0,
  automatico: true,
  adiadoAte: null as number | null,
  agora: AGORA
};

// chamada
check("em chamada: ESPERA, mesmo escondido e parado ha horas", decidirInstalacao({ ...base, emChamada: true, janelaVisivel: false, ociosoMs: 5 * 60 * MIN }) === "esperar");
check("em chamada logo ao abrir: espera tambem", decidirInstalacao({ ...base, emChamada: true, desdeQueAbriuMs: 5_000, interagiuDesdeQueAbriu: false }) === "esperar");
check("em chamada ha uma semana de pendencia: espera mesmo assim", decidirInstalacao({ ...base, emChamada: true, pendenteHaMs: 30 * DIA }) === "esperar");

// preferencia e rascunho
check("automatico desligado: so avisa, mesmo escondido e ocioso", decidirInstalacao({ ...base, automatico: false, janelaVisivel: false, ociosoMs: 60 * MIN }) === "avisar");
check("rascunho: avisa, nunca reinicia (nem logo ao abrir)", decidirInstalacao({ ...base, temRascunho: true, desdeQueAbriuMs: 5_000, interagiuDesdeQueAbriu: false }) === "avisar");

// ao abrir (Discord)
check("acabou de abrir e ninguem tocou em nada: instala JA, sem contagem", decidirInstalacao({ ...base, desdeQueAbriuMs: 5_000, interagiuDesdeQueAbriu: false }) === "instalar-ja");
check("acabou de abrir, mas a pessoa ja comecou a usar: so avisa", decidirInstalacao({ ...base, desdeQueAbriuMs: 5_000, interagiuDesdeQueAbriu: true }) === "avisar");
check("no limite da janela de abertura, sem toque: ainda instala", decidirInstalacao({ ...base, desdeQueAbriuMs: JANELA_DE_ABERTURA_MS, interagiuDesdeQueAbriu: false }) === "instalar-ja");
check("passou da janela de abertura: nao vale mais essa regra", decidirInstalacao({ ...base, desdeQueAbriuMs: JANELA_DE_ABERTURA_MS + 1, interagiuDesdeQueAbriu: false }) === "avisar");

// ninguem olhando (Teams)
check("escondido na bandeja e parado 2 min: instala ja", decidirInstalacao({ ...base, janelaVisivel: false, ociosoMs: OCIOSO_ESCONDIDO_MS }) === "instalar-ja");
check("escondido mas mexeram ha 1 min: avisa", decidirInstalacao({ ...base, janelaVisivel: false, ociosoMs: MIN }) === "avisar");
check("escondido e parado vale MESMO adiado — adiar e sobre nao interromper o uso", decidirInstalacao({ ...base, janelaVisivel: false, ociosoMs: 30 * MIN, adiadoAte: AGORA + MIN }) === "instalar-ja");

// a vista
check("a vista e parado 10 min: instala COM contagem", decidirInstalacao({ ...base, ociosoMs: OCIOSO_VISIVEL_MS }) === "instalar-com-contagem");
check("a vista e parado 9 min: avisa", decidirInstalacao({ ...base, ociosoMs: OCIOSO_VISIVEL_MS - MIN }) === "avisar");
check("a vista, parado, mas adiado no prazo: respeita", decidirInstalacao({ ...base, ociosoMs: 30 * MIN, adiadoAte: AGORA + MIN }) === "avisar");
check("adiamento vencido: volta a valer", decidirInstalacao({ ...base, ociosoMs: 30 * MIN, adiadoAte: AGORA - 1 }) === "instalar-com-contagem");

// escalonamento (Chrome)
check("pendente ha 7 dias: proximo momento seguro, sem esperar ociosidade", decidirInstalacao({ ...base, pendenteHaMs: PENDENTE_LIMITE_MS }) === "instalar-com-contagem");
check("pendente ha 6 dias e em uso: ainda so avisa", decidirInstalacao({ ...base, pendenteHaMs: 6 * DIA }) === "avisar");
check("adiar dura 1 h no comeco", adiarPorMs(0) === 60 * MIN);
check("e 15 min depois de 2 dias pendente", adiarPorMs(PENDENTE_ESCALA_MS) === 15 * MIN);
check("os limites sobem em ordem: 2 dias antes de 7", PENDENTE_ESCALA_MS < PENDENTE_LIMITE_MS);
check("escondido exige menos ociosidade que visivel", OCIOSO_ESCONDIDO_MS < OCIOSO_VISIVEL_MS);
check("a contagem da tempo de reagir (5 a 30 s)", CONTAGEM_MS >= 5_000 && CONTAGEM_MS <= 30_000);

// ao sair (electron-updater)
check("ao sair com versao baixada e automatico: instala", instalarAoSair("pronta", true) === true);
check("ao sair ainda baixando: nao — baixar na saida faria o Sair demorar", instalarAoSair("baixando", true) === false);
check("ao sair com automatico desligado: nao", instalarAoSair("pronta", false) === false);
check("ao sair sem nada pendente: nao", instalarAoSair("em-dia", true) === false);

// rascunho
check("texto na caixa de mensagem SEM foco conta (digitou e clicou fora)", haRascunho({ value: "oi, tudo" }, { tagName: "BUTTON" }) === true);
check("input com foco e texto conta", haRascunho(null, { tagName: "input", value: "busca" }) === true);
check("so espacos nao e rascunho", haRascunho({ value: "   " }, null) === false);
check("foco num botao com a caixa vazia nao e rascunho", haRascunho({ value: "" }, { tagName: "BUTTON", value: "x" }) === false);
check("sem caixa e sem foco nao e rascunho", haRascunho(null, null) === false);

// armazenamento (o localStorage de mentira instalado mais acima continua valendo)
memoria.delete("whatscord.atualizarSozinho");
check("automatico nasce LIGADO", atualizarAutomaticamente() === true);
salvarAtualizarAutomaticamente(false);
check("desligado, fica desligado", atualizarAutomaticamente() === false);
salvarAtualizarAutomaticamente(true);
check("religar apaga a chave", memoria.get("whatscord.atualizarSozinho") === undefined);

limparAdiamento();
check("sem adiamento gravado: null", adiadoAte() === null);
check("adiar no comeco grava agora + 1 h", adiar(AGORA, 0) === AGORA + 60 * MIN && adiadoAte() === AGORA + 60 * MIN);
check("adiar depois de 3 dias grava agora + 15 min", adiar(AGORA, 3 * DIA) === AGORA + 15 * MIN);
limparAdiamento();
memoria.set("whatscord.atualizacaoAdiadaAte", "amanha");
check("adiamento corrompido e null, nao 'adiado para sempre'", adiadoAte() === null);

/*
 * A data em que a versao foi vista sobrevive a reinicios — sem isso o
 * escalonamento zeraria a cada abertura e nunca chegaria aos 7 dias.
 */
memoria.delete("whatscord.atualizacaoVistaEm");
check("primeira vez que ve a 0.2.1: grava agora", vistaPelaPrimeiraVez("0.2.1", AGORA) === AGORA);
check("dias depois, a mesma versao guarda a data original", vistaPelaPrimeiraVez("0.2.1", AGORA + 3 * DIA) === AGORA);
check("uma versao DIFERENTE recomeca a contagem", vistaPelaPrimeiraVez("0.2.2", AGORA + 4 * DIA) === AGORA + 4 * DIA);
memoria.set("whatscord.atualizacaoVistaEm", "{nao e json");
check("marca corrompida recomeca desde agora, sem quebrar", vistaPelaPrimeiraVez("0.2.2", AGORA + 5 * DIA) === AGORA + 5 * DIA);
memoria.set("whatscord.atualizacaoVistaEm", JSON.stringify({ versao: "0.2.3", em: AGORA + 99 * DIA }));
check("marca no futuro (relogio voltou) nao conta como 'pendente ha muito tempo'", vistaPelaPrimeiraVez("0.2.3", AGORA) === AGORA);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passaram, ${failures.length} falharam`);
if (failures.length) {
  console.log("\nfalhas:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
