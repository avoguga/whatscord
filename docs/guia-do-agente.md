# Guia do agente — WhatsCord

Escrito para uma IA que chega neste repositório sem contexto. Lê-se do começo ao
fim uma vez; depois serve de índice.

**Antes de qualquer coisa, leia `CLAUDE.md` na raiz.** Ele tem as regras de
entrega deste projeto, e elas valem sobre tudo o que está aqui: nada é "feito"
sem a saída do comando que provou, e o que não foi testado se declara como não
testado.

---

## 1. O que é, em trinta segundos

WhatsCord: recursos do Discord com o layout do WhatsApp. Chat, chamadas de voz e
vídeo, compartilhamento de tela, espaços (servidores) com canais, e uma bandeja
de sons.

```
apps/api      Fastify + Prisma + Postgres + Redis + Socket.IO + LiveKit
apps/web      React 19 + Vite 6 + Zustand + Lingui (pt, en, es)
apps/desktop  Tauri v2 — empacota o build do web, não tem UI própria
```

Três workspaces npm. Node **≥ 22** (a máquina de referência roda 22.12.0).

O ponto que mais confunde quem chega: **`apps/desktop` não tem interface.** Ele
carrega `apps/web/dist`. Mexer na tela do app instalado é mexer em `apps/web`. O
Rust em `apps/desktop/src-tauri/src/lib.rs` só cuida do que é do sistema
operacional — bandeja do Windows, protocolo `whatscord://`, permissão de mídia da
WebView2.

---

## 2. Qual documento responde o quê

Não duplique o conteúdo deles aqui nem aqui dentro deles: cada assunto tem um
dono, e informação repetida é informação que vai envelhecer em um dos lados.

| Pergunta | Documento |
|---|---|
| Como eu devo entregar trabalho neste projeto? | `CLAUDE.md` (raiz) |
| O que está no ar, em que UUID, com que limite? | `docs/operacao.md` |
| Por que o LiveKit precisa de `network_mode: host`? | `docs/livekit-coolify.md` |
| Como gerar o APK, com todas as armadilhas? | `docs/android.md` |
| Por que tal biblioteca/versão foi escolhida? | `docs/decisoes.md` |
| Por que tal decisão de produto foi tomada? | `DECISOES.md` (raiz) — não confunda com o de cima |
| O que ainda falta do plano original? | `PLANO_EXECUCAO.md` (raiz) |
| Como usar e construir o app? | este arquivo |

Os dois arquivos de decisão têm nomes parecidos e conteúdos diferentes:
`docs/decisoes.md` é arquitetura (qual biblioteca, qual versão, por quê);
`DECISOES.md` na raiz é o registro formal das etapas do plano, com as opções
consideradas e as evidências de cada escolha.

---

## 3. Rodar em desenvolvimento

```bash
npm install                 # na raiz; os três workspaces de uma vez

cp apps/api/.env.example apps/api/.env
# preencha DATABASE_URL, JWT_SECRET e, para chamadas, as três LIVEKIT_*.
# Sem as LIVEKIT_*, os botões de chamada devolvem 503 — é por desenho.

npm run dev:api             # porta 3001
npm run dev:web             # porta 5173
npm run dev:desktop         # abre o Tauri apontando para a 5173
```

O cliente web escolhe a API nesta ordem: `VITE_API_URL` → `localStorage
whatscord.apiUrl` → produção. Para apontar o navegador para uma API local sem
rebuildar, basta gravar a chave no `localStorage`.

**O app instalado é *single instance*.** Não dá para abrir duas janelas na mesma
máquina, e por isso não dá para testar uma chamada sozinho com dois apps. O
segundo cliente é o navegador — foi para isso que `docker/web.Dockerfile` existe.

---

## 4. Como o app se usa

Isto serve para dois fins: saber o que testar, e saber onde mexer.

### Conversas

Espaços na barra à esquerda, com pastas arrastáveis. Dentro, canais de texto e de
voz. Fora dos espaços, conversas diretas e grupos. Papéis: `OWNER`, `ADMIN`,
`MEMBER` — e a regra que vale em todas as rotas é uma só: **ninguém age sobre
alguém do mesmo nível ou acima.**

### Chamada

