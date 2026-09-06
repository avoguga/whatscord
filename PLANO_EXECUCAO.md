# PLANO_EXECUCAO.md

> Documento escrito para um **agent orquestrador**, não para leitura humana.
> Você vai montar um time de sub-agents e executar tudo o que está aqui.
> Leia as seções 2 e 3 antes de distribuir qualquer tarefa: elas contêm fatos já
> apurados e armadilhas que custaram dias. Redescobri-las é desperdício.

Levantamento de **06/09/2026**. O que está marcado como *apurado* foi verificado
no código ou em execução; o que está como *hipótese* não foi.

---

## 0. Método obrigatório

O dono do produto exigiu esta ordem, e ela é o que pegou os erros mais caros
deste projeto:

1. **Pesquisar para validar** — ler a fonte real (código do SDK, `.d.ts`,
   `installer.nsi` gerado, `AndroidManifest.xml`) antes de assumir. A doc oficial
   do LiveKit e do Tauri é rasa nos tópicos avançados e já produziu conclusões
   erradas aqui.
2. **Planejar** com o que a pesquisa mostrou.
3. **Executar.**
4. **Testar.**
5. **Testar de novo no artefato final**, não no ambiente de desenvolvimento.

Regra adicional do dono, que vale para você: **antes de mudanças grandes de UI ou
arquitetura, apresente a proposta e aguarde confirmação.** As tarefas marcadas
com 🛑 abaixo não podem ser implementadas sem esse aceite.

Três erros reais que só apareceram ao executar, nunca em revisão de código:

- Um documento do repositório afirmava em negrito *"não use `network_mode:
  host`"*. Era pesquisa sem execução. Estava errado, e nenhuma chamada externa
  conectava por dias.
- O link `/join/<código>` **não subia o app**: o Vite estava com `base: "./"` e o
  bundle era procurado em `/join/assets/`. Já corrigido — ver D3 em
  `DECISOES.md`.
- Dentro do app desktop `location.origin` é `http://tauri.localhost` — o link de
  convite gerado ali parecia normal e não abria em nenhuma outra máquina.

---

## 1. Projeto, stack e arquitetura

**WhatsCord**: recursos de Discord (espaços, canais de texto, salas de voz,
chamadas, compartilhamento de tela) com a interface do WhatsApp.

Monorepo npm workspaces em `C:\Users\User\Documents\finalmente\whatscord`:

| Workspace | Stack | Papel |
|---|---|---|
| `apps/api` | Fastify 5, Prisma 6, PostgreSQL, Socket.IO + adaptador Redis | REST + tempo real + emissão de token LiveKit |
| `apps/web` | React 19, Vite 6, TypeScript, Zustand | a interface inteira — usada também pelo desktop e pelo Android |
| `apps/desktop` | Tauri v2 (Rust), WebView2 no Windows | casca desktop **e** Android; carrega o build de `apps/web` |

**Não existe app mobile nativo nem Electron.** Android e Windows são a mesma
WebView carregando `apps/web/dist`. Isso significa: **quase toda tarefa de
produto é uma tarefa de `apps/web`**, e "mobile / desktop / web" é sobre onde
testar, não sobre onde codar.

Mídia por LiveKit self-hosted (SFU) em `wss://livekit.167.88.39.225.sslip.io`.
Infra em Coolify na VPS `167.88.39.225`.

**Em produção agora:**

| Peça | URL / arquivo |
|---|---|
| Web | `https://whatscord.167.88.39.225.sslip.io` |
| API | `https://api.whatscord.167.88.39.225.sslip.io` |
| LiveKit | `wss://livekit.167.88.39.225.sslip.io` |
| Instalador Windows | `WhatsCord-0.1.0-setup.exe` (raiz do repo, 1,80 MB) |
| APK | `WhatsCord-0.1.0-arm64.apk` (raiz do repo, 41,7 MB) — **nunca executado num aparelho** |

Documentos a ler antes de começar: `docs/decisoes.md`, `docs/operacao.md`,
`docs/livekit-coolify.md`, `docs/android.md`.

---

## 2. Fatos apurados — não redescubra

### Banco (`apps/api/prisma/schema.prisma`)

