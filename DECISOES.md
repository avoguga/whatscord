# DECISOES.md

Resultado da Etapa 2. Para cada decisão: opções consideradas, evidências com
fonte, decisão e justificativa. Nada de "assumi que".

Regra aplicada: **pesquise → compare → decida → documente**. Empate após pesquisa
→ vence o mais próximo do Discord. O que não foi decidível por pesquisa está na
seção **Pendências**, com a opção mais próxima do Discord adotada
provisoriamente.

Data: **06/09/2026**.

---

## Índice

| # | Decisão | Resultado |
|---|---|---|
| D1 | Categorias das configurações | 5 seções, em 2 grupos |
| D2 | Erros da API traduzíveis | camada de compatibilidade (`code` + `params` ao lado de `error`) |
| D3 | `base` do Vite | **`/`** — testado em execução |
| D4 | Câmera no celular | `restartTrack({ facingMode })`, não `switchActiveDevice` |
| D5 | Tela esticada | **não decidível por pesquisa** → protocolo de medição |
| D6 | Drag and drop | `@dnd-kit/react` (reescrita 2026) |
| D7 | Temas | claro, escuro, igual ao dispositivo |
| D8 | i18n | Lingui v5 + locale do SO via Rust (v6 quebra no Node 22.12) |
| D9 | Avatares da chamada | abaixo do canal de voz na barra lateral |
| D10 | Quem troca o ícone | OWNER e ADMIN |
| D11 | Remoção de membros | OWNER e ADMIN; mensagens ficam; respeita hierarquia |
| D12 | Regerar convite | invalida o anterior (imposto pelo modelo de dados) |

---

## D1 — Categorias da tela de configurações

**Opções.** (a) Copiar a árvore do Discord inteira. (b) Uma tela só, como hoje.
(c) Subconjunto do Discord limitado ao que existe neste app.

**Evidências.**
- Estrutura do Discord (reconstruída de fontes secundárias — `support.discord.com`
  devolveu **403 em todas** as tentativas de leitura direta):
  Conta · Privacidade · Cobrança · App/Experiência (Notificações, Aparência,
  Acessibilidade, Voz e Vídeo, Texto e Imagens, Idioma, Modo Streamer, Avançado).
  Fontes: <https://www.discords.ai/wiki/discord-account-settings-guide>,
  <https://github.com/Discordia-Development/wiki/blob/master/user-settings.md>,
  <https://docs.discord.food/resources/user-settings>
- Controles do Discord em "Voz e vídeo", com o tipo de cada um (seletor,
  deslizante, interruptor): dispositivo de entrada e saída, volumes, teste de
  microfone, modo de entrada, sensibilidade, cancelamento de eco, supressão de
  ruído, ganho automático, QoS, atenuação.
  Fonte: <https://www.howtogeek.com/663414/how-to-configure-your-microphone-and-headset-in-discord/>
- O que existe **neste** app: `apps/web/src/ui/Settings.tsx` (nome, bio, sair) e
  `apps/web/src/ui/DevicePicker.tsx` (microfone, câmera, alto-falante, medidor de
  nível, teste de som, interruptor de aviso sonoro, modo de compartilhamento).

**Critério.** Toda categoria precisa ter pelo menos um controle real já existente
ou explicitamente planejado nas tarefas T1–T7. Categoria vazia é descartada.

**Decisão — 5 seções, em 2 grupos:**

```
Conta
  └─ Minha conta ......... nome, bio, avatar (T6/I2), sair
Aplicativo
  ├─ Voz e vídeo ......... microfone, câmera, alto-falante, medidor,
  │                        teste de som, modo de compartilhamento (T1, T2, T3)
  ├─ Aparência ........... tema (T6b)
  ├─ Notificações ........ aviso sonoro de entrada/saída, mudo por conversa
  └─ Idioma .............. seleção de idioma (T6c)
```

**Justificativa.** Segue a divisão do Discord (dados da conta primeiro,
preferências do app depois) e a nomenclatura dele em português. **Descartadas por
não terem conteúdo real:** Cobrança (não há cobrança), Privacidade (não há
configuração de privacidade), Acessibilidade (nada a configurar ainda),
Conexões, Modo Streamer, Avançado. Criar seção vazia para parecer com o Discord
seria copiar a forma sem a substância.