Entrar por um canal de voz ou pelos botões do cabeçalho. O painel da chamada é
configurável: expande para a janela toda ou recolhe para o espaço da conversa
(deixando a barra de espaços à vista), a lista de participantes recolhe e troca
de lado.

| O que a pessoa faz | Onde mora |
|---|---|
| Entrar, sair, sons de chegada e saída | `apps/web/src/ui/Call.tsx` |
| Layout do painel (expandir, lado, roster) | `apps/web/src/lib/layoutChamada.ts` |
| Escolher microfone, câmera, alto-falante | `apps/web/src/ui/DevicePicker.tsx`, `lib/devices.ts` |
| Qualidade e FPS da tela | `apps/web/src/lib/screenshare.ts` |
| Conversa ao lado da chamada | `apps/web/src/ui/CallChat.tsx` |

### Quadro de vídeo

Duplo clique (ou o botão no canto) põe em **tela cheia**. Passar o mouse revela o
controle de **volume**, que é por pessoa **e por fonte**: abaixar a transmissão de
alguém não abaixa a voz dessa mesma pessoa.

- Volume: `apps/web/src/lib/volumeDaChamada.ts`. O teto é 100% e isso é
  obrigatório — `HTMLMediaElement.volume` acima de 1 lança `IndexSizeError`.
- Tela cheia: em `Call.tsx`, no componente `VideoTile`. No app instalado não
  precisa de nada do Tauri: `tauri-runtime-wry` já escuta o
  `ContainsFullScreenElementChanged` da WebView2 e põe a janela em tela cheia.

### Bandeja de sons

Botão **Sons** na barra da chamada. Três grupos: **Este espaço**, **Seus**,
**Embutidos**. Apertar toca para todo mundo. Botão direito num embutido o fixa na
frente, por conversa. "Adicionar um som…" sobe um arquivo — para você ou para o
espaço, e som de espaço só quem administra publica.

Limites: 512 KB por som, 12 por pessoa, 30 por espaço.

**Como o som viaja, e por que isso importa para quem for mexer:** não vai áudio
pela chamada. Vai um recado de poucos bytes pelo canal de dados do LiveKit. Para
os oito embutidos, cada aparelho sintetiza a onda — com semente fixa no ruído,
senão cada pessoa ouviria um tambor diferente. Para os sons subidos, o recado
carrega um **endereço**, e quem recebe busca e toca.

> **Cuidado, e este é o mais sério do código todo.** Qualquer participante pode
> mandar bytes pelo canal de dados, e um deles é um endereço que o aparelho dos
> outros vai buscar. `ehEnderecoNosso` em `lib/soundboard.ts` só aceita endereço
> **relativo** com a forma exata que a API emite, e o host é montado do lado de
> quem recebe. Não afrouxe isso. Sem ele, mandar um `https://` qualquer
> transforma cada participante em cliente de um servidor escolhido por quem
> mandou — e entrega o IP de todos. Há doze endereços hostis fixados em teste.

| Assunto | Arquivo |
|---|---|
| Catálogo, recado, validação do endereço | `apps/web/src/lib/soundboard.ts` |
| Sons subidos: listar, subir, apagar, tocar | `apps/web/src/lib/sonsDaNuvem.ts` |
| Painel | `apps/web/src/ui/Soundboard.tsx` |
| Rotas e permissões | `apps/api/src/routes/sounds.ts` |

---

## 5. Testes

```bash
npx tsx tests/devices.test.ts        # 256 testes, sem navegador
node tests/run.mjs                   # 350 testes, contra a API de produção
node tests/run.mjs --only=basico,dm,sons
```

`tests/run.mjs` **bate na API de produção** e cria usuários descartáveis. Aponte
para outro alvo com `WC_BASE`. Ele sai com 0 (tudo passou), 1 (houve falha) ou 2
(a API não respondeu `/health`).

> **Cuidado.** Depois de um deploy, espere o rollout terminar antes de medir
> qualquer coisa. Durante a troca há dois contêineres atendendo e a mesma rota
> responde certo e 404 alternadamente. Uma execução já deu 11 falhas por isso, e
> quase virou um diagnóstico errado. Confirme com alguns pedidos seguidos antes
> de acreditar no resultado.

