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
  proximoFacingMode,
  resolveDeviceId,
  selectableDevices,
  trocouDeCamera
} from "../apps/web/src/lib/devices";
import {
  CUES,
  cueDataUrl,
  encodeWav,
  renderTone,
  toBase64,
  type ToneStep
} from "../apps/web/src/lib/sounds";
import {
  captureOptions,
  loadShareMode,
  publishOptions,
  type ShareMode
} from "../apps/web/src/lib/screenshare";

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
section("compartilhamento de tela — o que se pede ao navegador");

for (const mode of ["text", "motion"] as ShareMode[]) {
  const c = captureOptions(mode);
  check(`[${mode}] pede áudio junto`, c.audio === true);
  check(
    `[${mode}] pede que o som do sistema seja OFERECIDO no diálogo`,
    c.systemAudio === "include",
    "include",
    c.systemAudio
  );
  check(
    `[${mode}] não oferece compartilhar a própria aba (efeito túnel)`,
    c.selfBrowserSurface === "exclude"
  );
  check(
    `[${mode}] deixa trocar a aba compartilhada sem recomeçar`,
    c.surfaceSwitching === "include"
  );
  check(
    `[${mode}] evita eco do próprio áudio em quem compartilha`,
    c.suppressLocalAudioPlayback === true
  );
}

check(
  "texto pede contentHint 'text' (preserva borda, não borra letra)",
  captureOptions("text").contentHint === "text",
  "text",
  captureOptions("text").contentHint
);
check(
  "movimento pede contentHint 'motion'",
  captureOptions("motion").contentHint === "motion"
);

// ---------------------------------------------------------------------------
section("compartilhamento de tela — como se publica");

/*
 * A correção que mais pesa: o padrão do LiveKit publica três camadas e reparte
 * entre elas o mesmo teto de banda, então a camada boa recebia uma fração dos
 * 2.5 Mbps. Se este teste falhar, a qualidade regrediu.
 */
for (const mode of ["text", "motion"] as ShareMode[]) {
  check(`[${mode}] simulcast DESLIGADO na tela`, publishOptions(mode).simulcast === false);
  check(
    `[${mode}] banda declarada é positiva`,
    publishOptions(mode).screenShareEncoding.maxBitrate > 0
  );
}

check(
  "texto prioriza resolução (letra ilegível é pior que letra que atualiza devagar)",
  publishOptions("text").degradationPreference === "maintain-resolution",
  "maintain-resolution",
  publishOptions("text").degradationPreference
);
check(
  "movimento prioriza taxa de quadros (engasgar é pior que perder nitidez)",
  publishOptions("motion").degradationPreference === "maintain-framerate"
);
check(
  "movimento tem mais quadros por segundo que texto",
  publishOptions("motion").screenShareEncoding.maxFramerate >
    publishOptions("text").screenShareEncoding.maxFramerate,
  "motion > text",
  {
    motion: publishOptions("motion").screenShareEncoding.maxFramerate,
    text: publishOptions("text").screenShareEncoding.maxFramerate
  }
);
check(
  "movimento reserva mais banda que texto",
  publishOptions("motion").screenShareEncoding.maxBitrate >
    publishOptions("text").screenShareEncoding.maxBitrate
);

// Sem localStorage (é o caso aqui no node) nada pode explodir: cai no padrão.
check(
  "sem armazenamento disponível, o modo padrão é 'text'",
  loadShareMode() === "text",
  "text",
  loadShareMode()
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
console.log(`\n${passed} passaram, ${failures.length} falharam`);
if (failures.length) {
  console.log("\nfalhas:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
