# PLANO_PESQUISA.md

Plano de pesquisa para as decisões pendentes do `PLANO_EXECUCAO.md`.
Nenhuma decisão pode ser inventada: **pesquise → compare → decida → documente**.

**Referência principal: Discord** (desktop e mobile). Onde o Discord não se
aplicar: Slack, Teams, Zoom, Google Meet. Empate após pesquisa → vence o que for
mais próximo do Discord.

Toda decisão em `DECISOES.md` precisa citar fonte: link de documentação, trecho
de código com caminho e linha, ou comportamento observado em execução.

---

## Correção de premissa antes de começar

O pedido original mencionava "Electron / Capacitor / React Native". **A stack não
é nenhuma dessas.**

| Camada | O que é de fato |
|---|---|
| Interface | React 19 + Vite 6, em `apps/web` |
| Desktop | **Tauri v2** (Rust) com **WebView2** no Windows |
| Android | **Tauri v2** com **Android System WebView** |

Windows e Android são a **mesma WebView** carregando o mesmo `apps/web/dist`. Não
há código nativo de interface em lugar nenhum. Isso muda materialmente as
pesquisas P3 e P4: não vale pesquisar limitação de Capacitor ou de React Native
WebView — o que vale é o Android System WebView (Chromium) sob Tauri/wry.

---

## P1 — Estrutura de categorias das configurações (T6a)

**Pergunta.** Qual árvore de categorias a tela de configurações deve ter, e em
que ordem?

**O que pesquisar.**
- Categorias e ordem em "Configurações do usuário" do Discord (imagem #15 mostra:
  Conta → Informações da conta, Senha e segurança, Status da Conta, Central da
  Família; Dados e privacidade; Permissões de mensagens; Notificações; seção
  Cobrança; seção Experiência → Voz e vídeo, Aparência, Acessibilidade).
- Conteúdo da seção "Voz e vídeo" do Discord (dispositivo de entrada e saída,
  volumes, sensibilidade, supressão de ruído, eco, vídeo/câmera, qualidade).
- O que existe **neste** app hoje: `apps/web/src/ui/Settings.tsx` (perfil e sair),
  `apps/web/src/ui/DevicePicker.tsx` (mic, câmera, alto-falante, medidor, som de
  entrada/saída, modo de compartilhamento).

**Como verificar.** Ler os dois arquivos acima e listar cada controle existente;
mapear um a um para a categoria do Discord correspondente; marcar o que o Discord
tem e nós não (não inventar tela vazia) e o que nós temos e o Discord não.

**Critério de decisão.** Toda categoria proposta precisa ter **pelo menos um
controle real já existente ou explicitamente planejado** nas tarefas T1–T7.
Categoria sem conteúdo é descartada. Nomenclatura segue o Discord em português.

---

## P2 — Mensagens de erro da API traduzíveis (T6c)

**Pergunta.** A API passa a devolver código de erro traduzível, mantém frase em
inglês, ou adota uma camada de compatibilidade?

**O que pesquisar.**
- Padrões de i18n de erro em API: RFC 9457 (Problem Details for HTTP APIs), e
  como bibliotecas/serviços modernos expõem `code` + `params` para o cliente
  traduzir.
- Como Slack e Stripe estruturam erro traduzível (ambos usam código estável +
  mensagem legível).
- Contrato atual: as 42 mensagens distintas em `apps/api/src/routes/*.ts` e a
  única em `apps/api/src/lib/rooms.ts`; e onde o cliente as exibe
  (`err.message` em `Auth.tsx`, `Modals.tsx`, `Invites.tsx`).

**Como verificar.** Inspecionar o formato atual de resposta de erro
(`{ error: "frase" }`) e o `setErrorHandler` em `apps/api/src/server.ts`. Confirmar
que adicionar um campo **não** quebra quem lê `error`.

**Critério de decisão.** Preferir a solução que **não quebra clientes
existentes** (exigência explícita do dono). Ou seja: acrescentar campo, nunca
substituir, salvo se a pesquisa mostrar que substituir é claramente superior e
sem custo.

---

## P3 — `base: "./"` vs `"/"` (armadilha A)

**Pergunta.** Dá para usar `base: "/"` sem quebrar o app desktop? Dá para ter
base diferente por alvo de build?

**O que pesquisar.**
- Documentação do Vite sobre `base`, e se ele aceita valor condicional por `mode`
  ou variável de ambiente.
- O que o **template oficial do Tauri v2** para React/Vite usa como `base`
  (indício forte: se não define, o padrão `/` funciona).
- Como a WebView do Tauri v2 serve os arquivos: origem `http://tauri.localhost/`
  (Windows) — se é uma origem com raiz, caminho absoluto resolve.
- Por que o comentário atual em `apps/web/vite.config.ts` diz *"Tauri loads the
  build from disk"* — verificar se isso é herança do Tauri **v1** (`file://`), que
  é onde `./` era obrigatório.