### Duas armadilhas ao escrever teste aqui

**1. O macro do Lingui não existe fora do build.** Um módulo que importa `msg` de
`@lingui/core/macro` explode em Node antes da primeira linha. Isso já quebrou os
testes duas vezes. A consequência prática: **o núcleo testável não pode depender
da camada que fala com a rede nem da que tem texto traduzido.** Se você precisar
testar uma regra, ela mora no arquivo puro — foi por isso que `ehEnderecoNosso`
mora em `soundboard.ts` e não junto das funções que fazem `fetch`.

**2. `localStorage` não existe em Node.** As funções de preferência são escritas
para degradar em silêncio (o modo privado do navegador faz o mesmo). Os testes
instalam um `localStorage` de mentira no meio do arquivo; o que vem depois disso
depende dele.

---

## 6. Build para Windows

```bash
npm run dist:desktop
```

Isso encadeia: `vite build` do web → `cargo build --release` → NSIS. Leva cerca
de 4 minutos, quase tudo Rust.

Saída:

```
apps/desktop/src-tauri/target/release/bundle/nsis/WhatsCord_0.1.0_x64-setup.exe
```

> **Cuidado, e este erro já aconteceu.** Um instalador **não se atualiza
> sozinho**. Compare sempre a data do `.exe` com a do último commit antes de
> entregar. Já foi enviado um instalador compilado 40 minutos *antes* da correção
> que ele deveria conter, e o retorno foi "ainda não está arrumado".

Para provar que o conteúdo é o novo, e não só a data: descubra o nome do chunk em
`apps/web/dist/assets/`, confirme que ele tem o código esperado, e confirme que
esse nome aparece dentro do executável.

```bash
CHUNK=$(basename apps/web/dist/assets/Call-*.js)
grep -c 'requestFullscreen' "apps/web/dist/assets/$CHUNK"
python -c "print(open('apps/desktop/src-tauri/target/release/whatscord-desktop.exe','rb').read().count(b'$CHUNK'))"
```

O conteúdo dos arquivos vai comprimido dentro do executável — procurar por uma
string da página lá dentro **não** acha nada, e isso não é sinal de problema. Os
nomes dos arquivos, sim, ficam legíveis.

---

### Publicar uma atualização (o que o app instalado baixa sozinho)

A partir da **0.2.0** o app de desktop se atualiza sozinho. Ele consulta
`https://github.com/avoguga/whatscord/releases/latest/download/latest.json`
3 s depois de abrir e a cada 2 horas, **baixa em silêncio**, e instala só num
momento seguro: ao abrir (se ninguém tocou em nada), ao **sair** pela bandeja
(sem reabrir), ou quando ninguém está usando. **Nunca durante uma chamada nem
com mensagem pela metade.** Enquanto houver versão esperando, fica um ponto verde
na engrenagem da barra lateral.

A regra inteira, com as fontes de onde veio (Discord, Teams, Zoom, Chrome,
VS Code, electron-updater), está em `docs/decisoes.md`, seção "Atualização
automática". Ela mora em `decidirInstalacao` (`apps/web/src/lib/atualizacao.ts`)
e é testada — mexa nela com os testes abertos.

> **Cuidado.** O instalador roda em modo `quiet` porque é por usuário
> (`currentUser`). Se um dia o NSIS mudar para `perMachine`, o `quiet` passa a
> exigir administrador e a atualização automática **falha em silêncio**. Nesse
> caso troque o `installMode` do updater para `passive`.

Para publicar:

```bash
# 1. suba a versão em apps/desktop/src-tauri/tauri.conf.json (e Cargo.toml)
# 2. commite — o script recusa árvore suja
GH_TOKEN=<token com permissão de release>   node scripts/release-desktop.mjs --notes "o que mudou"
# ou, para só compilar e gerar o latest.json sem publicar:
node scripts/release-desktop.mjs --dry-run
```

O script compila com a chave de assinatura, gera o `.exe.sig` e o
`latest.json`, recusa publicar um instalador mais velho que o último commit, e
cria a release `v<versão>` com os três arquivos.

