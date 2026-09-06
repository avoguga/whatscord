# WhatsCord — briefing para o próximo time de agentes

Este documento é escrito **para um agente coordenador** que vai dividir o
trabalho abaixo entre um time e levar tudo a produção. Leia até o fim antes de
distribuir qualquer tarefa: metade do valor daqui está na seção de armadilhas,
não na lista de tarefas.

Data do levantamento: **06/09/2026**. Tudo que está marcado como *apurado* foi
verificado no código ou em execução nesta data; o que está marcado como
*hipótese* não foi.

---

## 1. O método, que não é negociável

O dono do produto pediu esta ordem, explicitamente, e ela é o que pegou os três
erros mais caros do dia anterior:

1. **Pesquisar para validar.** Ler a fonte real — código do SDK, `.d.ts`,
   `installer.nsi` gerado, `AndroidManifest.xml` — antes de assumir. A
   documentação oficial do LiveKit e do Tauri é rasa nos tópicos avançados e já
   levou a conclusões erradas aqui.
2. **Planejar** com o que a pesquisa mostrou, não com o que se supunha.
3. **Executar.**
4. **Testar.**
5. **Testar de novo depois de pronto**, no artefato final, não no ambiente de
   desenvolvimento.

Três exemplos reais de por que o passo 1 existe:

- Um documento deste repositório afirmava em negrito *"não use `network_mode:
  host`"*. Era pesquisa sem execução. Estava errado, e foi a causa de **nenhuma
  chamada externa conectar** por dias.
- O link de convite `/join/<código>` parecia funcionar e **não subia o app**,
  porque o Vite está com `base: "./"` e o bundle era procurado em
  `/join/assets/`. Só apareceu ao abrir o link de verdade.
- Dentro do app desktop, `location.origin` é `http://tauri.localhost`. O link de
  convite gerado ali parecia normal na tela e **não abria em nenhuma outra
  máquina**.

Nenhum dos três apareceria numa revisão de código. Todos apareceram ao executar.

---

## 2. O que é o produto e o que já está no ar

WhatsCord: recursos de Discord (espaços, canais de texto, salas de voz,
chamadas, compartilhamento de tela) com a interface do WhatsApp.

| Peça | Onde | Estado |
|---|---|---|
| Web | `https://whatscord.167.88.39.225.sslip.io` | no ar |
| API | `https://api.whatscord.167.88.39.225.sslip.io` | no ar, `/health` responde estado real |
| LiveKit | `wss://livekit.167.88.39.225.sslip.io` | no ar, `network_mode: host` |
| Desktop | `WhatsCord-0.1.0-setup.exe` (NSIS) | construído, instalável |
| Android | `WhatsCord-0.1.0-arm64.apk` | construído, **nunca executado num aparelho** |

Monorepo npm workspaces: `apps/api` (Fastify + Prisma + Socket.IO),
`apps/web` (React 19 + Vite + Zustand), `apps/desktop` (Tauri v2).

Leia antes de começar: `docs/decisoes.md`, `docs/operacao.md`,
`docs/livekit-coolify.md`, `docs/android.md`.

---

## 3. Fatos já apurados — não gaste tempo redescobrindo

### Banco de dados (`apps/api/prisma/schema.prisma`)

| Pergunta | Resposta apurada |
|---|---|
| `User.avatarUrl` | **existe** (`String?`), nunca usado na interface |
| `Space.iconUrl` | **existe** (`String?`), nunca usado |
| `Room.iconUrl` | **existe** (`String?`), usado só na leitura |
| `Room.position` | **existe** (`Int @default(0)`) e **já ordena** os canais (`spaces.ts:22`) |
| Ordem de espaços | **não existe campo nenhum**. `GET /spaces` não tem `orderBy` |
| Pasta/categoria de espaço | **não existe** |
| `MemberRole` | enum `OWNER | ADMIN | MEMBER`, existe em `SpaceMember` e `RoomMember` |

### Autorização por papel

Existe **exatamente uma** verificação em toda a API
(`apps/api/src/routes/spaces.ts:94`): criar canal recusa quem é `MEMBER`
— *"Only admins can add channels."*