| Item | Estado |
|---|---|
| `User.avatarUrl` | existe (`String?`) |
| `Space.iconUrl` | existe (`String?`), nunca usado |
| `Room.iconUrl` | existe (`String?`), só leitura |
| `Room.position` | existe (`Int @default(0)`) e **já ordena** canais (`spaces.ts:22`) |
| Ordem de espaços | **não existe campo nenhum**; `GET /spaces` não tem `orderBy` |
| Pasta/categoria de espaço | **não existe** |
| `MemberRole` | `OWNER \| ADMIN \| MEMBER`, em `SpaceMember` e `RoomMember` |

### Rotas

Existe **exatamente uma** verificação de papel em toda a API
(`apps/api/src/routes/spaces.ts:94` — criar canal recusa `MEMBER`). Todo o resto
ignora `role`.

**Não existem:** remover membro de espaço/grupo · mudar `role` ·
`PATCH /spaces/:id` · `PATCH /rooms/:id` · reordenar espaços · reordenar canais
(o campo existe, a rota não) · regerar código de convite.

**Já existe, ao contrário do esperado:** `PATCH /users/me` aceita `avatarUrl`.

`POST /files` é upload genérico autenticado, limite `MAX_UPLOAD_MB`, MIME
saneado na saída. **Não valida que é imagem nem redimensiona.** Nenhuma lib de
processamento de imagem no projeto.

### Interface

- **~285 ocorrências** de string traduzível em `apps/web/src/`. Concentração:
  `Chat.tsx` 52, `Call.tsx` 49, `Invites.tsx` 45, `Sidebar.tsx` 38, `Auth.tsx` 23.
  Mais 19 em `lib/` — inclusive `"Today"`/`"Yesterday"` e sufixos `"B"/"KB"/"MB"`
  em `format.ts`.
- **42 mensagens de erro distintas** vindas da API (45 pontos de retorno em
  `routes/*.ts` + 1 em `lib/rooms.ts`), exibidas direto via `err.message`.
  Tradução no cliente **não cobre isso**.
- Datas já usam `Intl.DateTimeFormat(undefined, …)` — já são locale-aware.
- **26 variáveis** no `:root` de `styles.css` + 4 de safe-area.
  **45 cores literais fora do `:root`.** `color-scheme: dark` **fixo** na linha 56.
  Zero `prefers-color-scheme` / `data-theme`.
- As 13 cores inline em JSX já usam `var(--…)` — nenhuma literal em componente.
- **Nenhuma biblioteca de i18n. Nenhuma de drag-and-drop.**

### LiveKit (v2.22.x, lido do `.d.ts` e do bundle)

```js
publishDefaults = { simulcast: true, videoCodec: 'vp8', backupCodec: true,
                    screenShareEncoding: ScreenSharePresets.h1080fps15.encoding }
roomOptionDefaults = { adaptiveStream: false, dynacast: false }
```

- Para **tela**, o simulcast padrão gera **1 camada extra** (metade da
  resolução), não 3. O comentário *"defaults to h180, h360"* no `.d.ts` é de
  `videoSimulcastLayers` (**câmera**).
- `degradationPreference` já tem default por fonte: tela → `maintain-resolution`.
- `contentHint` **não** é aplicado sozinho (exceto SVC).
- `resolution`, quando não passado, vira `h1080fps30.resolution` e sai como
  **`width: { ideal: 1920 }`** — `ideal`, **não** `exact`. `aspectRatio` nunca é
  enviado. **O SDK não força 16:9.**
- `room.switchActiveDevice(kind, deviceId, exact?)` **só aceita deviceId** — não
  há como passar `facingMode` por ali.

### Presença de voz (crítico para a Tarefa 4)

- `voicePresence: Record<roomId, userId[]>` no store — só ids.
- Alimentado só por `call:joined` / `call:left` de socket. **Nada é persistido**:
  o Redis só guarda online/offline geral. **Depois de um F5 volta vazio.**
- `call:joined` é emitido em `POST /rooms/:id/call/token` — ou seja, ao **pedir
  token**, não ao conectar. Pedir e não entrar marca a pessoa como presente.
