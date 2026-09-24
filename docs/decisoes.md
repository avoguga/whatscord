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

**Simulcast ligado.** Para tela o padrão publica duas camadas — a original mais
uma com metade da resolução — e reparte entre elas o mesmo teto de banda. A
camada boa recebia uma fração dos 2.5 Mbps e o codificador fazia o trabalho duas
vezes. (Atenção ao ler o SDK: o comentário "defaults to h180, h360" é de
`videoSimulcastLayers`, que vale para a câmera, com 3 camadas — não para tela.) Numa
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


## Presença de voz, ordem da barra lateral e papéis do espaço

### A presença de voz mora no Redis, num ZSET por sala

Ela vivia na memória do cliente e morria num F5: quem recarregava a página via a
sala de voz vazia mesmo com gente falando dentro. A fonte de verdade passou para
o servidor — `GET /calls/presence?roomIds=…` e o evento `voice:presence`.

**Um ZSET por sala, e não um SET com TTL na chave.** Cada membro é
`userId:socketId` e o *score* é o instante em que aquela conexão vence. Com um
TTL na chave inteira, o vencimento seria do conjunto: a conexão de quem caiu
ficaria viva enquanto qualquer outra pessoa da sala renovasse. Com o vencimento
no score, cada conexão expira sozinha.

**A presença é por USUÁRIO, contada por conexão.** Quem abre o app em duas abas
tem duas conexões e só sai da lista quando a última delas sai — daí o `userId`
fazer parte do membro do ZSET. A exceção é a saída deliberada (`call:leave`), que
derruba todas as conexões daquela pessoa naquela sala: o LiveKit não deixa a
mesma identidade estar duas vezes na sala, então "a outra aba continua na
chamada" não é um estado que exista.

**Quem bate o heartbeat é o servidor, não o cliente.** Um `setInterval` no
cliente confiaria a presença justamente a quem pode ter travado, e uma aba em
segundo plano tem o timer estrangulado pelo navegador — quem estivesse só
ouvindo a chamada noutra janela sumiria da lista. Cada instância renova os
sockets que ela mesma segura. Assim o TTL de 90 s vira o que ele deve ser: a
faxina de uma instância que morreu sem se despedir, e não o relógio do qual a
presença depende para existir.

**A entrada se prende às conexões, mesmo vindo por HTTP.** Pedir o token em
`POST /rooms/:id/call/token` É entrar na sala de voz, e é o único passo que o
cliente atual dá. Como o pedido HTTP não sabe de qual aba veio, a presença é
registrada para todas as conexões abertas daquela pessoa — é o `disconnect` de
cada uma que vai desfazê-la depois.

### A ordem da barra lateral é de quem olha

`position` e `folderId` moram em `SpaceMember`, não em `Space`. Se morassem no
espaço, arrastar um servidor para o topo reordenaria a tela de todos os outros
membros dele.

**Apagar uma pasta não apaga o que estava dentro** (`onDelete: SetNull`). São
espaços inteiros, com as conversas de outras pessoas; uma gaveta desfeita na
barra lateral de alguém não pode arrastá-los junto.

**Espaço de que a pessoa não é membro é ignorado em silêncio** em
`PATCH /spaces/order`, mas pasta de outra pessoa é recusada com erro. A diferença
é o que cada caso vaza: recusar o espaço responderia "ele existe, você é que não
está nele" para qualquer id chutado; já aceitar a pasta em silêncio gravaria um
`folderId` que a listagem nunca devolve, e o espaço sumiria da barra lateral sem
explicação.

### Hierarquia: ninguém age sobre alguém do mesmo nível ou acima

Vale igual para promover, rebaixar e expulsar — inclusive entre dois
administradores. Sem essa regra, dois deles podem se rebaixar mutuamente até o
espaço ficar sem quem o administre.

**Só o dono mexe em papel.** Deixar um administrador promover outro faria o cargo
se espalhar sozinho: quem entrou pelo convite de ontem vira administrador hoje e
distribui o cargo amanhã, mais depressa do que o dono consegue desfazer.