Todo o resto ignora `role`. Em particular, `POST /rooms/:id/members` deixa
**qualquer membro** de um grupo adicionar terceiros.

### Rotas que NÃO existem hoje

- remover membro de um espaço · remover membro de um grupo · mudar `role`
- trocar ícone de espaço (`PATCH /spaces/:id` não existe) · trocar ícone de
  grupo (`PATCH /rooms/:id` não existe)
- reordenar espaços · reordenar canais (o campo existe, a rota não)
- regerar/revogar o código de convite

**Já existe, ao contrário do que se poderia supor:** `PATCH /users/me` aceita
`avatarUrl`. O avatar do usuário está pronto no servidor — falta só a interface
e a validação de imagem.

### Rotas que existem e são relevantes

- `DELETE /rooms/:id/members/me` — sair de um grupo
- `DELETE /spaces/:id/members/me` — sair de um espaço (novo, testado 15/15 em
  produção: dono saindo transfere a posse ao membro mais antigo; último membro
  saindo apaga o espaço)
- `POST /spaces/join/:code` — entrar por convite
- `POST /files` — upload, limite `MAX_UPLOAD_MB`, MIME saneado. **Não valida que
  é imagem nem redimensiona** — dá para reaproveitar para ícone/avatar, mas
  precisa dessas duas coisas.

### Interface

- **~285 ocorrências** de string de interface em `apps/web/src/`, contando cada
  ramo de ternário e cada local separadamente (cada um vira um `t(...)`).
  Concentração: `Chat.tsx` 52, `Call.tsx` 49, `Invites.tsx` 45, `Sidebar.tsx` 38,
  `Auth.tsx` 23. Mais 19 espalhadas em `lib/` — inclusive "Today"/"Yesterday" e
  os sufixos "B"/"KB"/"MB" em `format.ts`.
- **42 mensagens de erro distintas** vindas da API (45 pontos de retorno em
  `routes/*.ts` mais 1 em `lib/rooms.ts`), exibidas direto via `err.message`.
  Tradução só no cliente **não cobre essas** — decidir cedo se a API passa a
  devolver código de erro em vez de frase.
- Datas já são locale-aware: `format.ts` usa `Intl.DateTimeFormat(undefined, …)`,
  então ordem dos números e nome do dia já seguem o sistema. O que não segue são
  os textos ao redor.
- **26 variáveis** no `:root` de `styles.css`, mais 4 de safe-area. E
  **45 cores literais fora do `:root`** que não trocariam junto com o tema.
  `color-scheme: dark` está **fixo** na linha 56. Zero suporte a
  `prefers-color-scheme` ou `data-theme`.
- Boa notícia: as 13 cores inline em JSX (`style={{ color: … }}`) **já usam
  `var(--…)`** — nenhuma cor literal embutida em componente.
- **Nenhuma biblioteca de i18n** e **nenhuma de drag-and-drop** instalada.

### LiveKit (v2.22.x, lido do `.d.ts` e do bundle compilado)

```js
publishDefaults = {
  simulcast: true,
  screenShareEncoding: ScreenSharePresets.h1080fps15.encoding, // 1920x1080, 2.5Mbps, 15fps
  videoCodec: 'vp8',
  backupCodec: true,
}
roomOptionDefaults = { adaptiveStream: false, dynacast: false }  // desligados por padrão
```

- Para **tela**, o simulcast padrão gera **1 camada extra** (metade da
  resolução), não 3. O comentário *"defaults to h180, h360"* no `.d.ts` é de
  `videoSimulcastLayers`, que vale para **câmera**. É fácil ler errado.
- `degradationPreference` já tem default por fonte:
  `ScreenShare → maintain-resolution`, `Camera → maintain-framerate`.
- `contentHint` **não** é aplicado sozinho, exceto com codec SVC (vp9/av1), onde
  o SDK força `motion` para contornar bug do Chrome com screenshare.
