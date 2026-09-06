# WhatsCord — decisões de arquitetura

Base: 10 agentes de pesquisa, 05/09/2026. Fontes nos relatórios citados ao longo.

## Fechado

| Peça | Decisão | Por quê |
|---|---|---|
| Plataforma v1 | **Windows only** | Decisão do cliente. É o que torna o Tauri barato. |
| Shell desktop | **Tauri v2** | Com Windows-only, `getDisplayMedia` funciona direto na webview do WebView2 (Chromium). Custo de screen share ≈ zero. |
| Mídia | **LiveKit self-hosted** | Binário único, Apache-2.0, TURN embutido, screen share como track separado (1080p30 @ 5 Mbps). Rota de fuga paga sem trocar código. |
| UI do cliente | **React 19 + TS + Vite** | Ecossistema. Espelho: Signal Desktop é React 19 + `@tanstack/react-virtual` + SQLCipher. |
| Lista de mensagens | **TanStack Virtual** | Idem Signal. |
| Dados/sync | **Postgres + WebSocket + SQLite local + outbox idempotente** | Chat é log append-only ordenado. Sync engine não se paga. |
| Cursor de sync | **`GET /sync?since=<seq>` por conversa** | Modelo do Simplified Sliding Sync do Matrix. |
| E2EE | **Não na v1** | libsignal é AGPL-only; MLS custa meses. Caminho futuro: `matrix-sdk-crypto` (Apache-2.0). |
| Arquivos | **Volume local ao lado da API** | Escolha original era MinIO; ele nao subiu neste host (ver `operacao.md`). O driver em `lib/storage.ts` aceita S3 tambem — definir as variaveis S3_* troca sem mexer em mais nada. |

## Rejeitado, com motivo

**Stack completa do Stoat neste VPS** — 16 containers sem `mem_limit`, MongoDB dimensionando cache
WiredTiger por RAM do host, RabbitMQ com watermark de 40% do host, e um Caddy que duplica o Traefik.
A máquina já tem 105 containers de outros projetos. Risco de OOM neles, não em nós.
*O Stoat em si passou na due diligence* — voz/vídeo/screenshare funcionam self-hosted (LiveKit v1.9.13
no compose deles desde fev/2026), API tem 87 rotas / 131 operações, `Channel.joinCall()` devolve
URL+token do LiveKit. Se um dia houver VPS separada, a rota é válida.

