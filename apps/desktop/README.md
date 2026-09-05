# @whatscord/desktop

Shell desktop do WhatsCord em **Tauri v2** (Windows / WebView2). Não tem frontend
próprio: carrega o build do `apps/web` (Vite). Em dev aponta para
`http://localhost:5173`, em produção empacota `../web/dist`.

Versões fixadas: `tauri` 2.11.5, `@tauri-apps/cli` 2.11.4 (estáveis mais recentes
em 05/09/2026).

---

## Pré-requisitos

| Item | Status nesta máquina |
| --- | --- |
| Node >= 22 | OK (v22.12.0) |
| Rust >= 1.77.2 (MSRV do Tauri 2.11) | OK (1.84.0) |
| **MSVC Build Tools + Windows SDK** | **verificar** — o Tauri linka com `link.exe` |
| WebView2 Runtime | já vem no Windows 11 |

Se `cargo build` reclamar de `link.exe`, instale o
"Desktop development with C++" pelo Visual Studio Build Tools.

## Antes do primeiro build (passos manuais)

1. **`npm install` na raiz do monorepo** — nada foi instalado ainda.
2. **Gerar os ícones.** O `bundle.icon` do `tauri.conf.json` aponta para
   `icons/32x32.png`, `icons/128x128.png`, `icons/128x128@2x.png`,
   `icons/icon.icns` e `icons/icon.ico`, que **ainda não existem** — sem eles o
   `tauri build` falha. Deixei um placeholder em `src-tauri/icons/app-icon.png`
   (1024x1024, balão de fala verde). Rode:

   ```bash
   npm run icons --workspace apps/desktop
   # equivale a: tauri icon ./src-tauri/icons/app-icon.png
   ```

   Troque o `app-icon.png` pela arte final depois e rode de novo.
3. **`apps/web` precisa existir** com `build` gerando `dist/` e `dev` subindo em
   `5173`. Recomendo `server: { port: 5173, strictPort: true }` no
   `vite.config.ts` — o `devUrl` está fixo nessa porta.
4. **Instalar os pacotes JS dos plugins no `apps/web`** (não em `apps/desktop`;
   quem chama as APIs é o frontend):

   ```bash
   npm i @tauri-apps/api @tauri-apps/plugin-shell @tauri-apps/plugin-dialog \
         @tauri-apps/plugin-os @tauri-apps/plugin-notification \
         @tauri-apps/plugin-store --workspace apps/web
   ```

## Rodar

```bash
npm run dev --workspace apps/desktop    # tauri dev (sobe o Vite junto)
npm run build --workspace apps/desktop  # tauri build
npm run dist --workspace apps/desktop   # tauri build --bundles nsis
```

O `beforeDevCommand` / `beforeBuildCommand` roda `npm run dev:web` /
`npm run build:web` com `cwd: "../../.."` (a raiz do monorepo). O `cwd` é
relativo ao diretório do `tauri.conf.json` — o CLI faz `set_current_dir(dirs.tauri)`
antes de resolver o hook.

> Detalhe: `npm run dist:desktop` na raiz constrói o web duas vezes (uma pelo
> script da raiz, outra pelo `beforeBuildCommand`). Inofensivo, mas se incomodar,
> use direto `npm run dist --workspace apps/desktop`.

O instalador sai em
`apps/desktop/src-tauri/target/release/bundle/nsis/WhatsCord_0.1.0_x64-setup.exe`.

---

## Decisões

### Screen share (`getDisplayMedia`)

**Funciona sem código nativo.** A WebView2 já traz o seletor de tela/janela do
Chromium: o evento `ScreenCaptureStarting` existe só para o host *cancelar* ou
customizar ("If canceled, the screen capture UI is not displayed", ou seja, se
ninguém cancela, a UI aparece). Não registrei handler nenhum — é o comportamento
que a gente quer.

Dois pontos que **quebrariam** o screen share e que foram tratados:

- **Contexto seguro.** `getDisplayMedia`/`getUserMedia` exigem secure context. O
  Tauri serve o app em `http://tauri.localhost` no Windows, e `*.localhost` é
  *potentially trustworthy* pelo spec do Chromium — então passa. Em dev,
  `http://localhost:5173` também.
- **CSP.** Ver abaixo.

### CSP

O `app.security.csp` está preenchido (não `null`) e inclui explicitamente o que
mídia e IPC precisam:

- `media-src 'self' blob: data: mediastream:` e `worker-src/child-src 'self' blob:`
  — para `URL.createObjectURL(stream)`, workers de encoding e blobs de áudio/vídeo.
  (`srcObject` puro não passa por CSP, mas metade das libs de WebRTC usa blob.)
- `connect-src ... ipc: http://ipc.localhost ...` — **isso é obrigatório**. O IPC
  do Tauri v2 usa o protocolo `ipc://localhost`, que no Windows vira
  `http://ipc.localhost`. O Tauri **não** injeta isso sozinho: ele só mexe em
  `script-src`/`style-src` para colocar nonce/hash. Sem essa entrada, *todo*
  `invoke()` morre por CSP.
- `connect-src` também libera `ws:`/`wss:`/`http://localhost:*`/`https:` porque a
  URL da API (`apps/api`) e do servidor de sinalização ainda não estão definidas.
  **Aperte isso quando o endereço do backend estiver fechado.**

Há um `devCsp` separado, mais frouxo (`'unsafe-inline'`/`'unsafe-eval'` +
`localhost:5173`) para o HMR do Vite não ser bloqueado.

### Permissões de mídia (microfone/câmera) — a parte chata

Na WebView2 o estado padrão de uma permission request é `Default`, que a doc da
Microsoft define como *"the default browser behavior is used, which normally
prompts users for decision"*. Ou seja: **apareceria um diálogo** pedindo
microfone/câmera toda vez.