**Como verificar.** **Teste obrigatório, não pular:** mudar para `base: "/"`,
`npm run dist --workspace apps/desktop`, **instalar o app e abrir**. Janela em
branco = reverter. Verificar também o APK, que usa a mesma WebView.

**Critério de decisão.** `/` vence se e somente se o app desktop **abrir e
renderizar** depois de instalado. Se falhar, avaliar base por alvo antes de
desistir.

---

## P4 — Troca de câmera no mobile (T2)

**Pergunta.** Por que não dá para trocar de câmera no celular, e qual a solução
correta para o Android System WebView?

**O que pesquisar.**
- MDN: `facingMode` (`user`/`environment`), `enumerateDevices`,
  `MediaStreamTrack.applyConstraints`.
- Se, no Chromium para Android, `enumerateDevices()` expõe frontal e traseira
  como `deviceId` distintos e **rotulados** após permissão concedida.
- Limitações conhecidas do **Android System WebView** (não Capacitor, não RN) com
  `getUserMedia` e troca de câmera.
- Confirmado no código: `room.switchActiveDevice(kind, deviceId, exact?)` só
  aceita deviceId — não há como passar `facingMode` por ali
  (`node_modules/livekit-client/dist/src/room/Room.d.ts:228`).
- Como o LiveKit recomenda trocar câmera em mobile: existe helper, ou é
  republicar a track?

**Como verificar.** Rodar a web em celular real e logar o retorno de
`enumerateDevices()`: quantas `videoinput`, com que `deviceId` e que `label`. Esse
log decide o caminho. Repetir dentro do APK, que é outra WebView.

**Critério de decisão.** Se os `deviceId` vierem distintos e rotulados, a
correção é de interface. Se não vierem, a solução é republicar a track de vídeo
com `facingMode`, contornando `switchActiveDevice`. Documentar a solução por
plataforma, como pedido.

---

## P5 — Compartilhamento de tela esticado (T3)

**Pergunta.** O que causa a imagem esticada, e como Discord e Meet exibem tela
compartilhada?

**O que pesquisar.**
- MDN e spec: constraints de `getDisplayMedia`, comportamento de `ideal` vs
  `exact`, e o que acontece quando `aspectRatio` não é enviado.
- Já apurado (reconfirmar): o LiveKit envia `width: { ideal: 1920 }` e **não**
  envia `aspectRatio`. Ou seja o SDK **não** força 16:9 — a causa provável está
  no lado de quem exibe.
- Como Discord e Meet renderizam a tela recebida: `object-fit`, letterbox,
  contêiner de proporção fixa ou livre.
- Nosso CSS: `.call-stage.focus .stage-main .tile { aspect-ratio: auto; height:
  100% }` e `.tile video { object-fit: contain }` em `apps/web/src/styles.css`.

**Como verificar.** Numa chamada real, do lado de quem **recebe**, comparar
`track.mediaStreamTrack.getSettings()` (largura/altura reais) com as dimensões
renderizadas do `<video>` e com `videoWidth`/`videoHeight`. Bateu → CSS. Não
bateu → captura. Testar com tela 16:9, 16:10 e janela estreita.

**Critério de decisão.** A correção tem que eliminar a distorção nas três
proporções **sem** cortar conteúdo. Entre letterbox e corte, vence letterbox
(é o que Discord e Meet fazem para tela, onde perder pedaço é inaceitável).

---

## P6 — Drag and drop de espaços e pastas (T5)

**Pergunta.** Qual biblioteca de DnD usar, e qual o comportamento exato do
Discord para reordenar e criar pasta?

**O que pesquisar.**
- Bibliotecas de DnD para **React 19**: dnd-kit, react-beautiful-dnd (arquivada),
  Pragmatic drag and drop (Atlassian), SortableJS. Comparar por: suporte a React
  19, suporte a **teclado**, suporte a **toque**, tamanho, manutenção ativa.