- `ScreenShareCaptureOptions.resolution`: quando não passamos, o SDK aplica
  `ScreenSharePresets.h1080fps30.resolution` (1920×1080 **a 30 fps**) — note que
  isso diverge do `screenShareEncoding` padrão, que é 15 fps.
  E o mais importante: vira `width: { ideal: 1920 }, height: { ideal: 1080 }` —
  **`ideal`, não `exact`** (só o Safari recebe `max`). `aspectRatio` **não** é
  enviado. Ou seja, o navegador fica livre para devolver outra proporção: o SDK
  **não** força 16:9.
- vp9/av1 em screenshare no Chrome é área historicamente instável, segundo
  comentário dos próprios mantenedores no código.

---

## 4. Armadilhas — leia antes de tocar em qualquer coisa

### A. `base: "./"` no Vite quebra qualquer rota aninhada

`apps/web/vite.config.ts` tem `base: "./"` por exigência do app desktop. O
`index.html` referencia os assets relativamente, então **qualquer** caminho
aninhado (`/join/x`, `/settings/audio`) faz o navegador procurar o bundle em
`/join/assets/…`, receber o HTML de volta pelo fallback de SPA, e não subir.

Por isso o link de convite é `/?join=<código>`.

Se o time quiser rotas de verdade (provável, para a tela de configurações
seccionada), a mudança é `base: "/"` — que é o padrão do template oficial do
Tauri v2 e **deve** funcionar, porque a WebView serve de `http://tauri.localhost/`.
**Não foi verificado.** Verificar assim: mudar, `npm run dist`, instalar e abrir
o app; se a janela subir em branco, reverter. Um app desktop em branco é a
regressão mais cara possível aqui.

### B. Coolify e o LiveKit

- O LiveKit roda em `network_mode: host` porque o Coolify anexa todo Service a
  **duas** redes e o LiveKit abre um socket por interface (nunca em `0.0.0.0`) —
  a resposta ICE saía pela interface errada e morria dentro do container.
- Com host networking o Traefik **não roteia por label**. O roteamento vive em
  `/data/coolify/proxy/dynamic/whatscord-livekit.yml`, **fora do deploy**. Se o
  proxy for recriado, o `wss://` para de responder sem nada aparecer no log.
  Cópia canônica: `infra/traefik-livekit.yml`.
- `NODE_ENV=production` injetado pelo Coolify quebra o build (npm pula
  devDependencies). O Dockerfile força `NODE_ENV=development` no estágio de build.
- O `HEALTHCHECK` tem que estar **na imagem**; o Coolify não injeta um.

### C. Android

- `tauri android init` gera manifesto só com `INTERNET`. Sem `CAMERA`,
  `RECORD_AUDIO` e `MODIFY_AUDIO_SETTINGS` a chamada entra muda e cega.
- Por isso `src-tauri/gen/android` **é versionado neste repositório**, contra a
  convenção do Tauri (que ignora `gen/`). Se voltar a ignorar, o manifesto se
  perde silenciosamente num clone novo.
- **Tensão não resolvida, decidir cedo:** o wry 0.55.1 usado aqui **já
  implementa** `onPermissionRequest` no `RustWebChromeClient.kt` (lido no fonte
  em `~/.cargo/registry/.../wry-0.55.1/src/android/kotlin/`), pedindo as
  permissões de runtime. Mas as issues `tauri-apps/tauri#10846` e `#12041`
  relatam que só o manifesto não basta e que é preciso um
  `WebChromeClient.onPermissionRequest` customizado em `MainActivity.kt`.
  Essas issues são de versões anteriores do wry. **Só o teste num aparelho real
  decide.** Se `getUserMedia` falhar no APK, o caminho é a discussão
  `tauri-apps/discussions#12732`.
- `getDisplayMedia` **não funciona** no WebView do Android (exigiria a API
  MediaProjection nativa). O app já detecta (`canShareScreen`) e desabilita o
  botão explicando.
- No Windows o build falha ao criar o link simbólico da `.so`. Não mexa na
  configuração do sistema: o Rust já compilou nesse ponto; copie a biblioteca e
  chame o Gradle direto. **O `llvm-strip` não é opcional** — 152 MB com símbolos,
  17,8 MB sem. Passo a passo em `docs/android.md`.