- Payload: `{ roomId, userId, displayName }` — **sem `avatarUrl`**.
- A barra lateral usa só a contagem (`"3 connected"`).

---

## 3. Armadilhas

### A. `base` do Vite — RESOLVIDA

Já está em `base: "/"`, verificado em execução (ver D3 em `DECISOES.md`). Rotas
aninhadas voltam a funcionar na web.

**Não reverta para `./`.** O comentário antigo dizia "Tauri loads the build from
disk" e era herança do Tauri v1; no v2 nenhuma plataforma usa `file://`. Com
`./`, qualquer caminho aninhado faz o navegador buscar o bundle em
`/rota/assets/…` e receber o HTML pelo fallback de SPA.

**Pendente:** confirmar num aparelho Android. A evidência (`addPathHandler("/")`
no wry) é forte, mas não é execução.

### B. Coolify e LiveKit

- LiveKit em `network_mode: host` porque o Coolify anexa cada Service a **duas**
  redes e o LiveKit abre um socket por interface — a resposta ICE saía pela
  errada.
- Com host networking o Traefik **não roteia por label**: o roteamento vive em
  `/data/coolify/proxy/dynamic/whatscord-livekit.yml`, **fora do deploy**. Cópia
  canônica em `infra/traefik-livekit.yml`. Se o proxy for recriado, o `wss://`
  morre sem aparecer em log nenhum.
- `NODE_ENV=production` injetado pelo Coolify quebra o build. O `HEALTHCHECK`
  tem que estar **na imagem**.

### C. Android

- `tauri android init` gera manifesto só com `INTERNET`. Sem `CAMERA`,
  `RECORD_AUDIO` e `MODIFY_AUDIO_SETTINGS` a chamada entra muda e cega. Por isso
  `src-tauri/gen/android` **é versionado** aqui, contra a convenção do Tauri.
- **Tensão não resolvida:** o wry 0.55.1 em uso **já implementa**
  `onPermissionRequest` (lido em
  `~/.cargo/registry/src/*/wry-0.55.1/src/android/kotlin/RustWebChromeClient.kt`),
  mas as issues `tauri-apps/tauri#10846` e `#12041` dizem que só o manifesto não
  basta. **Só um aparelho real decide.** Se falhar, ver
  `tauri-apps/discussions#12732`.
- `getDisplayMedia` **não funciona** no WebView do Android. O app já detecta
  (`canShareScreen` em `lib/screenshare.ts`) e desabilita o botão.
- Build no Windows falha ao criar o link simbólico da `.so`. **Não mexa na
  configuração do sistema**: copie a biblioteca e chame o Gradle direto. O
  `llvm-strip` **não é opcional** (146 MB → 17 MB). Passo a passo na seção 7.
- Qualquer código que use `get_webview_window`/`eval` precisa de `#[cfg(desktop)]`
  — já houve build de Android quebrado exatamente por isso.

### D. Dispositivos de mídia

- Permissão é **por tipo**: câmera e microfone separados. Checagem global de "já
  temos algum rótulo?" dá falso positivo.
- Antes da permissão o Chrome devolve **placeholders com id vazio** — oferecê-los
  faz a escolha não surtir efeito em silêncio (`selectableDevices` filtra).
- **Nunca desabilite o seletor** por falha de enumeração. Já houve regressão
  exatamente assim; "System default" é sempre uma escolha legítima.

### E. Ambiente

- Heredoc no Git Bash desta máquina falha ("unexpected EOF"). Use Python no
  scratchpad.
- `DELETE` sem corpo **não pode** mandar `Content-Type: application/json` (400 do
  Fastify). O cliente já faz certo; scripts de teste erram.
- Git converte LF→CRLF ao escrever; `str.replace` de bloco multilinha falha em
  silêncio. Prefira edição por número de linha com `assert`.
- `git push` pelo Git Credential Manager **trava** nesta máquina. Use o PAT via
  helper de uma execução só.
- Ao gerar o instalador, confirme que ele é **mais novo** que `apps/web/dist/`.

---

## 4. Tarefas

Formato: descrição técnica · arquivos · critérios de aceite · imagem.
🛑 = exige proposta aprovada antes de implementar.