**Confiança:** média. A ordem exata e os nomes oficiais em pt-BR não puderam ser
verificados na fonte primária.

---

## D2 — Mensagens de erro da API traduzíveis

**Opções.** (i) Substituir a frase por código. (ii) Camada de compatibilidade:
manter `error` e acrescentar `code` + `params`. (iii) Manter só a frase em inglês.

**Evidências.**
- **RFC 9457** separa identificador estável (`type`) de texto legível
  (`title`/`detail`), e recomenda negociar idioma no servidor via
  `Accept-Language`. <https://www.rfc-editor.org/rfc/rfc9457.html>
- **Stripe, Slack e GitHub** todos separam código estável da mensagem, e **nenhum
  dos três traduz a mensagem** — ela existe como apoio, o contrato é o código.
  <https://docs.stripe.com/api/errors> · <https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api>
- **Plural e gênero são o argumento decisivo** contra mandar frase pronta: só dá
  para aplicar as regras de cada idioma (ICU/CLDR) se o cliente recebe código +
  parâmetros e formata localmente. <https://phrase.com/blog/posts/guide-to-the-icu-message-format/>
- **Compatibilidade:** "unknown extension members and unknown codes must be
  ignored, not treated as failures" —
  <https://github.com/zalando/restful-api-guidelines/blob/main/chapters/compatibility.adoc>
- **Nosso código:** `apps/web/src/lib/api.ts:116` faz
  `message = (await res.json()).error ?? message`. **Só lê a chave `error`** —
  qualquer campo novo é ignorado. Verificado lendo o código, não suposto.
  São **65 pontos** de retorno de erro em 9 arquivos.

**Decisão — opção (ii), camada de compatibilidade.** `error` continua sendo a
frase em inglês; acrescenta-se `code` (`snake_case`, estável, nunca traduzido) e
`params` (objeto plano). A frase passa a ser gerada a partir do mesmo
`code`+`params` num único lugar, para não divergir.

**Justificativa.** É estritamente aditiva — o cliente atual não quebra, o que era
a exigência explícita. Replica o que os três serviços pesquisados fazem: a frase
em inglês vira fallback seguro para telas ainda não migradas e para log. A opção
(i) quebraria o app hoje (ele só lê `.error`, pararia de exibir qualquer
mensagem); a (iii) é o que já existe e não avança nada.

---

## D3 — `base` do Vite

**Opções.** (a) Manter `./`. (b) Trocar para `/`. (c) `base` condicional por alvo.

**Evidências.**
- A doc do Vite classifica `./` como **"for embedded deployment"**, isto é, para
  quando não há origem HTTP servindo os arquivos.
  <https://vite.dev/config/shared-options.html#base>
- O **template oficial do Tauri v2** para React/TS **não define `base`** — usa o
  padrão do Vite, que é `/`.
  <https://raw.githubusercontent.com/tauri-apps/create-tauri-app/dev/templates/template-react-ts/vite.config.ts.lte>
- No Tauri **v2 nenhuma plataforma usa `file://`**: macOS/Linux usam
  `tauri://localhost`, Windows usa `http://tauri.localhost`.
  <https://v2.tauri.app/start/migrate/from-tauri-1/>
- **Android:** o wry serve por `WebViewAssetLoader` com
  `addPathHandler("/", AssetsPathHandler(context))` — manipulador na **raiz**.
  Lido no fonte local `wry-0.55.1/src/android/kotlin/RustWebViewClient.kt:21-23`,
  e corroborado por <https://github.com/tauri-apps/wry/issues/1709>
- **Teste em execução, feito aqui:** app construído com `base: "/"`, executado, e
  uma sonda de rede disparada pelo bundle foi recebida
  (`SONDA RECEBIDA: ['/o-bundle-executou']`) — prova de que o JavaScript executou
  dentro da WebView.

**Decisão — `base: "/"`.** Já aplicado; os 112 testes seguem passando.