**Sync engines** — Zero 1.0 não faz escrita offline (matador para "não perder mensagem quando cai a
rede"); Electric foi comprada pela Databricks em ago/2026 e virou foco de IA; InstantDB foi acqui-hired
pela OpenAI e encerra em 2027; Replicache virou closed-source na v10. PowerSync é o único que eu
consideraria, mas o SDK Tauri é alpha sobre Rust SDK pre-alpha.

**CRDTs (Automerge, Yjs, Jazz, Evolu)** — ferramenta errada. Ninguém edita a mesma mensagem
concorrentemente.

**Matrix (tuwunel / continuwuity / Synapse)** — tuwunel é tecnicamente o mais elegante (Apache-2.0,
1 binário + RocksDB, patrocínio estatal, MatrixRTC já é LiveKit). Rejeitado pelo modelo de dados:
DAG de eventos e state resolution para uma UI estilo Discord é atrito grande, "servidor com canais"
vira Spaces + Rooms na mão, e não foi possível confirmar suporte a Simplified Sliding Sync — sem
isso o sync inicial de um cliente novo dói.

**Rocket.Chat** (replica set MongoDB de 3 nós, ~8 GiB de baseline) · **Zulip** (quer a máquina
inteira; modelo é stream+topic, não canais) · **Mattermost** (fonte AGPL ou licença comercial) ·
**Appwrite** (realtime não faz fan-out server-side) · **PocketBase** (sem presence, sem canal
cliente→servidor) · **SimpleX / Nostr** (sem contas / sem grupo durável) · **Spacebar** (API do
Discord, mas em "Development" e com WebRTC próprio que conflita com LiveKit) ·
**Bun/Elysia** (vazamentos de memória documentados em produção em 2026).

## A armadilha de infra que quase pegamos

Todo tutorial de LiveKit manda abrir `50000-60000/udp`. São ~10.000 mapeamentos DNAT no Docker —
o `iptables-restore` do dockerd leva minutos, start/stop de container trava, memória explode.
Numa máquina com 105 containers isso derruba os vizinhos.

**Solução: ICE/UDP mux.** `udp_port: 7882` (ou faixa pequena dimensionada por vCPU, não por
participante). O próprio Stoat já reduziu para 50000-50100 — ainda são 100 mapeamentos, ainda demais.

`network_mode: host` (recomendado pela doc do LiveKit) **não** serve no Coolify: issue #10099 aberta
relata a flag sendo descartada em silêncio, e o container sai da rede do Traefik.

Receita completa em `livekit-coolify.md`.

## Aberto

1. **Linguagem do backend** — ver a discussão abaixo.
2. **Áudio do sistema** no screen share (o som do que está na tela, não só o microfone). Não vem de
   graça em nenhum caminho; o próprio Hopp não faz. Trabalho não estimado.
3. Rodar o checklist de diagnóstico no VPS antes de subir qualquer coisa (exige SSH — a API do
   Coolify não executa comandos).

## Sobre a linguagem do backend

O que o backend precisa fazer é pequeno: auth, CRUD de salas e mensagens, fan-out por WebSocket,
assinar upload no R2, e minar token do LiveKit. A mídia toda é do LiveKit.

Argumento específico deste ambiente contra Rust: **o Coolify buildar no mesmo servidor**. Cada deploy
de Rust custa minutos de CPU numa máquina que já divide recursos com 105 containers. Não é teoria —
é o custo recorrente de cada push.

A survey de 2025 aponta tempo de compilação como principal limitador de produtividade em Rust
(satisfação 6/10). Para dev solo com prazo, foi apontado como o pior risco das opções.

Node/TS compartilha tipos com o cliente React. Go é o meio-termo e é a mesma linguagem do LiveKit.
Elixir traz Channels/PubSub/Presence prontos (dispensaria o Redis) ao custo de 3-6 meses de rampa.

## Escolha de microfone, câmera e alto-falante

Três coisas separadas, que a gente tende a tratar como uma:

**Qual dispositivo usar.** Guardado em `localStorage` (`whatscord.devices`), não na sessão — é
propriedade do hardware à frente da pessoa, não da conta. Sobrevive de propósito ao logout: plugar
o fone uma vez não deveria ter que ser refeito a cada login. Passado ao LiveKit como
`audioCaptureDefaults`/`videoCaptureDefaults` na construção da `Room`, e não só no primeiro join —
sem isso, cada `setMicrophoneEnabled` posterior voltava calado para o microfone embutido.

**Um id salvo pode sobreviver ao hardware.** `resolveDeviceId` trata id que não existe mais como
"sem preferência" em vez de erro. O id continua salvo no disco: se o fone voltar, volta a valer.

**A permissão é por tipo, não global.** Câmera e microfone são concedidos separadamente. Um teste
global de "o navegador já revelou algum nome?" dava permissão por concedida quando só a câmera
tinha sido liberada, e o microfone ficava inutilizável sem nenhum aviso — foi exatamente o que
apareceu ao testar numa máquina com OBS instalado. Por isso `needsPermission` é perguntado por tipo.

**Antes da permissão o Chrome não devolve lista vazia:** devolve uma entrada por tipo com id e
rótulo vazios. `selectableDevices` descarta essas — oferecê-las faz a escolha não surtir efeito,
em silêncio, que é pior do que não oferecer nada.

**Saber o nome não é saber se funciona.** Daí o medidor de nível ao lado do seletor: dentro da
chamada ele lê a própria track publicada (sem segunda permissão nem segundo stream); fora dela, só
depois de clicar em "Test microphone".

## Avisos sonoros de entrada e saída

Sintetizados em código (`lib/sounds.ts`), não embarcados como arquivo. O motivo não é economizar
um binário no repositório: é roteamento. O aviso tem que sair pelo alto-falante que a pessoa
escolheu, e só um elemento de mídia aceita `setSinkId`. Um WAV em data URL alimenta um `<audio>`,
então o aviso segue o mesmo alto-falante da chamada.

Sobe ao entrar, desce ao sair — a direção carrega o significado sem precisar de legenda. Amplitude
em 0,22 e envelope de 8 ms nas pontas: um aviso que faz a pessoa se assustar acaba desligado, e aí
para de cumprir a função. O envelope existe porque começar ou terminar no meio do ciclo estala mais
alto que a própria nota.

Acompanhado sempre de uma linha na tela ("Fulano entrou na chamada"), porque som sozinho não serve
para quem está no mudo — e porque antes disso a chegada de alguém só mudava um número no canto.

## Compartilhamento de tela: o que estava ruim

Os padrões do LiveKit já eram 1080p a 15 fps com teto de 2.5 Mbps — o preset não
era o problema. Três outras coisas eram:

**Simulcast ligado.** O padrão publica três camadas (a original mais h180 e
h360) e reparte entre elas o mesmo teto de banda. A camada boa recebia uma
fração dos 2.5 Mbps, e o codificador ainda fazia três vezes o trabalho. Numa
chamada pequena isso é desperdício puro. Agora `simulcast: false`, passado **por
publicação** e não em `publishDefaults`, para não desligar o simulcast da
câmera — lá ele serve, porque quem está com rede ruim cai para uma camada menor
em vez de travar.

**Sem `contentHint`.** Sem essa dica o codificador trata a tela como vídeo em
movimento e borra texto para economizar banda. `"text"` preserva bordas.

**A tela dividia o palco em partes iguais com as câmeras.** Isso não é só
estética: com `adaptiveStream`, o LiveKit escolhe a camada de vídeo pelo
**tamanho do elemento na tela**. Renderizar a tela pequena fazia o servidor
mandar menos resolução justamente para o conteúdo em que a nitidez importa. Agora
a tela ocupa o palco e as pessoas viram uma tira embaixo.

Escolha entre "texto" e "movimento" porque a resposta certa depende do conteúdo:
texto quer resolução e aceita 15 fps; vídeo quer 30 fps e aceita perder nitidez.
`degradationPreference` acompanha a escolha.

### Áudio junto com a tela

`audio: true` sozinho não basta. Falta `systemAudio: "include"`, que faz o Chrome
**oferecer** a caixinha de som no diálogo — sem isso a opção pode nem aparecer. E
mesmo assim depende de a pessoa marcar: no Windows o Chrome só oferece som para
"aba" ou "tela inteira", nunca para uma janela isolada. Como isso é invisível de
fora, o app checa se veio track de `ScreenShareAudio` e avisa na hora, em vez de
deixar a outra pessoa descobrir que está mudo.

## Performance de carregamento

O bundle era **864 KB** num arquivo só, e o `livekit-client` (1.4 MB de fonte)
respondia pela maior parte — baixado e interpretado por todo mundo que abre o
app, inclusive quem só vai ler mensagem.

A tela de chamada passou a carregar sob demanda (`lazy` + `Suspense`). Para isso
valer, o `DevicePicker` teve de parar de importar `Track` do livekit: um único
import de valor na tela de configurações arrastava o SDK inteiro de volta para o
primeiro chunk. Ele agora recebe a track do microfone e a função de troca como
props.

| | Antes | Depois |
|---|---|---|
| Ao abrir o app | 864 KB (242 KB gzip) | **298 KB (92 KB gzip)** |
| Ao iniciar chamada | — | +566 KB (149 KB gzip) |

Verificado em execução: ao carregar o app o navegador busca só `index-*.js` e o
CSS; o chunk `Call-*.js` só aparece quando a chamada começa.

**A lista de mensagens não é virtualizada**, e enquanto não for, cada tecla
digitada do outro lado ("está digitando…") re-renderizava todas as mensagens
abertas. `Bubble` agora é memoizado; para o memo valer, `onReply` passou a
receber a ação do store (estável) em vez de uma seta nova a cada render.

## Áreas seguras no celular

`100dvh` já estava tratado, mas não havia nada de `env(safe-area-inset-*)`. No
APK a WebView desenha até as bordas (`enableEdgeToEdge()` no `MainActivity`), e a
barra de gestos do Android ficaria **por cima** da barra de controles da chamada
— cobrindo justamente desligar e mudo. No desktop os insets valem 0px, então as
regras não mudam nada lá.

## Links de convite e o protocolo `whatscord://`

Antes disso não existia link de convite: havia um código hexadecimal que a
pessoa copiava e a outra digitava em "New space → Have an invite code?". Agora
há um link, e ele abre o app desktop se estiver instalado.

**Quem registra o protocolo é o instalador, não o app.** O NSIS gerado pelo
Tauri escreve, a partir de `plugins.deep-link.desktop.schemes`:

```nsis
WriteRegStr SHCTX "Software\Classes\whatscord" "URL Protocol" ""
WriteRegStr SHCTX "Software\Classes\whatscord\shell\open\command" "" "$\"$INSTDIR\...exe$\" $\"%1$\""
```

e o desinstalador remove. Por isso `register_all()` é chamado **só em
depuração**: em release ele faria uma cópia portátil roubar o esquema da
instalada.

**No Windows o sistema não avisa um app aberto.** Ele abre uma instância nova
com a URL como argumento único. Quem resolve isso é o `single-instance`, que já
existia aqui para focar a janela: agora ele também repassa o `argv` para
`handle_cli_arguments`. Sem isso, clicar num convite com o app aberto não faria
nada. **Não ligue a feature `deep-link` do single-instance**: ela faz a mesma
chamada antes do callback, e somada à nossa o convite chegaria duas vezes.

**A ponte até a interface é um evento de DOM, não o canal de eventos do Tauri.**
O Rust faz `window.eval` disparando `whatscord:deeplink`. Assim o código da
interface não importa nada de Tauri para tratar convite, o mesmo arquivo roda no
navegador (onde o evento nunca dispara), e o build web não carrega uma linha de
Tauri. A URL vem do sistema operacional e é serializada com `serde_json` antes
de entrar no JS — nunca interpolada crua.

**A validação do código é estreita de propósito.** Qualquer programa da máquina
pode disparar `whatscord://` com o conteúdo que quiser, e o que sai dali vira
segmento de uma URL de API. Só passa hexadecimal de 6 a 64 caracteres; o resto é
recusado (43 testes cobrem isso, incluindo travessia de caminho, tag HTML e
esquema alheio).

### Dois problemas achados testando

**O link web não podia ser um caminho aninhado.** O Vite está com `base: "./"`
por exigência da configuração do app desktop, então o `index.html` referencia os
assets relativamente. Em `/join/abc` o navegador procurava o bundle em
`/join/assets/…`, recebia o próprio HTML de volta pelo fallback de SPA, e o app
não subia — em produção também. Por isso o link é `/?join=<código>`. O formato
de caminho continua sendo aceito na leitura, para o dia em que a base virar
absoluta.

**Dentro do app desktop, `location.origin` é `http://tauri.localhost`.** Gerar o
convite com essa origem produzia um link que não abre em nenhuma outra máquina —
e na tela ele parecia um link normal. `shareOrigin()` troca origens internas
(tauri.localhost, localhost, 127.0.0.1, [::1]) pelo endereço público.

### O convite sobrevive ao login

Um link aberto por quem ainda não tem conta fica guardado no `sessionStorage` e
é consumido assim que a sessão aparece. Sem isso a pessoa se cadastra e cai numa
tela vazia, sem nunca entrar no espaço para o qual foi convidada. A tela de login
avisa que há um convite esperando, senão parece que o link não fez nada.