---

### T1 — Atalhos de configuração nos botões de voz e vídeo
**Imagens #9 (estado atual), #10 e #11 (referência Discord)** · feature/UX ·
prioridade **alta** · complexidade **baixa** · plataformas: web, desktop, mobile

Hoje a barra tem 5 botões (`Mute`, `Start video`, `Share screen`, `Devices`,
`Leave`) e o único acesso a configurações é o painel `.call-devices`, que abre
cheio. A referência tem uma **seta ao lado** do microfone e do fone abrindo um
popover curto.

Implementar: uma seta (`⌄`) anexada ao botão de microfone e ao de vídeo, cada uma
abrindo um popover ancorado **ao próprio botão** com: dispositivo de entrada
(mic) ou câmera (vídeo), volume, e um link "Configurações completas" que abre a
tela da T6.

- Arquivos: `apps/web/src/ui/Call.tsx` (componente `CallButton`, linhas ~640-656;
  barra em ~519-551), `apps/web/src/ui/DevicePicker.tsx`, `apps/web/src/styles.css`.
- Reaproveite `.call-devices` como o "ver tudo"; **não** duplique a lógica de
  seleção de dispositivo.

**Aceite:**
1. A seta aparece só ao lado de microfone e vídeo, e é alvo de toque ≥ 40×40 px.
2. O popover fecha ao clicar fora, ao pressionar `Esc`, e ao abrir o outro.
3. Trocar dispositivo pelo popover surte efeito na chamada em andamento sem
   derrubá-la (mesma garantia da T2 do painel atual).
4. Em 412 px de largura o popover cabe na tela e não cobre a barra de controles.
5. Navegável por teclado: `Tab` alcança a seta, `Enter` abre, `Esc` fecha.

---

### T2 — Câmera no mobile (frontal/traseira)
**sem imagem** · bug · prioridade **alta** · complexidade **média** ·
plataformas: mobile (web e APK)

A troca é 100% por `deviceId`; `facingMode` não aparece em lugar nenhum.
`switchActiveDevice` **só aceita deviceId** (apurado).

**Decidido em `DECISOES.md` (D4), com evidência.** Três achados mudam o
caminho:
- O **Android System WebView** tem bug documentado: `enumerateDevices` devolve
  `label` vazio (issues.chromium.org/issues/41288617). O app roda em WebView, não
  no Chrome — então seleção por `deviceId` é não confiável justamente no celular.
- O Android costuma permitir **uma câmera aberta por vez**, e
  `switchActiveDevice` pede a nova com `exact: true` sem liberar a anterior →
  `OverconstrainedError`.
- **`LocalVideoTrack.restartTrack({ facingMode })` existe e é o caminho certo** —
  troca a track sob o sender, sem despublicar. `VideoCaptureOptions` aceita
  `facingMode`.

Implementar: botão "virar câmera" no celular chamando `restartTrack`; seletor por
`deviceId` no desktop. A escolha é por **capacidade detectada** (as câmeras vêm
rotuladas?), não por user-agent.

- Arquivos: `apps/web/src/lib/devices.ts`, `apps/web/src/ui/DevicePicker.tsx`,
  `apps/web/src/ui/Call.tsx`.
- Documente a solução por plataforma no `docs/decisoes.md`.

**Aceite:**
1. Num Android real, com a câmera ligada, existe um controle que alterna
   frontal/traseira e a imagem publicada muda **para os outros participantes**
   (não só no preview local).
2. A troca não derruba a chamada nem interrompe o áudio.
3. No desktop o seletor por `deviceId` continua funcionando como hoje
   (teste de regressão obrigatório).
4. Teste unitário da função de decisão (qual estratégia usar) rodando em Node.

---

### T3 — Bug de proporção no compartilhamento de tela
**sem imagem** · bug · prioridade **alta** · complexidade **média** ·
plataformas: web, desktop

Sintoma: *"fica esticado como widescreen, fora da resolução correta"*.