**Justificativa.** O comentário `"Tauri loads the build from disk"` no config era
herança de raciocínio do Tauri v1 e estava errado para o v2. Com `/`, rotas
aninhadas passam a funcionar na web, o que destrava a T6a e devolve o formato
`/join/<código>` ao link de convite.

**Registro de erro cometido no caminho:** a primeira tentativa de verificação
usou o título da janela como sinal. **Método inválido** — no Tauri o título vem
do `tauri.conf.json` e não acompanha o `document.title`. Aquela medição indicou
"não carregou" e estava errada. A sonda de rede substituiu e corrigiu.

**Pendente de confirmação:** o APK não foi testado num aparelho. A evidência do
`addPathHandler("/")` é forte, mas não é execução.

---

## D4 — Troca de câmera no celular

**Opções.** (a) Continuar por `deviceId` com `switchActiveDevice`. (b) Usar
`facingMode`. (c) Despublicar e republicar a track.

**Evidências.**
- `facingMode` **não sobrevive à PeerConnection**: "tracks associated with a
  WebRTC RTCPeerConnection will never include this property".
  <https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/facingMode>
- **Android costuma permitir uma câmera aberta por vez.** `switchActiveDevice`
  pede a nova com `exact: true` **sem liberar a anterior primeiro**, o que gera
  `OverconstrainedError`/`NotReadableError`.
  <https://bugs.chromium.org/p/chromium/issues/detail?id=862325> e o caso real
  <https://github.com/livekit/client-sdk-react-native/issues/218>
- **O Android System WebView tem bug documentado**: `enumerateDevices` devolve
  `label` vazio (e `kind` inconsistente) — diferente do app Chrome no mesmo
  aparelho. <https://issues.chromium.org/issues/41288617> (dup. de
  <https://bugs.chromium.org/p/chromium/issues/detail?id=669492>).
  **Isto é decisivo:** o app roda em WebView, não no Chrome.
- **`VideoCaptureOptions` aceita `facingMode`** —
  `node_modules/livekit-client/dist/src/room/track/options.d.ts:170-189`.
- **`LocalVideoTrack.restartTrack(options)` aceita `facingMode`** e troca a
  `MediaStreamTrack` sob o sender existente (`replaceTrack`), recalculando os
  encodings. Não é preciso despublicar e republicar.
- `Room.switchActiveDevice` **nunca** usa `facingMode` — só `deviceId`.

**Decisão.**
- **Celular (dispositivo de toque):** botão "virar câmera" chamando
  `localVideoTrack.restartTrack({ facingMode: "user" | "environment" })`.
- **Desktop:** mantém o seletor por `deviceId` como está hoje.
- A escolha entre os dois caminhos é por capacidade detectada, não por
  *user-agent*: se `enumerateDevices()` devolver câmeras **rotuladas**, o seletor
  aparece; se não, aparece o botão de virar.

**Justificativa.** O bug do WebView torna a seleção por `deviceId` não confiável
justamente na plataforma onde a troca é mais necessária, e a limitação de uma
câmera por vez torna `switchActiveDevice` frágil no Android. `restartTrack` é o
caminho que o próprio SDK oferece e não exige republicar.

**Correção ao `PLANO_EXECUCAO.md`:** eu havia escrito que, se `switchActiveDevice`
não aceitasse `facingMode`, o caminho seria "republicar a track". **Está errado** —
`restartTrack` resolve sem republicar.

---

## D5 — Compartilhamento de tela esticado

**Não foi decidível por pesquisa.** Vai para Pendências. O que a pesquisa fez foi
**eliminar as duas hipóteses óbvias**, inclusive a minha.

**Evidências que eliminam hipóteses.**
- O grupo de trabalho do WebRTC decidiu explicitamente que `getDisplayMedia` faz
  **crop-and-scale** quando a resolução pedida não bate com a proporção nativa —
  **rejeitando** tanto esticar quanto pôr barras no captador.
  <https://lists.w3.org/Archives/Public/public-webrtc-logs/2019May/0044.html>
  Logo, `width: { ideal: 1920 }` **não distorce**.
- `object-fit: contain` (`styles.css:489`) **não pode matematicamente esticar** —
  preserva a proporção intrínseca do vídeo.