**Não existe um segundo dono.** `PATCH …/members/:userId` recusa o papel `OWNER`;
a posse passa por `POST /spaces/:id/owner`, que troca os dois papéis na mesma
transação. O dono antigo vira ADMIN, não MEMBER — quem entregou as chaves não
deve perder até a possibilidade de criar um canal no espaço que era dele.

**Expulsar não apaga mensagem.** É regra de produto: apagar o que a pessoa
escreveu arrancaria metade das conversas de quem continua no espaço. O que sai é
o acesso — a associação ao espaço, as dos canais e as inscrições dos sockets
ainda abertos.

**Regenerar o convite corta o antigo na hora** porque o código É o único campo:
`Space.inviteCode` é sobrescrito e `POST /spaces/join/:code` não tem onde achar o
valor anterior. É isso que faz a rota servir para o que ela existe — cortar um
link que vazou.

### O ícone do grupo usa a mesma validação do avatar

`lib/imagem.ts` guarda a expressão que os dois campos compartilham. Aceitar URL
arbitrária transformaria o ícone num rastreador de IP de todo mundo que vê a
conversa — pior que num avatar, porque quem escolhe o ícone do grupo não é
necessariamente quem aparece na foto. O `(?!.*\.\.)` barra travessia de caminho.

## Supressão de ruído do microfone

### GTCRN em WebAssembly, e não o Krisp

O pedido foi "o que o Discord tem": um seletor Padrão / Krisp. O Krisp está fora
de alcance aqui, por três motivos verificados em 15/09/2026:

- o pacote `@livekit/krisp-noise-filter` **só funciona com LiveKit Cloud**
  (livekit/client-sdk-js#1510 e a comunidade do LiveKit confirmam; o nosso
  servidor é próprio);
- tem 12,4 MB e licença proprietária (termos de serviço do LiveKit);
- o código do filtro está ofuscado, e a montagem da URL dos modelos passa pela
  sala em `onPublish(room)` — não há como apontá-lo para outro lugar.

Comparados os motores livres em WebAssembly:

| Motor | Tamanho | Taxa | Observação |
|---|---|---|---|
| RNNoise | 153 KB | só 48 kHz (quadros de 480) | quebra em 44,1 kHz, comum no Windows |
| Speex preprocess | 56 KB | qualquer | clássico, fraco em ruído não estacionário |
| **GTCRN** | **197 KB** | **48 ou 16 kHz** | 23,7 mil parâmetros, ~40 MMAC/s, neural |
| DeepFilterNet | ~12 MB de runtime ONNX | — | melhor som, ~40 ms de atraso |

**GTCRN**, via `@sapphi-red/web-noise-suppressor` (MIT), como `TrackProcessor` do
LiveKit — o mesmo contrato do Krisp, então `setProcessor`/`stopProcessor` e nada
mais muda na chamada. Se o AudioContext do LiveKit não estiver a 48 nem a 16 kHz,
o processamento vai num contexto próprio a 48 kHz.

Três coisas que o próprio filtro Krisp ensinou ao ser lido:

1. **Com a avançada ligada, a supressão do navegador tem de sair**
   (`noiseSuppression: false`, `voiceIsolation: false`). Dois supressores em
   cadeia não somam; o segundo recebe o sinal mastigado pelo primeiro.
2. O `voiceIsolation` que o SDK já pede só age onde o sistema tem suporte —
   hoje, quase só ChromeOS. No Windows é inofensivo e inerte.
3. **O CSP do Tauri bloqueava WebAssembly.** Com `script-src 'self'` e sem
   `'wasm-unsafe-eval'`, o Chromium recusa compilar WASM. O `tauri.conf.json`
   passou a incluí-lo em `csp` e `devCsp`. Sem isso a avançada falharia em
   silêncio só no app instalado.

## Atualização automática do app de desktop

### Baixar na hora; instalar ao abrir, ao sair ou quando ninguém está usando

Queixa dos testadores: "para atualizar, sempre tem que baixar um instalador
novo". A partir da 0.2.0 o app se atualiza sozinho. A pergunta difícil não era
*como* baixar — o plugin do Tauri faz isso —, e sim *quando instalar*, porque no
Windows o instalador **fecha o app**.

Pesquisado com fontes em 17/09/2026:

