# Android — como gerar o APK

Validado em 05/09/2026: APK de 25,7 MB, assinado com o certificado de depuração,
instalável por sideload.

## O que precisa estar instalado

| | Versão usada aqui |
|---|---|
| JDK | 17 |
| Android SDK | platforms 34-36, build-tools 35.0.0 |
| NDK | 27.1.12297006 |
| Alvos Rust | `aarch64-linux-android` (e os outros três, se quiser universal) |

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi \
                  i686-linux-android x86_64-linux-android
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
```

## As permissões são obrigatórias e não são geradas

`tauri android init` produz um `AndroidManifest.xml` com **apenas** `INTERNET`.
Sem `CAMERA`, `RECORD_AUDIO` e `MODIFY_AUDIO_SETTINGS` a chamada entra muda e
cega: o `getUserMedia` falha.

O que faz isso funcionar é o wry, não código nosso — `RustWebChromeClient.kt`
(wry 0.55.1) já implementa `onPermissionRequest` e dispara o pedido de permissão
em tempo de execução quando a página chama `getUserMedia`. Mas ele só consegue
pedir o que estiver declarado no manifesto.

Por isso **`src-tauri/gen/android` é versionado** — só as fontes; as saídas do
Gradle e a biblioteca nativa ficam no `.gitignore`. Se estivesse tudo ignorado,
um clone novo rodaria `tauri android init` e perderia as permissões em silêncio.

## Compartilhamento de tela não funciona no Android

O wry não trata `getDisplayMedia` — não há nada equivalente ao
`onPermissionRequest` para captura de tela, o que exigiria a API MediaProjection
nativa. O app detecta isso (`canShareScreen` em `lib/screenshare.ts`) e desabilita
o botão com a explicação, em vez de deixar a pessoa clicar e nada acontecer.

## Duas armadilhas do build no Windows

**1. `set_badge_count` não existe no Android.** O código tinha
`#[cfg(not(target_os = "windows"))]`, que também casa com Android, e o build
quebrava com E0599. Agora a versão de desktop é `#[cfg(all(not(target_os =
"windows"), desktop))]` e há uma não-operação em `#[cfg(mobile)]`.

**2. O Tauri cria a `.so` por link simbólico, e o Windows recusa** sem modo
desenvolvedor:

```
Failed to create a symbolic link ... Creation symbolic link is not allowed for this system.
```

Não é preciso mexer na configuração do Windows. O Rust já compilou nesse ponto;
basta copiar a biblioteca no lugar do link e chamar o Gradle direto:

```bash
NDK="$ANDROID_HOME/ndk/27.1.12297006"
STRIP="$NDK/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe"

cd apps/desktop/src-tauri
mkdir -p gen/android/app/src/main/jniLibs/arm64-v8a
"$STRIP" --strip-unneeded \
  -o gen/android/app/src/main/jniLibs/arm64-v8a/libwhatscord_desktop_lib.so \
  target/aarch64-linux-android/debug/libwhatscord_desktop_lib.so

cd gen/android
./gradlew assembleArm64Debug -x rustBuildArm64Debug -x rustBuildUniversalDebug
```

O `llvm-strip` não é opcional: a biblioteca de depuração tem **152 MB** com os
símbolos e **17,8 MB** sem eles. A diferença é entre um APK inviável de mandar
por mensagem e um de 25 MB.

Saída em `gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`.

## Sequência completa

```bash
cd apps/desktop
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"

# Compila o Rust e para no erro do link simbolico — e esperado.
npx tauri android build --apk --debug --target aarch64 || true

# Contorna o link, empacota.
# (os comandos de strip + gradle acima)
```

## Debug ou release

O APK de **depuração** sai assinado com o certificado padrão do Android
(`CN=Android Debug`) e instala por sideload sem mais nada. É o caminho para
testar no próprio aparelho.

Um APK de **release** sai sem assinatura e o Android recusa a instalação. Para
distribuir de verdade é preciso gerar um keystore próprio:

```bash
keytool -genkey -v -keystore whatscord.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias whatscord
```

A senha desse keystore é sua e não deve entrar no repositório — guarde fora dele
(`.secrets/` está no `.gitignore`). Perder o keystore significa não conseguir
mais publicar atualização do mesmo app.

## Verificar o que saiu

```bash
"$ANDROID_HOME/build-tools/35.0.0/aapt2.exe" dump permissions <arquivo.apk>
"$ANDROID_HOME/build-tools/35.0.0/apksigner.bat" verify --print-certs <arquivo.apk>
```

## Não validado

O APK **não foi instalado nem executado num aparelho** — não há Android físico
nem emulador aberto nesta máquina. Estão confirmados: que ele compila, que está
assinado, e que as quatro permissões entraram no pacote. Se `getUserMedia` de
fato abre o microfone no aparelho, só o teste no celular diz.