**Hipótese descartada, não só enfraquecida.** O grupo de trabalho do WebRTC
decidiu explicitamente que `getDisplayMedia` faz **crop-and-scale** e **nunca
distorce** (lists.w3.org/Archives/Public/public-webrtc-logs/2019May/0044.html).
Somado a isso, `object-fit: contain` não pode matematicamente esticar. As duas
suspeitas óbvias estão eliminadas — **inclusive a de que `.tile.screen
{ aspect-ratio: 16/9 }` distorceria: ela produz barras, não esticamento.**

Esta tarefa é de **medição antes de código**. Ordem:
1. **Meça antes de mexer.** Numa chamada real, do lado de quem recebe:
   `track.mediaStreamTrack.getSettings()` dá a resolução que chegou. Compare com
   a resolução da tela compartilhada. Bateu → problema é CSS. Não bateu →
   captura.
2. Lado do receptor: `.call-stage.focus .stage-main .tile` usa
   `aspect-ratio: auto; height: 100%` e `.tile video` usa `object-fit: contain`.
   `contain` deveria criar barras, não esticar — confirme com tela 16:10 real.
3. Divergência de fps: a captura pede 30, o encoding entrega 15. Não distorce,
   mas é desperdício — arrume junto.
4. Só então teste passar `resolution` explicitamente.

- Arquivos: `apps/web/src/lib/screenshare.ts`, `apps/web/src/ui/Call.tsx`
  (`toggleShare`), `apps/web/src/styles.css` (`.call-stage.focus`, `.tile`).

**Aceite:**
1. Compartilhar uma **janela estreita**, uma tela **16:10** e uma **ultrawide**:
   em nenhum caso o texto sai esticado nem há barra deformada.
2. Um teste automatizado que reproduza o cenário — no mínimo, comparação entre
   `getSettings()` da track e as dimensões renderizadas do `<video>`.
3. Os 69 testes de `tests/devices.test.ts` continuam passando.

---

### T4 — Avatares de quem está na chamada 🛑
**Imagens #12 (onde exibir) e #13 (estilo do tooltip)** · feature ·
prioridade **média** · complexidade **alta** · plataformas: todas

**Não é tarefa de interface.** Três problemas apurados precisam ser resolvidos
antes de desenhar qualquer avatar:

1. A presença de voz **não é persistida em lugar nenhum** — some depois de um F5.
2. `call:joined` é emitido ao **pedir token**, não ao conectar.
3. O payload não traz `avatarUrl`.

O trabalho honesto é dar à presença de voz uma **fonte de verdade** (chave no
Redis alimentada pelos webhooks do LiveKit, ou uma rota de listagem consultada ao
montar a tela) e só então desenhar. Fazer só o desenho entrega uma tela que mente
após qualquer recarga.

🛑 **Apresente a proposta de arquitetura da presença antes de implementar.**

- Arquivos: `apps/api/src/routes/calls.ts`, `apps/api/src/realtime/socket.ts`,
  `apps/api/src/lib/redis.ts`, `apps/web/src/lib/socket.ts`,
  `apps/web/src/store.ts`, `apps/web/src/ui/Sidebar.tsx` (`RoomRow`, ~267-330).
- Tooltip no estilo da imagem #13: nome + estado (mudo/falando).

**Aceite:**
1. Dois navegadores: entrar na voz num e o avatar aparece no outro em < 2 s.
2. **Recarregar a página e o avatar continuar lá.**
3. Fechar a aba sem sair da chamada e a pessoa desaparecer em tempo razoável
   (defina e documente o limite).
4. Pedir token e **não** entrar não marca a pessoa como presente.
5. Tooltip mostra o nome; com teclado, aparece no foco.

---

### T5 — Ícone de grupo, reordenar espaços e pastas 🛑
**Imagem #14** · feature · prioridade **média** · complexidade **alta** ·
plataformas: todas

Três subtarefas com dependência entre si.

**T5a — Ícone de grupo/espaço** (complexidade baixa)
`Space.iconUrl` e `Room.iconUrl` já existem. Falta `PATCH /spaces/:id` e
`PATCH /rooms/:id`, **validação de que é imagem** e **redimensionamento** (hoje
um ícone de 8 MB seria servido inteiro em cada render). Quem pode trocar: ver
seção 8.