- Portanto **minha hipótese anterior também cai**: `.tile.screen { aspect-ratio:
  16/9 }` (linha 490) produz **barras**, não esticamento.

**Decisão provisória (mais próxima do Discord):** manter `object-fit: contain`,
que é o comportamento observável de Discord e Meet — letterbox, nunca corte, do
lado de quem recebe.

**O que precisa ser medido antes de mexer**, em ordem:
1. `track.mediaStreamTrack.getSettings()` na track de tela → largura, altura e
   proporção reais escolhidas. Se baterem com o monitor de origem, a captura está
   correta.
2. No `<video>` renderizado: comparar `videoWidth / videoHeight` (proporção
   intrínseca do quadro) com `getBoundingClientRect()`. Se a intrínseca está certa
   mas a imagem aparece esticada, a causa é **necessariamente** CSS ou atributo
   HTML naquele elemento.
3. Verificar se o elemento de tela é mesmo o que a regra `.tile video` atinge —
   um wrapper diferente, ou `object-fit: cover` em outro seletor, explicaria tudo.
4. Procurar atributos HTML `width`/`height` no `<video>`: eles alteram a
   proporção intrínseca **antes** do CSS e distorcem mesmo com `contain` correto.

**Terceira hipótese, também derrubada — inclusive a minha "observação
acionável".** Eu havia sugerido que a tela 16:10 dentro do `aspect-ratio: 16/9`
apareceria com barras. Fui verificar no código e a regra **nunca chega a valer**:

- o modo foco liga exatamente quando existe tela compartilhada (`Call.tsx:457`);
- a tela **sempre** renderiza dentro de `.stage-main` (`Call.tsx:467`);
- ali, `.call-stage.focus .stage-main .tile` (especificidade 0,3,0) sobrescreve
  `.tile.screen` (0,2,0), zerando o `aspect-ratio` fixo.

Era **código morto**. Removido, com o motivo registrado no próprio CSS.

Resultado: as **três** explicações candidatas caíram. Não há hipótese viva — daí
esta decisão ser uma pendência de medição, não uma escolha de projeto.

---

## D6 — Biblioteca de drag and drop

**Opções.** `@dnd-kit` (clássico e a reescrita), Pragmatic drag and drop
(Atlassian), react-beautiful-dnd, SortableJS, HTML5 nativo.

**Evidências.**
- **react-beautiful-dnd está arquivada** desde 18/08/2025; o pacote está marcado
  como obsoleto. O fork `@hello-pangea/dnd` está em manutenção mínima.
  <https://github.com/atlassian/react-beautiful-dnd/issues/2672>