- `set_badge_count` não existe no Android; use `#[cfg(all(not(windows), desktop))]`
  com uma não-operação em `#[cfg(mobile)]`.

### D. Links de convite

- No Windows o sistema **não avisa um app aberto**: abre uma instância nova com
  a URL como argumento. O `single-instance` repassa o `argv`. **Não ligue a
  feature `deep-link` do single-instance** — ela faz a mesma chamada antes do
  callback e o convite chegaria duas vezes.
- Quem registra o esquema é o **instalador NSIS**, a partir de
  `plugins.deep-link.desktop.schemes`. `register_all()` só em depuração.
- Dentro do app, `location.origin` é `http://tauri.localhost` — use
  `shareOrigin()` de `lib/deeplink.ts` para qualquer link compartilhável.

### E. Dispositivos de mídia

- A permissão é concedida **por tipo**: câmera e microfone são separados. Uma
  checagem global de "já temos algum rótulo?" dá permissão por concedida quando
  só a câmera foi liberada.
- Antes da permissão o Chrome **não devolve lista vazia**: devolve um
  placeholder por tipo com id e rótulo vazios. Oferecê-los no seletor faz a
  escolha não surtir efeito, em silêncio.
- **Nunca desabilite o seletor** por falha de enumeração — "System default" é
  sempre uma escolha legítima. Já houve regressão exatamente assim.

### F. Ambiente de desenvolvimento

- Heredoc no Git Bash desta máquina falha com "unexpected EOF". Escreva um
  script Python no diretório de scratch e execute.
- `DELETE` sem corpo **não pode** mandar `Content-Type: application/json` — o
  Fastify responde 400. O cliente (`lib/api.ts`) já faz certo; scripts de teste
  costumam errar.
- Git converte LF para CRLF ao escrever. Ler com Python em modo texto normaliza,
  mas `str.replace` de blocos multilinha pode falhar em silêncio. Prefira
  edições por número de linha com `assert` do conteúdo esperado.
- Ao construir o instalador, confirme que ele é **mais novo** que
  `apps/web/dist/` — é fácil empacotar um front antigo.

---

## 5. As tarefas, classificadas

Legenda de risco: **baixo** = isolado, reversível · **médio** = toca estado
compartilhado ou várias telas · **alto** = pode quebrar artefato de produção.

### Grupo 1 — Bugs (fazer primeiro, são regressões percebidas)

**B1. Proporção errada no compartilhamento de tela** · risco baixo · *bug*
Sintoma relatado: *"fica bugado como se estivesse widescreen sem estar na
resolução correta"*.

**A hipótese óbvia foi investigada e enfraquecida.** Suspeitava-se de que o
`resolution` default (1920×1080) forçasse 16:9. Ao ler o bundle do
livekit-client, as constraints saem como `width: { ideal: 1920 }` — **`ideal`,
não `exact`** — e `aspectRatio` nunca é enviado. Com `ideal`, o navegador é livre
para devolver a proporção nativa da fonte. O SDK provavelmente **não** é o
culpado.

Onde procurar agora, em ordem:
1. **O lado de quem recebe.** `.call-stage.focus .stage-main .tile` usa
   `aspect-ratio: auto; height: 100%`, e `.tile video` usa `object-fit: contain`.
   `contain` deveria criar barras em vez de esticar — confirme com uma tela 16:10
   real e o inspetor aberto, medindo `videoWidth`/`videoHeight` da track contra o
   tamanho renderizado.
2. **Reproduzir e medir antes de mexer.** Numa chamada real, do lado de quem
   recebe: `track.mediaStreamTrack.getSettings()` dá a resolução que de fato
   chegou. Compare com a resolução da tela compartilhada. Se baterem, o problema
   é CSS; se não baterem, é captura.
3. **A divergência de fps** (captura pede 30, encoding entrega 15) não causa
   distorção, mas é desperdício — vale arrumar junto.
4. Só depois de 1–3, testar passar `resolution` explicitamente.

Teste de aceite: compartilhar uma janela estreita e uma tela ultrawide; a imagem
recebida não pode ter barras deformadas nem texto esticado.