**T5b — Reordenar canais** (complexidade baixa) — **faça antes da T5c**
`Room.position` já existe e já ordena. Falta só a rota de atualização e o
arrastar. É o caminho mais barato para validar a biblioteca de DnD escolhida.

**T5c — Reordenar espaços** (complexidade média)
**Não existe campo de ordem.** Migração necessária: o lugar certo é
`SpaceMember.position`, **não** `Space` — a ordem é de cada pessoa, não do
espaço. `GET /spaces` precisa de `orderBy`.

**T5d — Pastas** (complexidade alta) — **só depois da T5c em produção**
Modelo novo (`SpaceFolder`: nome, cor, posição, dono). Arrastar um espaço sobre
outro cria a pasta.

🛑 **Apresente o desenho do modelo de dados de T5c e T5d antes de migrar.**

- Nenhuma lib de DnD instalada. Escolha uma com suporte a **teclado** e a
  **toque** — a barra lateral tem que continuar operável no celular.

**Aceite:**
1. Arrastar reordena, e a ordem **sobrevive a recarga e a outro dispositivo**.
2. A ordem é por usuário: reordenar numa conta não muda a de outra.
3. Operável por teclado (mover item para cima/baixo sem mouse).
4. No celular, arrastar não conflita com o gesto de rolagem.
5. Ícone: arquivo não-imagem é recusado com mensagem clara; imagem grande é
   redimensionada no servidor.

---

### T6 — Perfil, temas e idioma 🛑
**Imagens #15 (perfil), #16 (temas), #17 (idioma)** · feature ·
prioridade **média** · complexidade **alta** · plataformas: todas

**T6a — Tela de configurações seccionada** (média)
Modelo da imagem #15: navegação à esquerda, conteúdo à direita. Categorias
mínimas: **Conta, Áudio, Vídeo, Aparência, Idioma, Notificações**. Absorve o
`DevicePicker`, que hoje vive solto, e vira a casa de T6b e T6c.
🛑 **Proponha a estrutura de categorias antes de implementar** (pedido explícito
do dono). **Se usar rota por caminho, leia a armadilha A.**

**T6b — Temas** (média)
26 variáveis já em `:root`, mas **45 cores literais fora dele** que não trocariam,
e `color-scheme: dark` fixo na linha 56. **O trabalho real é essa varredura, não
o seletor.** Entregar: escuro (atual), claro, e "igual ao do sistema" via
`prefers-color-scheme`. Mecanismo: `data-theme` na raiz + redefinição das
variáveis.

**T6c — Idioma: inglês, português, espanhol** (alta)
~285 strings no cliente **mais 42 mensagens de erro da API**. Decidir cedo (seção
8): a API devolve código de erro e o cliente traduz, ou aceita-se erro em inglês.
Estruture para adicionar idioma novo sem tocar em componente. Cuidar de:
`format.ts` (`"Today"`/`"Yesterday"`, sufixos de tamanho), plurais, e o atributo
`lang` do documento.

- Arquivos: `apps/web/src/ui/Settings.tsx`, `apps/web/src/ui/DevicePicker.tsx`,
  `apps/web/src/styles.css`, `apps/web/src/lib/format.ts`, **todos** os `ui/*.tsx`,
  e `apps/api/src/routes/*.ts` se a decisão for código de erro.

**Aceite:**
1. Percorrer **todas** as telas nos 3 temas sem texto ilegível — a tela de
   chamada e o seletor de emoji são os pontos mais prováveis de falha.
2. Trocar idioma reflete sem recarregar; a escolha sobrevive a recarga.
3. Nenhuma string visível hardcoded fora do sistema de tradução (varredura
   automatizada no CI).
4. Datas e tamanhos de arquivo seguem o idioma escolhido.
5. Perfil: trocar avatar e nome, com o avatar aparecendo nas outras telas.

---

### T7 — Gestão de membros (pendência anterior, incluída por dependência)
sem imagem · feature · prioridade **baixa** · complexidade **média**

Remover membro de espaço e de grupo · promover/rebaixar · regerar código de
convite · a checagem de papel que falta em `POST /rooms/:id/members`.