> **A chave de assinatura é insubstituível. Não a perca e não a exponha.**
>
> - A privada mora em `.secrets/updater.key`, a senha em `.secrets/updater.env`.
>   Os dois estão no `.gitignore`. **Nunca** os commite, imprima ou cole em
>   conversa.
> - A chave **pública** está embutida em cada app já instalado. Se a privada se
>   perder, nenhuma atualização futura será aceita por esses apps — gerar uma
>   chave nova não resolve: cada pessoa teria de reinstalar à mão.
> - Se a privada vazar, qualquer um pode publicar uma "atualização" que os apps
>   instalados aceitam como legítima. A assinatura é a única coisa que impede
>   isso, porque o endereço das atualizações é público.
> - **Faça uma cópia da pasta `.secrets/` fora desta máquina.**

Quem tem a 0.1.0 **não recebe atualização automática** — ela não tinha o
atualizador. A 0.2.0 precisa ser instalada à mão uma vez; dali em diante, sozinha.

Não existe no Android: lá, atualizar é instalar o APK novo por cima.
## 7. Build para Android (APK)

O procedimento completo, com todas as armadilhas, está em **`docs/android.md`**.
O resumo do que você precisa saber antes de começar:

**O que precisa estar instalado:** JDK 17, Android SDK (platforms 34-36,
build-tools 35.0.0), NDK 27.1.12297006, e o alvo Rust `aarch64-linux-android`.

**O build não termina sozinho no Windows.** O Tauri cria a biblioteca nativa por
link simbólico, e o Windows recusa sem o Modo de Desenvolvedor ligado:

```
Failed to create a symbolic link ... Creation symbolic link is not allowed for this system.
```

Nesse ponto o Rust **já compilou**. O contorno é copiar a biblioteca no lugar do
link e chamar o Gradle direto:

```bash
cd apps/desktop
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"

# Compila o Rust e para no erro do link simbólico — é esperado.
npx tauri android build --apk --debug --target aarch64 || true

# Copia a .so JÁ SEM SÍMBOLOS no lugar do link.
STRIP="$NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe"
cd src-tauri
mkdir -p gen/android/app/src/main/jniLibs/arm64-v8a
"$STRIP" --strip-unneeded \
  -o gen/android/app/src/main/jniLibs/arm64-v8a/libwhatscord_desktop_lib.so \
  target/aarch64-linux-android/debug/libwhatscord_desktop_lib.so

cd gen/android
./gradlew assembleArm64Debug -x rustBuildArm64Debug -x rustBuildUniversalDebug
```

Saída em `gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`.

**O `llvm-strip` não é opcional**: a biblioteca de depuração tem 152 MB com os
símbolos e 17,8 MB sem eles — a diferença entre um APK impossível de mandar por
mensagem e um de 25 MB.

### Três coisas que não se deve fazer com o Android

1. **Não rode `tauri android init` num clone novo.** `src-tauri/gen/android` é
   versionado de propósito. O `init` reescreve o `AndroidManifest.xml` com
   **apenas** `INTERNET`, e sem `CAMERA`, `RECORD_AUDIO` e
   `MODIFY_AUDIO_SETTINGS` a chamada entra muda e cega — o `getUserMedia` falha.
   Quem pede a permissão em tempo de execução é o wry, mas ele só consegue pedir
   o que estiver declarado.

2. **Não use `#[cfg(not(target_os = "windows"))]` para código de desktop.** Isso
   também casa com Android e quebra o build. Use
   `#[cfg(all(not(target_os = "windows"), desktop))]`, com uma não-operação em
   `#[cfg(mobile)]`.

3. **Não espere compartilhamento de tela no Android.** O wry não trata
   `getDisplayMedia`; exigiria a API MediaProjection nativa. O app detecta
   (`canShareScreen` em `lib/screenshare.ts`) e desabilita o botão com a
   explicação, em vez de deixar a pessoa clicar e nada acontecer.

**Não validado:** o APK compila, sai assinado com o certificado de depuração e
carrega as quatro permissões. Nunca foi instalado nem executado num aparelho.

---

## 8. Onde está hospedado

Servidor `167.88.39.225`, Coolify v4.3.17, projeto **Ideias**, ambiente
**production**. Os UUIDs de cada recurso e os limites de RAM/CPU estão em
`docs/operacao.md`.