**B2. Câmera não trocável no celular** · risco baixo · *bug*
Hoje a troca é 100% por `deviceId`; `facingMode` não aparece em lugar nenhum do
código.

Apurado: `room.switchActiveDevice(kind, deviceId, exact?)` **só aceita
deviceId** — não há como passar `facingMode` por ali. A MDN confirma que
`facingMode` é a constraint para escolher a direção da câmera e traz o próprio
exemplo de "trocar de câmera" com `applyConstraints`, mas **não** afirma que
deviceId seja pouco confiável em celular. Ou seja: a premissa "no celular tem que
ser facingMode" é plausível e **não está confirmada** — comece medindo.

Primeiro passo: num celular real, logar o resultado de `enumerateDevices()` e ver
se as câmeras vêm com deviceIds distintos e rotulados. Se vierem, o seletor atual
pode simplesmente funcionar e a tarefa vira só de interface. Se não vierem, o
caminho é republicar a track de vídeo com `facingMode`, contornando o
`switchActiveDevice`.

### Grupo 2 — Chamada e voz

**C1. Atalhos de configuração ao lado de microfone e vídeo** · risco baixo
Uma seta ao lado de cada botão abrindo um popover — modelo do Discord
(dispositivo de entrada, perfil de entrada, volume de entrada, atalho para as
configurações completas). O painel `.call-devices` já existe e pode ser
reaproveitado como o "ver tudo".

**C2. Ampliar o painel de configurações da chamada** · risco baixo
Hoje só dispositivos. Acrescentar pelo menos: volume de entrada e de saída,
supressão de ruído e cancelamento de eco (`AudioCaptureOptions` do LiveKit já
aceita), e o modo de compartilhamento que já existe.

**C3. Avatares de quem está na sala de voz, na barra lateral** · risco **alto**
(reclassificado depois do inventário — é mais do que interface)

O que existe: `voicePresence: Record<roomId, userId[]>` no store, e a barra
lateral só usa a **contagem** (`"3 connected"` / `"Nobody here right now"`).

Três problemas apurados que precisam ser resolvidos antes dos avatares:

1. **A presença não é persistida em lugar nenhum.** O Redis só guarda
   online/offline geral (`whatscord:online`); não há chave de "quem está na sala
   de voz X". A presença existe só como evento efêmero de socket. **Depois de um
   F5 o objeto volta vazio** e só se preenche com eventos futuros — quem já
   estava na chamada some da tela.
2. **`call:joined` é emitido em `POST /rooms/:id/call/token`**, ou seja, toda vez
   que alguém pede token — inclusive em reconexão. Não está atrelado ao evento
   real de conexão do LiveKit. Pedir token e não entrar marca a pessoa como
   presente.
3. O payload de `call:joined` traz `{ roomId, userId, displayName }` — **sem
   `avatarUrl`**. Já dá para mostrar iniciais; para avatar de imagem, ou enriquece
   o evento, ou o cliente resolve pelo roster.

O trabalho honesto aqui é dar à presença de voz uma fonte de verdade (chave no
Redis, alimentada pelos webhooks do LiveKit ou por uma rota de listagem
consultada ao montar a tela), e só então desenhar os avatares. Fazer só o
desenho entrega algo que mente depois de qualquer recarga.

Teste de aceite: dois navegadores; entrar na voz num e ver o avatar aparecer no
outro em menos de 2 s; **recarregar a página e o avatar continuar lá**; fechar a
aba sem sair da chamada e ver a pessoa desaparecer em tempo razoável.

### Grupo 3 — Identidade e organização

**I1. Trocar o ícone de grupo e de espaço** · risco médio
`Space.iconUrl` e `Room.iconUrl` já existem. Falta: rota `PATCH`, validação de
que o arquivo é imagem, e redimensionamento (hoje o upload aceita qualquer MIME
e não redimensiona — um ícone de 8 MB seria servido inteiro em cada render).
Quem pode trocar: **decisão do dono do produto**, ver seção 7.