O jeito "certo" seria o permission handler do Tauri
(`.on_permission_request(|_, kind| ...)` com `PermissionKind::Microphone`).
**Esse método não existe no Tauri 2.11.5.** Conferi no repo: o changeset
`.changes/permission-handler.md` marca `tauri: minor:feat`, então ele só sai no
**2.12.0**. Escrever isso hoje não compilaria.

Solução aplicada: flag da própria WebView2 em `additionalBrowserArgs`:

```
--auto-accept-camera-and-microphone-capture
```

É um switch do Chromium (`content/public/common/content_switches.cc`) descrito
como *"Bypasses the dialog prompting the user for permission to capture cameras
and microphones"*, e — importante — *"this flag does NOT affect screen-capture"*.
Exatamente o que queríamos: mic/câmera entram sem diálogo, e o **seletor de tela
continua aparecendo** (que é o certo — o usuário precisa escolher o que
compartilhar). É preferível ao `--use-fake-ui-for-media-stream`, que o próprio
Chromium desaconselha justamente porque mexe em screen capture.

Quando o Tauri 2.12 sair, dá para remover a flag e usar o handler — deixei o
código pronto, comentado, no `src-tauri/src/lib.rs`.

### `additionalBrowserArgs`

Valor completo:

```
--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection
--auto-accept-camera-and-microphone-capture
--autoplay-policy=no-user-gesture-required
```

**Atenção:** esse campo *substitui* o default do Tauri, ele não soma. O default é
`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection` (desliga a UI
out-of-process e o SmartScreen dentro da webview), então ele foi **recopiado** —
se for editar, mantenha essa parte.

`--autoplay-policy=no-user-gesture-required` faz o áudio remoto de uma chamada
tocar sem o usuário precisar clicar antes.

### Janela

`1280x800`, mínimo `940x560`, título `WhatsCord`, `decorations: true`,
`theme: "Dark"`, centralizada, `backgroundColor: "#111B21"` (o cinza do WhatsApp
dark) para não dar flash branco no boot.

### Plugins e capabilities

`shell`, `dialog`, `os`, `notification`, `store` e `single-instance`. O
single-instance é registrado **antes de todos os outros** (a doc exige: *"must be
the first one to be registered"*) e, na segunda instância, dá
`unminimize` + `show` + `set_focus` na janela `main` em vez de abrir outra. Ele
não tem API JS, então não entra nas capabilities.

`src-tauri/capabilities/default.json` cobre a janela `main` com `core:default`,
alguns `core:window:allow-*` (para uma titlebar custom no futuro),
`shell:allow-open` (links externos no browser padrão), `dialog:default`,
`os:default`, `notification:default` e `store:default`. Todos os identificadores
foram conferidos contra a referência de ACL da v2 — um identificador inexistente
faz o build falhar, não é warning.

### Comandos Rust

- `get_app_version() -> String` — versão vinda do `package_info()`.
- `set_badge_count(count: u32)` — **implementado de verdade no Windows**, não é
  stub. O Windows não tem badge numérico: `Window::set_badge_count` é no-op lá e
  a própria doc do Tauri manda usar `set_overlay_icon`. Então o `lib.rs` desenha
  um RGBA 32x32 (círculo vermelho + número, com uma fonte 3x5 embutida para não
  precisar de rasterizador) e seta como overlay icon da taskbar. `count == 0`
  remove o overlay; acima de 99 mostra "99". Fora do Windows cai no
  `set_badge_count` nativo.

```ts
import { invoke } from '@tauri-apps/api/core';
await invoke<string>('get_app_version');
await invoke('set_badge_count', { count: 7 });
```

### Instalador NSIS / assinatura

`bundle.targets: ["nsis"]`, `installMode: "currentUser"` (não pede admin,
metadados em HKCU), compressão LZMA, idiomas PT-BR + inglês com seletor.
`webviewInstallMode: downloadBootstrapper` silencioso — instalador pequeno, baixa
o runtime se faltar (no Windows 11 já vem).

**Sem assinatura de código.** Não há `certificateThumbprint`/`signCommand`. Na
prática: o **SmartScreen vai mostrar "Windows protected your PC"** na primeira
execução e o usuário precisa clicar em "More info" → "Run anyway". Isso melhora
sozinho conforme o binário ganha reputação, mas só some de vez com um
certificado de code signing (OV ~US$200/ano, ou EV, que zera o aviso na hora).
Cross-compilar x64 aqui é o padrão, não configurei outras arquiteturas.

---

## O que ainda falta

- [ ] `npm install` na raiz.
- [ ] `npm run icons --workspace apps/desktop` (senão o build quebra).
- [ ] `apps/web` existir com `dev` na porta 5173 e `build` gerando `dist/`.
- [ ] Instalar os pacotes `@tauri-apps/*` no `apps/web`.
- [ ] Apertar o `connect-src` do CSP quando a URL da API estiver definida.
- [ ] Confirmar MSVC Build Tools.
- [ ] Nada aqui foi compilado — a instrução era só escrever os arquivos.

## Requisito de toolchain (descoberto no primeiro build)

**Rust 1.85 ou mais novo.** Com 1.84.0 o build morre em:

```
error: failed to parse manifest at `.../serde_spanned-1.1.1/Cargo.toml`
Caused by: feature `edition2024` is required
```

A cadeia de dependencias do Tauri v2 ja usa edition 2024. `rustup update stable` resolve.
Build verificado com rustc 1.98.1.

O instalador sai em `src-tauri/target/release/bundle/nsis/WhatsCord_0.1.0_x64-setup.exe`
(~1,8 MB) e nao e assinado, entao o SmartScreen avisa no primeiro run.