| | Endereço |
|---|---|
| Web | `https://whatscord.167.88.39.225.sslip.io` |
| API | `https://api.whatscord.167.88.39.225.sslip.io` |
| LiveKit | `wss://livekit.167.88.39.225.sslip.io` (TCP 7881, UDP 7882-7885 direto no host) |

`GET /health` devolve o estado real:
`{"ok":true,"storage":"local","calls":true,"realtimeScaling":true}`.

Deploy é disparado pela API do Coolify (`POST /api/v1/deploy?uuid=<uuid>`). A API
roda `prisma migrate deploy` ao subir, então **uma migração nova entra sozinha no
deploy** — não há passo manual.

### Cuidados com o servidor

> Esse host roda cerca de 105 contêineres de outros projetos. **Todo recurso do
> WhatsCord tem limite explícito de RAM e CPU** — nenhum dos outros tem, e é a
> única proteção contra o OOM killer escolher a vítima errada. Ao criar recurso
> novo, ponha limite.

`docs/operacao.md` tem oito armadilhas que já custaram deploy neste servidor,
cada uma acontecida de verdade. As três que mais pegam:

- **`NODE_ENV=production` quebra o build.** O Coolify injeta as variáveis também
  no build, o npm pula `devDependencies`, some o `typescript` e o `tsc` falha.
- **O `HEALTHCHECK` precisa estar na imagem.** Sem ele o rolling update aborta
  com "Health check failed", e `node:alpine` não tem `curl` nem `wget`.
- **O Traefik roteia o LiveKit por arquivo, não por label.** Se o proxy do
  Coolify for recriado, `/data/coolify/proxy/dynamic/whatscord-livekit.yml` some
  e o `wss://` para de responder **sem nada aparecer no log de deploy**. A cópia
  canônica está em `infra/traefik-livekit.yml`; repor o arquivo basta.

### Armazenamento

Anexos e sons vão para um volume persistente ao lado da API
(`whatscord-uploads` em `/data/uploads`). O MinIO está **parado** — entrou em
loop de crash sem escrever log. Para voltar a S3 (R2, MinIO em outra VPS), basta
definir `S3_ENDPOINT`, `S3_ACCESS_KEY` e `S3_SECRET_KEY`: o driver em
`apps/api/src/lib/storage.ts` troca sozinho e nenhum outro arquivo muda.

> **Cuidado.** `GET /files/*` é **público por desenho** — a URL é a credencial, e
> as chaves são UUIDs aleatórios. Não é descuido; é o que permite a WebView
> renderizar `<img>` e `<audio>`, que não carregam cabeçalho de autorização. A
> consequência é que quem tiver a URL baixa o arquivo. Não trate esse caminho
> como protegido, e nunca sirva ali um tipo que o navegador execute: a lista
> `INLINE_TYPES` em `apps/api/src/routes/files.ts` existe para isso, e SVG está
> fora dela de propósito porque é imagem que carrega script.

---

## 9. Segredos

`.secrets/` está no `.gitignore` e o repositório é **público**.

- Nenhuma credencial deve entrar em `.git/config`, na URL do remoto, ou em
  qualquer arquivo versionado.
- Para autenticar um push com token, use um arquivo de credencial temporário e
  **apague-o na mesma linha de comando**. Não deixe rastro.
- Os valores de produção moram nas variáveis de ambiente do Coolify, não aqui.

> **Pendência aberta:** o token do Coolify, o PAT do GitHub e a senha de root
> foram trafegados em texto puro durante o trabalho. Os três precisam ser
> rotacionados. Enquanto isso não acontecer, trate-os como comprometidos.

---

## 10. Antes de dizer que terminou

Da leitura de `CLAUDE.md`, na prática:

```bash
cd apps/web && npx tsc --noEmit && npm run build
cd apps/api && npx tsc --noEmit && npm run build
cd apps/web && npx lingui extract          # tem de dar 0 faltando em pt e es
npx tsx tests/devices.test.ts
node tests/run.mjs
git diff --stat
```

Uma entrega inclui a saída real desses comandos, os passos para reproduzir, e
**"NÃO TESTADO" escrito ao lado de tudo que não foi executado**. Diagnóstico lido
no código não é o mesmo que comportamento observado, e a diferença entre os dois
precisa aparecer no texto.