**I2. Avatar do usuário** · risco baixo
`User.avatarUrl` existe **e `PATCH /users/me` já o aceita**. Falta só a interface
(escolher arquivo, enviar por `POST /files`, gravar a URL) e a mesma validação de
imagem de I1. É a tarefa mais barata da lista inteira.

**I3. Reordenar espaços por arrastar** · risco médio
**Não existe campo de ordem para espaço.** Precisa de migração — o lugar certo é
`SpaceMember.position`, não `Space`, porque a ordem é de cada pessoa, não do
espaço. `GET /spaces` precisa de `orderBy`. Nenhuma biblioteca de DnD instalada;
escolher uma com suporte a teclado (acessibilidade) e a toque.

**I4. Pastas de espaços** · risco médio · **depende de I3**
Modelo novo (`SpaceFolder`) com nome, cor, posição e dono. Só começar depois que
I3 estiver em produção e estável — as duas mexem na mesma estrutura da barra.

**I5. Reordenar canais** · risco baixo
`Room.position` já existe e já ordena. Falta só a rota de atualização e o
arrastar. É o caminho mais barato para validar a biblioteca de DnD escolhida
antes de aplicá-la a I3.

### Grupo 4 — Configurações do usuário

**S1. Tela de configurações seccionada** · risco médio
Modelo Discord: navegação à esquerda (Conta, Voz e vídeo, Aparência, Idioma),
conteúdo à direita. Absorve o `DevicePicker` que hoje vive solto e vira a casa de
S2 e S3.
**Atenção:** se for usar rota por caminho (`/settings/voz`), leia a armadilha A.

**S2. Temas** · risco médio
33 variáveis já em `:root`, mas **45 cores literais fora dele** que não trocariam.
O trabalho real é essa varredura, não o seletor. Entregar: tema escuro (atual),
claro, e "igual ao do sistema" via `prefers-color-scheme`. Mecanismo:
`data-theme` no elemento raiz mais redefinição das variáveis.
Teste de aceite: percorrer todas as telas em ambos os temas procurando texto
ilegível; a tela de chamada e o seletor de emoji são os pontos mais prováveis de
falha por usarem cor literal.

**S3. Idioma — inglês, português, espanhol** · risco médio
~93 strings na interface **mais 47 mensagens de erro da API**. Decidir cedo:
a API passa a devolver código de erro (`{"error":"invite.invalid"}`) e o cliente
traduz, ou aceita-se erro em inglês nas três línguas. A primeira é mais trabalho
e é a certa.
Nenhuma biblioteca instalada. Cuidar também de: formatação de data e hora
(`lib/format.ts`), plurais, e o atributo `lang` do documento.

### Grupo 5 — Gestão (pendente de decisão do dono, ver seção 7)

**G1.** Remover membro de espaço e de grupo · **G2.** Promover e rebaixar
(`OWNER`/`ADMIN`/`MEMBER`) · **G3.** Regerar o código de convite · **G4.** A
checagem de papel que falta em `POST /rooms/:id/members`.

Todos de risco médio: mexem em autorização, e a API hoje quase não usa `role`.
Tratar como uma frente só, com um agente responsável por autorização de ponta a
ponta.

---

## 6. Sequência sugerida

Não é obrigatória, mas respeita as dependências reais e põe o risco cedo.

1. **Onda 1, em paralelo** — B1, B2, I2, I5, C1. Isolados entre si.
2. **Onda 2** — C2, C3, I1, S1. S1 é o guarda-chuva de S2/S3; feche a estrutura
   antes de encher.
3. **Onda 3** — S2 e S3 em paralelo (varredura de cor e varredura de string não
   colidem), I3.
4. **Onda 4** — I4 (depois de I3 estável) e o Grupo 5 inteiro.

Decida a armadilha A (`base: "/"`) **antes da onda 2** — S1 pode depender dela, e
a verificação exige construir e instalar o app desktop.

---

## 7. Decisões que são do dono do produto, não do time

Não invente resposta para estas. Pergunte.

1. **Quem pode trocar o ícone de um espaço** — só o dono, dono e admin, ou
   qualquer membro?
2. **Quem pode remover membros**, e o que acontece com as mensagens de quem foi
   removido (o precedente já estabelecido ao sair é: **as mensagens ficam**).