Frente única, com um agent responsável por autorização de ponta a ponta, porque a
API hoje quase não usa `role`. Depende das decisões da seção 8.

---

## 5. Divisão em sub-agents

Sete agents. **A arquitetura é uma WebView única**, então a divisão é por
domínio, não por plataforma — exceto QA, que é por plataforma.

| Agent | Escopo | Tarefas |
|---|---|---|
| **A1 · call-ui** | barra de chamada, popovers, palco | T1, T3 (lado CSS) |
| **A2 · media** | captura, dispositivos, LiveKit | T2, T3 (lado captura) |
| **A3 · realtime** | API + socket + Redis | T4 (backend), T7 |
| **A4 · sidebar** | barra lateral, DnD, pastas | T5 |
| **A5 · settings** | tela de configurações, temas | T6a, T6b |
| **A6 · i18n** | tradução e formatação | T6c |
| **A7 · qa** | testes em web, Android e Windows | tudo |

**Ordem e paralelismo:**

```
Onda 1 (paralelo):  A1→T1    A2→T2    A3→T7    A4→T5b
Onda 2 (paralelo):  A2+A1→T3          A5→T6a           A3→T4 (após 🛑)
Onda 3 (paralelo):  A5→T6b   A6→T6c   A4→T5a + T5c (após 🛑)
Onda 4:             A4→T5d   (só com T5c em produção e estável)
```

**Colisões a evitar:**
- A1 e A2 tocam `Call.tsx` na T3 — dividam por região do arquivo ou serializem.
- A5 e A6 tocam todos os `ui/*.tsx` na onda 3, mas em eixos diferentes (cor vs.
  string). Aceitável em paralelo; combinem a ordem de merge.
- **Decida a armadilha A antes da onda 2** — T6a pode depender dela, e verificar
  exige construir e instalar o desktop.

---

## 6. Plano de testes

### Por tarefa

| Tarefa | Unitário (Node, `tsx`) | Integração (API) | E2E / manual |
|---|---|---|---|
| T1 | — | — | 2 navegadores; teclado; 412 px |
| T2 | função de decisão de estratégia | — | **Android real**: trocar câmera e confirmar no outro participante |
| T3 | comparação `getSettings()` × render | — | janela estreita, 16:10, ultrawide |
| T4 | redutor de presença | rota/evento de presença, incl. caminho negativo | 2 navegadores + **recarga** + fechar aba |
| T5 | ordenação e reordenação (puro) | rotas de `PATCH`/reorder, incl. sem permissão | arrastar com mouse, toque e teclado |
| T6 | seleção de tema, resolução de idioma, plural | erro traduzido, se a decisão for código | todas as telas × 3 temas × 3 idiomas |
| T7 | — | cada rota, incl. quem **não** tem permissão e chamada repetida | — |

**Regras:**
- Lógica pura **sem tocar em `window`**, para rodar em Node. Foi o que permitiu
  43 testes de convite sem navegador.
- Teste de interface mede **estado** (store ou API), não aparência. Dois "bugs"
  do dia anterior eram **falsos positivos de seletor CSS** — desconfie do seu
  seletor antes de declarar defeito.
- Responsividade: a ferramenta de redimensionar janela **não funciona** nesta
  máquina. O que funciona é um **iframe de 412×880** apontando para o app; as
  media queries respondem à largura do iframe e dá para medir com
  `getBoundingClientRect`.

### Suítes existentes — nenhuma pode regredir

```bash
npx tsx tests/devices.test.ts    # 69 — dispositivos, som, compartilhamento
npx tsx tests/deeplink.test.ts   # 43 — parsing de convite
node tests/run.mjs               # 227 — integração contra a API de PRODUÇÃO
```

### Integração e regressão de chamada (obrigatório antes de fechar)

Roteiro completo, com duas contas reais: entrar na chamada · mutar e desmutar ·
ligar e desligar câmera · **trocar câmera (mobile)** · compartilhar tela **com
áudio** · parar o compartilhamento pela barra do navegador · sair · **reconectar
após queda de rede** · entrar num espaço por link · sair do espaço.

---

## 7. Build e deploy

### Web (produção)