| Prática | Quem faz | Fonte |
|---|---|---|
| Nunca reiniciar durante chamada/reunião | Zoom, Teams | library.zoom.com (automatic-update-explainer); learn.microsoft.com/microsoftteams/teams-client-update |
| Instalar quando o app está ocioso | Teams | idem |
| Atualizar ao abrir, antes do uso | Discord (splash) | github.com/GooseMod/OpenAsar, src/splash/index.js |
| Instalar ao sair, em silêncio, sem reabrir | electron-updater (padrão) | electron-builder, AppUpdater.ts |
| Indicador de "pronta" que não some | VS Code, Slack, Discord | vscode, contrib/update/browser/update.ts; slack.com/help/articles/360048367814 |
| Escalar em vez de adiar para sempre | Chrome (2, 4, 7 dias) | chromium, upgrade_detector_impl.cc |
| Atualização por diferença | Discord, Chrome | só compensa com dezenas de MB |

**A regra** (`decidirInstalacao`, em `apps/web/src/lib/atualizacao.ts`, testada):

1. Em chamada → espera. Nem botão: um clique distraído derrubaria a ligação.
2. Automático desligado → só avisa.
3. Rascunho na caixa de mensagem, **com ou sem foco** → só avisa.
4. Abriu há até 90 s e ninguém tocou em nada → instala já, sem contagem.
5. Escondido na bandeja e parado 2 min → instala já. Vale mesmo adiado: adiar é
   sobre não interromper o uso, e ali não há uso.
6. Adiado e no prazo → só avisa.
7. Pendente há 7 dias → no próximo momento seguro, com contagem.
8. À vista e parado 10 min → com contagem de 10 s e "Adiar".