- Comportamento do Discord (imagem #14): arrastar servidor para reordenar;
  **soltar um servidor sobre outro cria uma pasta**; pasta pode ser renomeada e
  colorida; arrastar para fora tira da pasta.
- Nosso estado: nenhuma lib instalada; `Room.position` já existe e ordena canais;
  **não existe** campo de ordem para espaço.

**Como verificar.** Checar a matriz de compatibilidade de cada candidata com
React 19 na documentação oficial e no repositório (issues abertas sobre React 19).
Medir o custo em KB no bundle — o carregamento inicial hoje é 298 KB e não pode
inchar sem motivo.

**Critério de decisão.** Suporte a teclado e a toque são **obrigatórios** (a
barra lateral tem que continuar operável no celular). Entre as que passarem,
vence a menor e a de manutenção mais ativa.

---

## P7 — Temas (T6b)

**Pergunta.** Que temas oferecer e como estruturá-los?

**O que pesquisar.**
- Discord (imagem #16): "Mesmo tema do dispositivo" (interruptor) + "Temas
  padrão" (claro, escuro acinzentado, escuro, preto/OLED, e um botão de
  sincronizar).
- Padrão da plataforma: `prefers-color-scheme`, propriedade `color-scheme`, e
  como marcar escolha explícita sem quebrar a preferência do sistema.
- Nosso estado: 26 variáveis em `:root`, **45 cores literais fora do `:root`**,
  `color-scheme: dark` **fixo** na linha 56 de `styles.css`.

**Como verificar.** Listar as 45 cores literais com linha e classificar cada uma:
vira variável nova, reaproveita variável existente, ou é intencionalmente fixa
(ex.: fundo preto de vídeo). Esse levantamento **é** o trabalho da T6b.

**Critério de decisão.** Cobrir no mínimo claro, escuro e "igual ao sistema".
Variantes extras (OLED) só se saírem de graça do mesmo mecanismo.

---

## P8 — Idioma: estrutura de i18n (T6c)

**Pergunta.** Que biblioteca e que estrutura usar para EN/PT/ES, e qual o idioma
padrão de quem chega sem preferência?

**O que pesquisar.**
- Bibliotecas para React/Vite: react-i18next, LinguiJS, FormatJS/react-intl,
  ou solução própria. Comparar por: tamanho, plurais, interpolação, carregamento
  sob demanda, e esforço para adicionar idioma novo.
- Discord (imagem #17): seletor com nome do idioma **no próprio idioma** mais o
  nome traduzido ao lado, com bandeira.
- Como detectar preferência: `navigator.languages`, e o que Discord/Slack fazem
  no primeiro acesso.
- Nosso estado: ~285 ocorrências no cliente, 42 mensagens de erro na API,
  `Intl.DateTimeFormat(undefined, …)` já locale-aware em `lib/format.ts`.

**Critério de decisão.** Peso no bundle e facilidade de adicionar o 4º idioma sem
tocar em componente. Para o padrão: detectar do navegador com recuo para inglês,
salvo se a pesquisa mostrar prática diferente no Discord.

---

## P9 — Onde exibir os avatares da chamada (T4)

**Pergunta.** Os avatares vão na linha do canal de voz da barra lateral, ou em
outro lugar?

**O que pesquisar.**
- Discord: mostra a **lista de participantes abaixo do canal de voz** na barra
  lateral, com avatar e nome, mais indicador de fala e de mudo.
- A imagem #12 aponta exatamente a linha do canal de voz na nossa barra lateral.
- A imagem #13 mostra o popover de participante: avatar, nome, ícones de estado
  ("Silenciado(a)").
- Nosso estado: `RoomRow` em `apps/web/src/ui/Sidebar.tsx` (~267-330) mostra só
  a contagem.

**Critério de decisão.** Seguir o Discord, que é o que a imagem #12 indica.
Justificar a escolha no `DECISOES.md`, como pedido.

---

## P10 — Quem pode trocar o ícone de espaço e de grupo

**Pergunta.** Que papel é exigido?

**O que pesquisar.** Modelo de permissão do Discord: quem pode editar servidor
(Gerenciar Servidor) e quem pode editar canal (Gerenciar Canais). Nosso enum já
tem `OWNER | ADMIN | MEMBER`, e a única checagem existente
(`spaces.ts:94`) já recusa `MEMBER` para criar canal — há precedente interno.

**Critério de decisão.** Coerência com o precedente já existente no próprio
código, e com o Discord.

---

## P11 — Remoção de membros e o destino das mensagens

**Pergunta.** Quem pode remover, e o que acontece com o que a pessoa escreveu?

**O que pesquisar.** Discord: expulsar exige "Expulsar Membros"; **as mensagens
permanecem**. Nosso precedente já estabelecido: ao **sair** de um espaço, as
mensagens ficam (`apps/api/src/routes/spaces.ts`, rota `DELETE
/spaces/:id/members/me`).

**Critério de decisão.** Coerência com o precedente interno e com o Discord.

---

## P12 — Regerar o código de convite invalida o antigo?

**Pergunta.** Ao regerar, o link antigo continua funcionando?

**O que pesquisar.** Discord: convites são múltiplos e revogáveis
individualmente, com expiração e limite de usos. Nosso modelo é **um único
`inviteCode` por espaço** (`schema.prisma`), o que é mais simples e não comporta
convite múltiplo sem migração.

**Critério de decisão.** Dentro do modelo atual, decidir o comportamento de
regeneração. Se a pesquisa indicar que múltiplos convites são claramente
superiores, registrar como evolução futura — não migrar agora sem necessidade.

---

## Execução

- P1, P2, P6, P7, P8 podem rodar em paralelo (pesquisa externa).
- P3, P4, P5 exigem **execução e medição**, não só leitura.
- P9, P10, P11, P12 são curtas e decidem por coerência com precedente + Discord.

Saída obrigatória: **`DECISOES.md`** com, para cada item: opções consideradas,
evidências com fonte, decisão e justificativa. O que não for decidível por
pesquisa vai para a seção **Pendências**, com a opção mais próxima do Discord
adotada provisoriamente.