```bash
npm run build:web
git push origin main            # ver armadilha E se travar
# deploy pelo Coolify: POST /api/v1/deploy?uuid=89b958lxroj7y55yucmdeyfm
```

**Verificação obrigatória:** buscar uma string nova no bundle **servido**, não
confiar no `"deployment queued"`.

```bash
curl -s https://whatscord.167.88.39.225.sslip.io/ | grep -o 'assets/index-[^"]*\.js'
curl -s https://whatscord.167.88.39.225.sslip.io/assets/index-XXXX.js | grep -c "sua-string-nova"
```

### API

Mesma rota de deploy, uuid `wk62aoxzoqblzeivwxzrleqx`. Verificação: chamar a rota
nova e conferir que responde **401** (existe, exige auth) e não **404** (não
existe).

### Windows — `.exe` e instalador

```bash
npm run dist --workspace apps/desktop
# saida: apps/desktop/src-tauri/target/release/bundle/nsis/WhatsCord_0.1.0_x64-setup.exe
# executavel avulso: apps/desktop/src-tauri/target/release/whatscord-desktop.exe
```

Verificações: o instalador é **mais novo** que `apps/web/dist/`; e o esquema está
registrado —
`grep -c "Classes.whatscord" apps/desktop/src-tauri/target/release/nsis/x64/installer.nsi`.

### Android — APK

```bash
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
cd apps/desktop

# compila o Rust e PARA no erro de link simbolico — isso e esperado
npx tauri android build --apk --debug --target aarch64 || true

cd src-tauri
STRIP="$NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe"
mkdir -p gen/android/app/src/main/jniLibs/arm64-v8a
"$STRIP" --strip-unneeded \
  -o gen/android/app/src/main/jniLibs/arm64-v8a/libwhatscord_desktop_lib.so \
  target/aarch64-linux-android/debug/libwhatscord_desktop_lib.so

cd gen/android
./gradlew assembleArm64Debug -x rustBuildArm64Debug -x rustBuildUniversalDebug
# saida: app/build/outputs/apk/arm64/debug/app-arm64-debug.apk
```

Verificações:

```bash
"$ANDROID_HOME/build-tools/35.0.0/aapt2.exe" dump permissions <apk>   # CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS
"$ANDROID_HOME/build-tools/35.0.0/apksigner.bat" verify --print-certs <apk>
```

O APK de depuração sai assinado com a chave padrão do Android e instala por
sideload. Release assinado precisa de keystore próprio — a senha é do dono, não
vai para o repositório.

### Definição de pronto

Os **quatro artefatos da mesma revisão**, as três suítes passando, e o roteiro de
regressão da seção 6 executado **no artefato**, não em `vite dev`.

---

## 8. Decisões do dono — pergunte, não invente

1. **Estrutura de categorias** da tela de configurações (pedido explícito de
   proposta antes de implementar).
2. **Quem pode trocar o ícone** de espaço/grupo: só o dono, dono e admin, ou
   qualquer membro?
3. **Quem pode remover membros**, e o que acontece com as mensagens de quem saiu.
   Precedente já estabelecido ao sair de um espaço: **as mensagens ficam**.
4. **Regerar o convite invalida o código antigo?** (esperado: sim)
5. **As mensagens de erro da API viram códigos traduzíveis?** Muda o contrato da
   API.
6. **Idioma padrão** de quem chega sem preferência: inglês ou o do navegador?
7. **Onde exibir os avatares** da chamada: a imagem #12 aponta a linha do canal
   de voz na barra lateral. Confirmar se é ali ou no cabeçalho da conversa.

---

## 9. Higiene

- Credenciais em texto puro circularam nas sessões anteriores (token do Coolify,
  PAT do GitHub, senha de root do SSH). **Devem ser rotacionadas.** Não as
  replique em arquivo, log ou mensagem de commit.
- O repositório é **público**. Varra os arquivos antes de cada commit.
- Mensagem de commit explica **por quê**, não o quê.
- Ao corrigir algo que este documento afirma, **corrija o documento junto**. Ele
  já contém uma correção de uma afirmação errada anterior sobre camadas de
  simulcast e outra sobre a causa do bug de tela; é assim que ele continua
  confiável.