3. **Regerar o código de convite invalida o antigo?** (o esperado é que sim)
4. **As mensagens de erro da API viram códigos traduzíveis?** Muda o contrato da
   API e afeta qualquer cliente futuro.
5. **Idioma padrão** para quem chega sem preferência: inglês, ou o do navegador?

---

## 8. Testes — o que já existe e o que exigir

### O que já existe

```bash
npx tsx tests/devices.test.ts    # 69 testes — dispositivos, som, tela
npx tsx tests/deeplink.test.ts   # 43 testes — parsing de convite
node tests/run.mjs               # 227 testes de integração contra a API de PRODUÇÃO
```

A suíte de integração cria usuários descartáveis a cada execução e pode rodar em
paralelo. **Nenhuma das três pode regredir.**

### O que exigir de cada tarefa

- **Lógica pura** (parsing, resolução de dispositivo, temas, tradução): teste
  unitário rodando em Node com `tsx`, sem navegador. Escreva a lógica sem tocar
  em `window` para que isso seja possível — é o que permitiu 43 testes de
  convite sem navegador.
- **Rota nova de API**: teste na suíte de integração, incluindo o caminho
  negativo (quem não tem permissão) e a repetição (chamar duas vezes).
- **Interface**: verificação no navegador com dois usuários reais. Mede-se o
  estado, não a aparência: consultar o store ou a API, não procurar texto na
  tela. Dois erros do dia anterior foram **falsos positivos de seletor CSS**
  (`.toast, [class*=toast]` casando contêiner e item) — desconfie do seu próprio
  seletor antes de declarar bug.
- **Responsividade**: a ferramenta de redimensionar janela não funcionou nesta
  máquina. O que funcionou foi **um iframe de 412×880** apontando para o app: as
  media queries respondem à largura do iframe e dá para medir tudo com
  `getBoundingClientRect`.

### A bateria final, no artefato construído

Não vale testar em `vite dev` e declarar pronto. No mínimo:

1. Instalar o `.exe` num Windows limpo; abrir; entrar; mandar mensagem; fazer
   chamada com outra pessoa; compartilhar tela **com áudio**; clicar num link
   `whatscord://join/<código>` com o app aberto e com o app fechado.
2. Instalar o APK num aparelho Android real; conceder as permissões; **verificar
   que `getUserMedia` abre o microfone** (é o item de maior risco do projeto
   inteiro); confirmar que o botão de compartilhar tela aparece desabilitado com
   a explicação.
3. Abrir a web em celular e em desktop; percorrer as telas nos dois temas e nos
   três idiomas.
4. Rodar as três suítes.

---

## 9. Definição de pronto

Os quatro artefatos, todos da **mesma revisão de código**:

| Artefato | Onde nasce | Como verificar que é o certo |
|---|---|---|
| Web em produção | deploy do Coolify | buscar uma string nova no bundle servido, não confiar no "queued" |
| `.exe` (instalador NSIS) | `npm run dist --workspace apps/desktop` | mais novo que `apps/web/dist/`; conferir o esquema no `installer.nsi` gerado |
| Executável avulso | mesmo build, `target/release/whatscord-desktop.exe` | — |
| APK | `docs/android.md` | `aapt2 dump permissions` e `apksigner verify` |

E: as três suítes passando, e a bateria final da seção 8 executada **no
artefato**, não no ambiente de desenvolvimento.

---

## 10. Higiene

- Credenciais em texto puro circularam na sessão anterior (token do Coolify, PAT
  do GitHub, senha de root do SSH). **Devem ser rotacionadas.** Não as replique
  em arquivo, log ou mensagem de commit.
- O repositório é público. Varra os arquivos antes de cada commit.
- `.secrets/` está no `.gitignore`. Mantenha.
- Mensagem de commit explica **por quê**, não o quê. As do repositório servem de
  modelo.
- Ao corrigir algo que este documento afirma, **corrija o documento junto**. Ele
  já contém uma correção de uma afirmação errada anterior sobre camadas de
  simulcast; é assim que ele continua confiável.