- **HTML5 nativo não funciona em toque** — falha o requisito obrigatório.
- **SortableJS** não tem acessibilidade por teclado nativa
  (<https://github.com/SortableJS/Sortable/issues/1176>) e o wrapper React está
  parado desde 05/2022.
- **`@dnd-kit/core` v6 (clássico)** tem erros de TypeScript com React 19 abertos
  desde 11/2024 sem correção. <https://github.com/clauderic/dnd-kit/issues/1511>
- **`@dnd-kit/react` 0.5.0** (reescrita, publicada 11/06/2026) declara
  `react: ^18.0.0 || ^19.0.0`, tem **sensor de teclado de fábrica**
  (Space/Enter pega, setas movem, Esc cancela) e sensor de toque documentado,
  com `touch-action` resolvendo o conflito com rolagem. MIT. Repositório ativo.
  <https://dndkit.com/react/quickstart> · <https://docs.dndkit.com/api-documentation/sensors/keyboard>
- **Pragmatic** é bem menor (~4,7 KB contra ~19-23 KB) e é o toolkit real do
  Trello, mas **teclado não vem de fábrica** — é pacote opcional, e nem os
  exemplos oficiais da própria Atlassian o implementam. O suporte a React 19 nos
  pacotes React é declarado como "não testado, risco pequeno".
  <https://github.com/atlassian/pragmatic-drag-and-drop/issues/181>
- **Nenhuma das duas finalistas tem "soltar sobre" pronto** — ambas exigem
  detecção de sobreposição manual.

**Decisão — `@dnd-kit/react` (a reescrita de 2026) + `@dnd-kit/helpers`.**
Explicitamente **não** a v6 clássica.

**Justificativa.** O critério nº 1 declarado era teclado **e** toque
obrigatórios. É exatamente onde o dnd-kit ganha de forma limpa: teclado é nativo,
enquanto no Pragmatic é opcional e ausente até dos exemplos oficiais. Os ~15 KB
a mais não compensam implementar acessibilidade por teclado do zero. Empate no
critério 2 (nenhuma tem "combine"), então ele não desempata.

**A medir antes de aprovar:** o tamanho real de `@dnd-kit/react` no nosso bundle
— a pesquisa não conseguiu medir (limite de requisições) e usou a ordem de
grandeza da família. Medir com o bundle de verdade.

---

## D7 — Temas

**Opções.** (a) Só escuro (hoje). (b) Claro + escuro + sistema. (c) Os quatro do
Discord (Light, Ash, Dark, Onyx).

**Evidências.**
- O Discord tem **4 temas gratuitos**: Light, Ash, Dark e Onyx (preto puro, para
  OLED), mais "Sincronizar com o computador", que alterna **apenas entre Light e
  Dark** — não entra em Ash nem Onyx.
  <https://discord.com/blog/bring-your-vibe-to-discord-with-new-themes-in-nitro>
- Nosso estado: **26 variáveis** no `:root`, **45 cores literais fora dele**, e
  `color-scheme: dark` **fixo** na linha 56 de `styles.css`.
- Boa notícia: as 13 cores inline em JSX já usam `var(--…)` — não há literal em
  componente.

**Decisão — três temas: Claro, Escuro (o atual) e "Igual ao do dispositivo".**
Mecanismo: `data-theme` no elemento raiz redefinindo as variáveis, mais
`prefers-color-scheme` para o modo automático; `color-scheme` deixa de ser fixo.

**Justificativa.** Os três mapeiam exatamente o comportamento do "Sincronizar com
o computador" do Discord, que só alterna entre claro e escuro. Ash e Onyx são
**refinamentos do escuro**, e o trabalho real aqui não é o seletor: é a varredura
das 45 cores literais. Com os tokens no lugar, acrescentar um "Preto (OLED)"
depois é barato — fica registrado como evolução, não como escopo agora.

---

## D8 — Internacionalização

**Opções.** react-i18next, LinguiJS, FormatJS/react-intl, Paraglide, solução
própria.

**Evidências (tamanho comprimido do runtime, medido no Bundlephobia).**

| Biblioteca | Tamanho | Observação |
|---|---|---|
| react-i18next | **~23,9 KB** | mais popular; tipagem forte exige configuração extra |
| react-intl | ~14,7 KB | ICU de referência |
| **Lingui v6** | **~3,8 KB** | ICU resolvido em build-time |
| Paraglide | ~1 KB/idioma | tipagem mais forte; ecossistema menor; formato não-ICU |

- **Nenhuma das ferramentas extrai string solta de JSX.** `i18next-parser`,
  `@formatjs/cli extract` e `lingui extract` todas pressupõem que a chamada
  `t()` já existe. Migrar as 285 strings é trabalho manual **equivalente em
  qualquer escolha** — logo esse critério não desempata.
- **Armadilha real em WebView:** `navigator.language` **não reflete de forma
  confiável** o idioma do sistema em WebView2. Issue aberta no próprio wry:
  <https://github.com/tauri-apps/wry/issues/442>

**Decisão — Lingui v5** (a pesquisa apontava v6; ver a correção logo abaixo).
E, para o idioma padrão:
- **Na web:** cascata `localStorage` → `navigator.languages` (comparando prefixo)
  → **inglês**.
- **No app desktop e Android:** o locale vem do **sistema operacional via Rust**
  (crate `sys-locale`), injetado na WebView; `navigator.languages` fica só como
  recuo.

**Justificativa.** Lingui é ~6× mais leve que o react-i18next sem perder ICU,
plural ou carregamento sob demanda, e o orçamento do bundle é critério declarado.
Paraglide seria ainda menor e com tipagem melhor, mas tem ecossistema bem menor e
formato de mensagem não-ICU — risco desnecessário. Solução própria foi descartada:
reimplementar plural e ICU para economizar 3,8 KB não se paga.

O detalhe do locale via Rust não é preciosismo: sem ele, o app instalado pode
abrir no idioma errado, e essa é a primeira impressão do produto.

**Correção durante a execução — v6 não funciona neste ambiente.** A pesquisa
comparou versões pelo tamanho publicado e apontou v6. Ao instalar, a extração de
mensagens falhou **em silêncio**: código de saída 0, nenhuma saída, nenhum
catálogo escrito. Chamando a API diretamente, o erro aparece:

    The "options.exclude" property must be of type function.
    Received an instance of Array
        at get sourcePaths (@lingui/cli/dist/api/catalog.js:224)

O v6 troca a biblioteca `glob` pelo `fs.globSync` **experimental** do Node, cujo
`exclude` só passou a aceitar array depois do Node 22.12 — que é o Node desta
máquina e uma versão LTS. O v5 usa a biblioteca `glob` e extrai normalmente.
Fixado em `5.9.5`, com o intervalo preso ao 5.x para o `npm install` não subir
sozinho. O runtime é o mesmo ICU e o tamanho é equivalente; o que se perde é
apenas a versão maior.

Vale registrar que o modo de falhar é pior que a falha: um CLI que devolve 0 e
não escreve nada leva a procurar erro no próprio código por um bom tempo.

**Não encontrado:** como o Discord escolhe o idioma no primeiro acesso. A cascata
acima é a prática recomendada da plataforma, não uma cópia do Discord.

---

## D9 — Onde exibir os avatares de quem está na chamada

**Opções.** (a) Abaixo do canal de voz na barra lateral. (b) No cabeçalho da
conversa. (c) Só dentro da tela de chamada, como hoje.

**Evidências.** Não foi encontrada fonte oficial do Discord descrevendo o layout
(`support.discord.com` bloqueou a leitura). A **imagem #12** fornecida pelo dono
aponta exatamente a linha do canal de voz na barra lateral.

**Decisão — abaixo da linha do canal de voz, na barra lateral**, com avatar e
nome, indicador de quem está falando e de quem está mudo. Tooltip no estilo da
imagem #13.

**Justificativa.** É o que a imagem #12 indica e o comportamento observável do
Discord. **Confiança média** por falta de fonte primária.

**Lembrete que vale mais que a decisão:** isto depende de a presença de voz ter
uma fonte de verdade. Hoje ela não é persistida em lugar nenhum, some depois de
um F5, e `call:joined` é emitido ao **pedir token**, não ao conectar. Ver T4 do
`PLANO_EXECUCAO.md`.

---

## D10 — Quem pode trocar o ícone

**Evidências.**
- Discord: editar nome/ícone do **servidor** exige `MANAGE_GUILD`; editar
  **canal** exige `MANAGE_CHANNELS`. Por padrão, só Administrador e Dono.
  <https://docs.discord.com/developers/topics/permissions>
- **Precedente interno:** `apps/api/src/routes/spaces.ts:94` já recusa `MEMBER`
  para criar canal — *"Only admins can add channels."*

**Decisão — `OWNER` e `ADMIN` podem; `MEMBER` não.** Vale para ícone de espaço e
de grupo/canal.

**Justificativa.** Coincide com o Discord e com a única checagem de papel que já
existe no nosso código. Divergir criaria duas regras diferentes na mesma API.

---

## D11 — Remoção de membros e destino das mensagens

**Evidências.**
- Discord: expulsar exige `KICK_MEMBERS`; e há **regra de hierarquia** — não se
  expulsa alguém de cargo igual ou superior, mesmo com a permissão.
  <https://support.discord.com/hc/en-us/articles/214836687-Discord-Roles-and-Permissions>
- **As mensagens de quem é expulso permanecem.** Não existe opção nativa de
  apagar histórico ao expulsar (só ao banir).
  <https://support.discord.com/hc/en-us/community/posts/360069000251-Please-add-option-to-delete-message-history-on-kick>
- **Precedente interno:** ao **sair** de um espaço, as mensagens ficam
  (`DELETE /spaces/:id/members/me`, já em produção).

**Decisão.**
- `OWNER` e `ADMIN` podem remover membros de espaço e de grupo.
- **As mensagens permanecem.**
- **Hierarquia:** ninguém remove alguém de papel igual ou superior. Um `ADMIN`
  não remove outro `ADMIN` nem o `OWNER`; só o `OWNER` remove um `ADMIN`.

**Justificativa.** Bate com o Discord e com o precedente já em produção. A regra
de hierarquia evita o cenário óbvio de dois admins se removendo mutuamente.

---

## D12 — Regerar o código de convite

**Evidências.**
- No Discord um servidor tem **vários convites simultâneos**, cada um com
  expiração e limite de usos próprios, revogáveis individualmente. Criar um novo
  **não** invalida os antigos.
  <https://support.discord.com/hc/en-us/articles/208866998-Invites-101>
- **Nosso modelo tem UM `inviteCode` por espaço** (`schema.prisma`, `Space`).

**Decisão — regerar substitui e invalida o código anterior.**

**Justificativa.** Não é escolha de experiência, é consequência do modelo de
dados: com um único campo, não existe onde o código antigo continuaria existindo.
E é o comportamento que a pessoa espera de um botão chamado "regerar" — se o
antigo continuasse valendo, o botão não serviria para o seu propósito principal,
que é cortar o acesso de quem já tem o link.

**Divergência registrada.** O Discord é mais expressivo aqui. Migrar para uma
lista de convites (com expiração, limite de usos e revogação individual) é a
evolução fiel — fica anotada como trabalho futuro, **não** no escopo atual, por
exigir migração de banco sem necessidade comprovada agora.

---

## Pendências

Itens que a pesquisa **não** conseguiu decidir. Conforme a regra, cada um adota
provisoriamente a opção mais próxima do Discord.

**P-1 · Causa do compartilhamento de tela esticado (D5).** Pesquisa eliminou as
duas hipóteses óbvias mas não achou a causa — ela exige medição num caso real.
Adotado provisoriamente: `object-fit: contain` (letterbox), que é o
comportamento de Discord e Meet. Protocolo de medição em D5.

**P-2 · Itens exatos do menu rápido de voz do Discord (T1).** Confirmado que o
recurso existe — *"The mute and deafen buttons now have down arrows (or 'carats')
to reveal more options"*
(<https://discord.com/blog/discord-patch-notes-november-4-2025>) — mas nenhuma
fonte lista os itens. Adotado provisoriamente o que a **imagem #11** mostra:
dispositivo de entrada, perfil de entrada, volume de entrada e atalho para as
configurações completas.

**P-3 · Ordem e nomes oficiais em pt-BR das configurações do Discord (D1).**
`support.discord.com` devolveu 403 em todas as tentativas. A árvore de D1 é
reconstrução de fontes secundárias.

**P-4 · Layout exato da presença de voz na barra lateral do Discord (D9).** Sem
fonte primária. Seguimos a imagem #12.

**P-5 · Confirmação do `base: "/"` no APK.** Verificado em execução no desktop e
por leitura do fonte do wry para Android, mas **não executado num aparelho**.

**P-6 · Tamanho real do `@dnd-kit/react` no nosso bundle (D6).** A pesquisa
esbarrou em limite de requisições. Medir com o bundle real antes de aprovar.

---

## Correções que estas decisões impõem ao `PLANO_EXECUCAO.md`

1. **T2 (câmera):** o caminho não é "republicar a track" — é
   `localVideoTrack.restartTrack({ facingMode })`. E `VideoCaptureOptions`
   **aceita** `facingMode`, ao contrário do que o plano dava a entender.
2. **T3 (tela):** a hipótese do `resolution` está descartada por evidência da
   própria decisão da WG do WebRTC (crop-and-scale, nunca distorce). A tarefa
   passa a ser medição, com o protocolo de D5.
3. **Armadilha A:** resolvida. `base: "/"` aplicado e verificado; o comentário
   herdado do Tauri v1 no `vite.config.ts` foi removido.
4. **T4 (avatares):** continua marcada como risco alto — a decisão de *onde*
   exibir (D9) não resolve a ausência de fonte de verdade da presença.