Mais: **ao sair pelo menu da bandeja**, versão já baixada instala em silêncio sem
reabrir. "Sair" encerra sozinho em 5 s se a tela não responder. Isso só roda
pelo menu, de propósito: desligar o Windows mata o instalador no meio e pode
deixar o app desinstalado (electron-builder#7807).

**Modo `quiet`**, não `passive`: o instalador é por usuário, então não pede
administrador, e com `/R` reabre o app sozinho — sem a janelinha de progresso
que o `passive` mostra. Conferido no código do plugin (config.rs:
`Quiet => ["/S"]`, e `/R` para todo modo menos `BasicUi`) e no modelo NSIS do
Tauri (`RequestExecutionLevel user` em `currentUser`).

**"Mais tarde" adia 1 h, e 15 min depois de 2 dias.** O indicador verde na
engrenagem da barra lateral nunca some enquanto houver versão esperando.

**Não fizemos atualização por diferença**: o instalador tem 2,7 MB, o Tauri não
suporta, e o Discord precisa de fallback para pacote completo para a dele ser
confiável.

**Risco conhecido**: `install()` trava em algumas instalações do Windows 10
(plugins-workspace#2558). Se aparecer relato de "ficou em Instalando…", é esse.

## Abrir junto com o Windows

### Registro escrito por nós, e não pelo `tauri-plugin-autostart`

Lido o código do plugin oficial (2.5.1, sobre auto-launch 0.5.0) antes de usar:

- grava o caminho **sem aspas** (`format!("{} {}", caminho, args)`). Em usuário
  com espaço no nome (`C:\Users\João Silva\...`), funciona só porque o Windows
  tenta os pedaços do caminho até achar um executável;
- o `enable()` **sobrescreve** o que a pessoa desligou no Gerenciador de Tarefas.

`src-tauri/src/inicializacao.rs` faz o mesmo em poucas linhas: caminho entre
aspas, e lê `StartupApproved\Run` para respeitar quem desligou pelo Windows.
Testado contra o registro real (`cargo test --lib inicializacao -- --ignored`),
limpando o que cria.

### Ligado por padrão, uma vez só, e abrindo na bandeja

É o que Discord e Teams fazem, e é o que torna um app de conversa útil para
receber mensagem. Mas ligar sem contar dá má fama ao padrão, então:

- liga **uma única vez**, na primeira abertura de uma versão com o recurso —
  marcador em arquivo na pasta de configuração, não no armazenamento da página
  (limpar dados do navegador embutido não pode religar o que a pessoa desligou);
- só no app **instalado** (`not(debug_assertions)`) — em desenvolvimento
  gravaria o executável de `target\debug` para abrir a cada boot;
- aviso de uma vez com **Desligar** ali mesmo, e seção nas Configurações;
- abre com `--oculto`, **direto na bandeja**.

### Duas armadilhas

1. **A janela é criada no `setup`**, não pela configuração (`create: false`).
   Para nascer escondida sem piscar, a visibilidade tem de ser decidida antes de
   ela existir. É o mesmo `from_config(...).build()` que o Tauri faz por dentro
   (app.rs), então Windows e Android seguem pelo mesmo caminho.
2. **O desinstalador roda em toda atualização.** O instalador novo chama o
   antigo com `/UPDATE` (installer.nsi do Tauri 2.11.4). O gancho em
   `src-tauri/windows/hooks.nsh` só limpa o registro com `$UpdateMode <> 1` —
   sem isso, cada atualização desligaria o recurso em silêncio.

Efeito cruzado com a atualização automática: o instalador reabre o app com os
**mesmos** argumentos. Aberto pelo Windows (`--oculto`), voltaria escondido
mesmo se a pessoa tivesse clicado "Reiniciar agora" com a janela aberta. Uma
marca com validade de 2 minutos faz a janela voltar (`deveReabrirVisivel`).

## Configurar o espaço

### Por que renomear um canal não mora em `PATCH /rooms/:id`

Porque a autoridade é outra. Num canal de espaço, quem manda é o papel da pessoa
no **espaço**; `PATCH /rooms/:id` decide pelo papel dela na **sala**. E o papel
na sala, num canal de espaço, é `MEMBER` para todo mundo — inclusive para o
dono: `POST /spaces/:id/channels` cria os `RoomMember` sem papel nenhum, e só o
espaço recém-criado dá `OWNER` ao criador, nos dois canais iniciais.

Ou seja, tratar canal como grupo daria "só administradores do grupo" na cara de
quem é dono do espaço. Por isso `PATCH /spaces/:id/channels/:channelId`, que
confere a régua certa — e confere também que o canal é **daquele** espaço, senão
bastava trocar o id na URL para renomear canal alheio.

### O que existia e nunca tinha sido escrito

`Space.iconUrl` estava no banco, estava no tipo do cliente e o `SpaceRail` já
sabia desenhá-lo — mas nenhuma rota jamais gravou esse campo. Era uma coluna
morta desenhando um ícone que ninguém podia escolher. `PATCH /spaces/:id` fechou
o circuito; o desenho não precisou de uma linha.

### O último canal não sai

Um espaço sem canal nenhum abre numa tela vazia onde não há o que clicar, e quem
não administra não tem como criar o próximo. `DELETE` do último canal responde
409 `spaces.last_channel`, e a frase diz a regra em vez de "não pode" — é o que
faz a pessoa procurar apagar o espaço inteiro, que é o que ela queria.

### Apagar o espaço: o evento vai para todo mundo

`emitToUsers(ids, "space:left")` para **todos** os membros, e não só para quem
apertou. É o mesmo evento que quem sai recebe, e o cliente já sabe o que fazer
com ele. Um membro que não recebesse ficaria com a barra lateral filtrando por
um espaço que não está mais na lista — a tela vazia sem caminho de volta.

Do lado do cliente, os três caminhos que terminam igual (sair, apagar, e o aviso
de que outra pessoa apagou) passaram a chamar a mesma `esquecerEspaco`. Antes só
o primeiro limpava `activeSpaceId`, e os outros dois nem existiam.

### No telefone, sala que sumiu tem de ser solta

O layout esconde a barra lateral enquanto há sala aberta (`data-room-open`). Uma
sala apagada do outro lado deixaria a pessoa presa num painel vazio, sem
caminho de volta — o `Chat` cai no `EmptyState`, mas o layout continua dizendo
que há sala aberta. Por isso `room:left` agora solta a sala quando o id bate.

A limpeza ficou nos pontos de chamada, e **não** dentro de `refreshRooms`. Ali
seria mais curto e cobriria tudo de uma vez, mas `refreshRooms` também roda por
evento de socket: uma resposta que saiu do servidor antes de uma conversa nova
existir chegaria depois de abri-la, e fecharia a conversa que a pessoa acabou de
abrir.

## Sair da chamada

### Quem tira a pessoa da chamada é o servidor

Havia duas listas de "quem está na chamada" e elas podiam divergir: a nossa
presença (Redis, alimentada por `call:leave` e pelo `disconnect` do socket) e o
LiveKit, que só sabe de saída pelo aviso que o NAVEGADOR de quem sai manda.

Medido em produção, com dois navegadores e a API de administração do LiveKit:
**quatro minutos** depois de a tela de chamada fechar, `ListParticipants` ainda
devolvia a pessoa como `ACTIVE`, publicando uma faixa de áudio, enquanto
`GET /calls/presence` já dizia que a sala estava vazia. Quem entrasse no canal
depois continuaria ouvindo um fantasma — e foi exatamente esse o relato: "saí e
parecia que eu ainda estava dentro".

A causa é o congelamento de página. O `livekit-client` registra `onPageLeave` em
`pagehide`, `beforeunload` **e `freeze`**; uma aba em segundo plano que o Chrome
congela enfileira o `sendLeave` e nunca o entrega, e como o soquete dela
continua aberto, nem o tempo limite do LiveKit derruba a sessão.

Por isso `call:leave` e a queda da última conexão passam a chamar
`RemoveParticipant`. O servidor é a única ponta que sempre sabe que a pessoa
saiu, e com isso as duas listas deixam de poder divergir.

### O perigo da correção, e o que o segura

`RemoveParticipant` mira a **identidade**, não aquela sessão. Uma expulsão que
chegue atrasada derruba a pessoa que já voltou — e sair e entrar de novo
depressa é das coisas mais comuns numa chamada (caiu o áudio, trocou de fone,
clicou errado).

Então consulta-se `getParticipant` antes e compara-se o `joinedAt` com o
instante em que a saída chegou. `joinedAt` vem em **segundos**, arredondado para
baixo, daí a folga de um segundo em `FOLGA_DE_ENTRADA_MS`. Na dúvida, não
expulsa: um fantasma é chato, derrubar quem acabou de voltar é pior. A decisão é
pura, em `lib/expulsao.ts`, e está coberta em `tests/chamada.test.ts`.

`joinedAt` igual a zero é "ainda entrando", e não 1970 — tratá-lo como data faria
a conta dizer "entrou há 56 anos" e a pessoa levaria a expulsão no meio da
entrada.

### A sala órfã, do lado do cliente

Se a tela da chamada fecha **enquanto** a conexão sobe, o `disconnect` da limpeza
encontra uma sala que ainda não conectou, o LiveKit responde "already
disconnected" e volta. A conexão que sobe logo depois fica aberta para sempre:
sem tela, sem ninguém para fechá-la, e com o microfone publicando. Por isso o
`if (cancelled)` que vem depois do `connect` desliga a sala antes de sair, em vez
de só retornar.

## Transmissões

### Transmitir é a chamada de sempre, com o crachá trocado

Uma pessoa apresenta e muitas assistem — e a camada de mídia não precisou de
nada novo. O que muda é o token: quem transmite recebe `canPublish: true`; quem
assiste recebe `canPublish: false`, `canPublishData: false` e **`hidden: true`**.

`hidden` não é privacidade, é sobrevivência da tela. `Call.tsx` monta **um tile
por participante remoto, sem teto nenhum**; se a plateia fosse visível, a tela de
quem transmite tentaria desenhar um quadradinho por espectador. Escondidos, eles
não existem para o cliente — e por isso a contagem de quem assiste vem da NOSSA
presença, não do LiveKit.

A sala se chama `stream_<id>`, separada do `room_<id>` das chamadas, para a
expulsão e a presença de voz não confundirem as duas.

### Quem decide o crachá é o servidor

A primeira versão deixava o cliente escolher a porta — `/go-live` para quem
transmite, `/watch` para quem assiste — e a tela do dono entrava pela segunda.
Medido pela API de administração do LiveKit, com duas sessões reais: **os dois
participantes apareciam com `canPublish: false` e `hidden: true`**, ou seja, o
dono não conseguia transmitir a própria transmissão.

Agora `/watch` olha quem está pedindo. Não há o que o cliente possa errar.

### `podeAssistir` e `apareceNoInicio` são perguntas diferentes

Confundir as duas é o que vazaria uma transmissão privada. Quem tem o código
**pode assistir** a uma transmissão por link; ela **nunca aparece** numa vitrine
— nem para quem acabou de assistir com o código —, senão o segredo acaba no
instante em que alguém abre a tela de início. Só o dono a vê listada.

### O bate-papo saiu de graça

A transmissão é dona de uma `Room` (de tipo `STREAM`), e quem entra para assistir
vira `RoomMember` por `upsert`, igual a quem entra num espaço. Com isso
mensagens, anexos, respostas, reações, não lidas e o socket funcionam sem uma
linha nova, e `requireMembership` — o portão de toda rota de sala — ficou
intocado.

O preço: quando o dono **aperta** a visibilidade, as associações antigas têm de
cair. Sem isso, uma transmissão que acabou de virar privada continuaria aberta
justamente para quem se quis deixar de fora.

### Simulcast: a regra se inverte

Numa chamada a tela vai em camada única de propósito (poucas pessoas, quase
sempre em boa rede, e economiza a subida de quem compartilha). Numa transmissão
isso vira defeito: quem tem internet ruim não tem para onde descer e congela, e
não existe "quase sempre" quando a plateia é desconhecida. Custa ~30% a mais de
subida para **uma** pessoa e salva todas as outras. O padrão também desce para
720p30 — ver a conta abaixo.

### A escada de escala, e a costura que a torna barata

Saída do servidor = **espectadores × bitrate**. A 720p30 (1,8 Mbps): 10 pessoas
são 18 Mbps, 50 são 90 Mbps, 500 são 900 Mbps. O LiveKit roda em 1 GB / 1,5 vCPU
num host com ~105 contêineres de outros projetos. Daí o teto de 15 espectadores
(`TETO_DE_ESPECTADORES`, ajustável por `STREAM_MAX_VIEWERS`).

O caminho para centenas **não é subir esse número**: é parar de mandar uma cópia
para cada um — Egress do LiveKit gerando HLS, com CDN na frente. Por isso
`/watch` devolve uma união marcada por `modo`:

```ts
{ modo: "webrtc", url, token }   // hoje
{ modo: "hls",    url }          // o degrau seguinte
```

O tocador decide pelo `modo`. Ligar o degrau 2 passa a ser instalar um contêiner
e acrescentar um ramo no cliente, em vez de reescrever a tela. O `EgressClient`
já vem no SDK instalado; falta só o contêiner.

### O que ficou de fora, de propósito

- **Miniatura**: `GET /files/*` é público por endereço, então a prévia de uma
  transmissão privada ficaria ao alcance de quem tivesse a URL.
- **Moderação do chat**: hoje só o autor apaga a própria mensagem. Numa
  transmissão pública o dono precisa apagar e silenciar.
- **Lista de quem assiste**: vai só o número. Publicar a audiência inteira para
  qualquer um que entrasse é mais do que ninguém pediu.

## Esqueci a senha

- **A resposta não conta quem tem conta.** `POST /auth/forgot` responde 204
  exista ou não o e-mail, e a tela diz "se houver uma conta, mandamos". O envio
  roda DEPOIS da resposta sair, para o tempo também não entregar: esperar o Gmail
  faria um e-mail cadastrado demorar um segundo e um inexistente, milissegundos.
- **No banco vai o hash do token**, como no `RefreshToken`. Um backup vazado não
  redefine a senha de ninguém.
- **Link de uso único mesmo com dois cliques simultâneos**: o `usedAt` é marcado
  com `updateMany ... where usedAt is null` dentro da transação, e só quem marcou
  segue.
- **Redefinir e trocar derrubam todas as sessões** e devolvem uma nova para o
  aparelho de quem trocou. Quem troca a senha às vezes está trocando por
  desconfiar de alguém.
- **O nome do perfil vai escapado no HTML do e-mail.** Sem isso, um nome como
  `<a href=...>` viraria link dentro de uma mensagem com o nosso remetente.
- **O token sai da barra de endereços assim que é lido** — não pode ficar no
  histórico nem num print.
- **Trocar a senha logado pede a senha atual**: um app deixado aberto não pode
  virar a conta de quem estiver na frente dele.
