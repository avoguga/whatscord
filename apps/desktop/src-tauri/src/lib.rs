use tauri::Manager;

// ---------------------------------------------------------------------------
// Comandos expostos ao frontend
// ---------------------------------------------------------------------------

/// Versao do app, lida do Cargo.toml/tauri.conf.json em tempo de build.
/// No frontend: `await invoke<string>("get_app_version")`.
#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Badge de mensagens nao lidas no icone da taskbar.
///
/// No Windows nao existe badge numerico nativo: `Window::set_badge_count` e
/// no-op ali e a propria doc do Tauri manda usar `set_overlay_icon`. Entao
/// desenhamos um circulo vermelho com o numero e usamos como overlay icon
/// (mesma tecnica do Discord/Slack). `count == 0` remove o overlay.
#[cfg(target_os = "windows")]
#[tauri::command]
fn set_badge_count(window: tauri::Window, count: u32) -> Result<(), String> {
    if count == 0 {
        return window.set_overlay_icon(None).map_err(|e| e.to_string());
    }

    let (rgba, width, height) = render_badge_icon(count);
    let icon = tauri::image::Image::new_owned(rgba, width, height);
    window
        .set_overlay_icon(Some(icon))
        .map_err(|e| e.to_string())
}

/// Fora do Windows, no desktop, o Tauri tem badge numerico de verdade
/// (macOS/Linux).
#[cfg(all(not(target_os = "windows"), desktop))]
#[tauri::command]
fn set_badge_count(window: tauri::Window, count: u32) -> Result<(), String> {
    let value = if count == 0 { None } else { Some(count as i64) };
    window.set_badge_count(value).map_err(|e| e.to_string())
}

/// No Android nao existe badge de janela: quem exibe contador no icone e o
/// launcher, por um canal proprio de cada fabricante. Uma nao-operacao mantem
/// o mesmo comando disponivel para o frontend, que assim nao precisa saber em
/// que plataforma esta rodando.
#[cfg(mobile)]
#[tauri::command]
fn set_badge_count(_window: tauri::Window, _count: u32) -> Result<(), String> {
    Ok(())
}

// ---------------------------------------------------------------------------
// Desenho do badge (somente Windows)
// ---------------------------------------------------------------------------

/// Fonte 3x5 embutida para os digitos 0-9. Cada u8 e uma linha e os 3 bits
/// menos significativos sao as colunas (bit 2 = coluna da esquerda).
/// Evita depender de um rasterizador de fonte so para desenhar 2 digitos.
#[cfg(target_os = "windows")]
const DIGIT_GLYPHS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111], // 0
    [0b010, 0b110, 0b010, 0b010, 0b111], // 1
    [0b111, 0b001, 0b111, 0b100, 0b111], // 2
    [0b111, 0b001, 0b111, 0b001, 0b111], // 3
    [0b101, 0b101, 0b111, 0b001, 0b001], // 4
    [0b111, 0b100, 0b111, 0b001, 0b111], // 5
    [0b111, 0b100, 0b111, 0b101, 0b111], // 6
    [0b111, 0b001, 0b001, 0b001, 0b001], // 7
    [0b111, 0b101, 0b111, 0b101, 0b111], // 8
    [0b111, 0b101, 0b111, 0b001, 0b111], // 9
];

/// Gera um RGBA 32x32: circulo vermelho + numero em branco.
/// Contagens acima de 99 sao exibidas como "99".
#[cfg(target_os = "windows")]
fn render_badge_icon(count: u32) -> (Vec<u8>, u32, u32) {
    const SIZE: i32 = 32;
    const SCALE: i32 = 3;
    const GLYPH_W: i32 = 3;
    const GLYPH_H: i32 = 5;

    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];

    // Circulo preenchido, com borda de 1px suavizada.
    let center = SIZE as f32 / 2.0;
    let radius = center - 1.0;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 + 0.5 - center;
            let dy = y as f32 + 0.5 - center;
            let dist = (dx * dx + dy * dy).sqrt();
            let alpha = ((radius - dist).clamp(0.0, 1.0) * 255.0).round() as u8;
            let i = ((y * SIZE + x) * 4) as usize;
            rgba[i] = 237;
            rgba[i + 1] = 66;
            rgba[i + 2] = 69;
            rgba[i + 3] = alpha;
        }
    }

    let digits: Vec<usize> = if count > 99 {
        vec![9, 9]
    } else if count >= 10 {
        vec![(count / 10) as usize, (count % 10) as usize]
    } else {
        vec![count as usize]
    };

    let n = digits.len() as i32;
    let text_w = n * GLYPH_W * SCALE + (n - 1) * SCALE;
    let mut ox = (SIZE - text_w) / 2;
    let oy = (SIZE - GLYPH_H * SCALE) / 2;

    for d in digits {
        for (row, bits) in DIGIT_GLYPHS[d].iter().enumerate() {
            for col in 0..GLYPH_W {
                let mask = 1u8 << ((GLYPH_W - 1 - col) as u32);
                if *bits & mask == 0 {
                    continue;
                }
                for sy in 0..SCALE {
                    for sx in 0..SCALE {
                        let px = ox + col * SCALE + sx;
                        let py = oy + row as i32 * SCALE + sy;
                        if px < 0 || px >= SIZE || py < 0 || py >= SIZE {
                            continue;
                        }
                        let i = ((py * SIZE + px) * 4) as usize;
                        rgba[i] = 255;
                        rgba[i + 1] = 255;
                        rgba[i + 2] = 255;
                        rgba[i + 3] = 255;
                    }
                }
            }
        }
        ox += GLYPH_W * SCALE + SCALE;
    }

    (rgba, SIZE as u32, SIZE as u32)
}

// ---------------------------------------------------------------------------
// Links de convite (whatscord://join/<codigo>)
// ---------------------------------------------------------------------------

/// Entrega a URL ao frontend como um evento de DOM e traz a janela para frente.
///
/// De proposito nao usa o canal de eventos do Tauri: assim o codigo da interface
/// nao precisa importar nada de Tauri para ouvir o convite, e o mesmo arquivo
/// roda no navegador (onde este evento simplesmente nunca dispara).
///
/// A URL vem do sistema operacional, escrita por quem mandou o link, e por isso
/// e serializada com serde_json em vez de interpolada crua — o resultado e um
/// literal de string JS valido para qualquer conteudo.
#[cfg(desktop)]
fn deliver_deep_links<R: tauri::Runtime>(app: &tauri::AppHandle<R>, urls: Vec<String>) {
    /*
     * Com a janela escondida na bandeja, entregar o convite sem mostrar a
     * janela faria o clique no link parecer que nao fez nada — o app estaria
     * abrindo o espaco numa janela invisivel.
     */
    mostrar_janela(app);

    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    for url in urls {
        let Ok(json) = serde_json::to_string(&url) else {
            continue;
        };
        let _ = window.eval(&format!(
            "window.dispatchEvent(new CustomEvent('whatscord:deeplink',{{detail:{json}}}))"
        ));
    }

    // Um convite so serve se a pessoa VER que ele chegou.
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Entrega o idioma do SISTEMA para a pagina, antes de qualquer script dela.
 *
 * Dentro da WebView2 do Windows, `navigator.language` NAO reflete de forma
 * confiavel a configuracao do sistema (wry#442). Sem perguntar ao SO pelo lado
 * nativo, o app instalado numa maquina em portugues pode abrir em ingles — e
 * essa e a primeira impressao do produto.
 *
 * Precisa ser `js_init_script` e nao um comando: um comando so responde depois
 * que a pagina carregou, e ai a primeira tela ja saiu no idioma errado e
 * trocaria no quadro seguinte. O script de inicializacao roda ANTES do HTML,
 * entao quando o `main.tsx` for decidir o idioma o valor ja esta la.
 *
 * Se o SO nao souber dizer, nada e injetado e a pagina cai sozinha para
 * `navigator.languages` — a cascata do lado do cliente ja trata a ausencia.
 */
/*
 * Concreto em `Wry` de proposito, e nao generico sobre `R: Runtime`. Generico,
 * o `R` so era inferivel no desktop: no Android o bloco `#[cfg(desktop)]` some,
 * o `builder` deixa de ser reatribuido e a inferencia perde a ancora — o build
 * para Android quebrava com E0283. `Wry` e o unico runtime que este app usa.
 */
fn locale_do_sistema() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let mut builder = tauri::plugin::Builder::new("wc-locale");

    if let Some(tag) = sys_locale::get_locale() {
        // `serde_json` escapa a etiqueta antes de ela virar codigo. Uma etiqueta
        // BCP 47 nao deveria conter aspas, mas ela vem do SISTEMA OPERACIONAL e
        // nao de nos; interpolar direto seria confiar num valor externo dentro
        // de um script.
        let literal = serde_json::to_string(&tag).unwrap_or_else(|_| "null".into());
        builder = builder.js_init_script(format!("window.__WC_LOCALE__ = {literal};"));
    }

    builder.build()
}

/**
 * Se o app esta encerrando de verdade.
 *
 * Sem esta trava, "Sair" no menu da bandeja poderia NAO sair: `exit` pede o
 * fechamento da janela, o interceptador de fechar cancela achando que e a
 * pessoa clicando no X, e o app fica preso vivo — encerravel so pelo
 * gerenciador de tarefas, que e como um app de bandeja vira um app odiado.
 */
#[cfg(desktop)]
static ENCERRANDO: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/**
 * Mostra a janela e traz para a frente.
 *
 * Os tres passos sao necessarios e nenhum substitui o outro: `show` desfaz o
 * esconder da bandeja, `unminimize` desfaz o minimizar do proprio Windows, e
 * `set_focus` traz para a frente de outras janelas. Faltando um, a pessoa
 * clica no icone e nada parece acontecer.
 */
#[cfg(desktop)]
fn mostrar_janela<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(janela) = app.get_webview_window("main") {
        let _ = janela.show();
        let _ = janela.unminimize();
        let _ = janela.set_focus();
    }
}

/**
 * Avisa, UMA vez so, que fechar nao encerrou o app.
 *
 * Sem isto o primeiro fechar parece um bug: a janela some, nada acontece, e a
 * pessoa acha que o programa travou ou fechou de vez. E depois reclama que
 * "abriu duas vezes" quando encontra o icone.
 *
 * O marcador e um arquivo vazio na pasta de configuracao, e nao um contador em
 * memoria: um aviso por execucao apareceria toda vez que o app fosse aberto, o
 * que e exatamente o tipo de repeticao que faz a pessoa parar de ler avisos.
 */
#[cfg(desktop)]
fn avisar_bandeja_uma_vez<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    let Ok(pasta) = app.path().app_config_dir() else {
        return;
    };
    let marcador = pasta.join("bandeja-avisada");
    if marcador.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&pasta);
    let _ = std::fs::write(&marcador, b"");

    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title("WhatsCord continua aberto")
        .body("A janela fechou, mas o app segue rodando na bandeja. Clique no icone para voltar, ou use Sair para encerrar de vez.")
        .show();
}

/**
 * O icone na bandeja, e fechar que esconde em vez de encerrar.
 *
 * E o que WhatsApp e Discord fazem, e a razao e a mesma nos tres: um app de
 * conversa que encerra ao fechar a janela deixa de entregar mensagem, e a
 * pessoa so descobre horas depois. Fechar a janela quer dizer "tire isto da
 * minha frente", nao "pare de me avisar".
 *
 * O menu tem "Sair" de verdade. Sem ele, encerrar exigiria o gerenciador de
 * tarefas — que e como um app de bandeja vira um app odiado.
 */
#[cfg(desktop)]
fn montar_bandeja(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let abrir = MenuItem::with_id(app, "abrir", "Abrir WhatsCord", true, None::<&str>)?;
    let sair = MenuItem::with_id(app, "sair", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&abrir, &sair])?;

    let mut construtor = TrayIconBuilder::with_id("principal")
        .tooltip("WhatsCord")
        .menu(&menu)
        /*
         * O menu NAO abre no clique esquerdo: no Windows o esquerdo e o gesto
         * de "abrir o app" e o direito e o de "ver opcoes". Deixar o menu no
         * esquerdo tiraria o unico gesto que a pessoa tenta primeiro.
         */
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evento| match evento.id.as_ref() {
            "abrir" => mostrar_janela(app),
            "sair" => {
                ENCERRANDO.store(true, std::sync::atomic::Ordering::SeqCst);
                /*
                 * Instalar ao sair. A tela recebe o aviso e, se houver versao
                 * nova ja baixada, instala em silencio sem reabrir — o padrao
                 * do electron-updater e o que o Chrome faz. Sem nada a
                 * instalar, a propria tela encerra na hora.
                 *
                 * O prazo de 5 s e a garantia: "Sair" nunca pode deixar de
                 * sair, nem com a tela travada. Se estourar no meio de uma
                 * instalacao, o pior caso e a atualizacao ficar para a
                 * proxima abertura.
                 *
                 * Isto so roda pelo menu. Desligar ou sair da conta do Windows
                 * encerra o app por outro caminho — e e bom que seja assim: o
                 * sistema mata o instalador no meio e deixaria o app
                 * desinstalado (electron-builder#7807).
                 */
                use tauri::Emitter;
                let _ = app.emit("whatscord://saindo", ());
                let handle = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    handle.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|bandeja, evento| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = evento
            {
                mostrar_janela(bandeja.app_handle());
            }
        });

    // O mesmo icone da janela; nao ha por que ter dois.
    if let Some(icone) = app.default_window_icon() {
        construtor = construtor.icon(icone.clone());
    }
    construtor.build(app)?;

    if let Some(janela) = app.get_webview_window("main") {
        let escondida = janela.clone();
        let alca = app.handle().clone();
        janela.on_window_event(move |evento| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = evento {
                // Encerrando de verdade: deixa fechar.
                if ENCERRANDO.load(std::sync::atomic::Ordering::SeqCst) {
                    return;
                }
                // Impede o fechamento ANTES de esconder: sem isto a janela some
                // e o processo morre junto, e a bandeja fica com um icone morto.
                api.prevent_close();
                let _ = escondida.hide();
                avisar_bandeja_uma_vez(&alca);
            }
        });
    }

    Ok(())
}

/**
 * Concede microfone e camera para a origem do app, de forma PERSISTIDA.
 *
 * O app ja passava `--auto-accept-camera-and-microphone-capture` para a
 * WebView, e por isso a chamada sempre funcionou. So que esse sinalizador
 * aceita o AVISO de permissao; ele nao GRAVA a permissao para a origem. E o
 * navegador so revela nome e id dos dispositivos quando a permissao esta
 * concedida — entao `enumerateDevices()` devolvia entradas fantasma, sem nome e
 * sem id, e a tela de escolher microfone ficava vazia com um botao "permitir"
 * que nao tinha como funcionar: ele chama `getUserMedia`, que era auto-aceito
 * de novo e de novo nao gravava nada.
 *
 * Cuidado com uma armadilha na leitura do wry: ele registra um
 * `PermissionRequested`, mas o handler dele so responde a CLIPBOARD_READ.
 * Microfone e camera nao passam por ali — tirar o sinalizador para "deixar o
 * wry cuidar" quebraria a chamada inteira.
 *
 * `SetPermissionState` e a API que grava de verdade. O sinalizador continua
 * onde estava, como rede: se esta chamada falhar em alguma versao da WebView2,
 * a chamada segue funcionando e o que se perde e so o nome dos dispositivos.
 */
#[cfg(target_os = "windows")]
fn conceder_midia(janela: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile4, ICoreWebView2_13, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::SetPermissionStateCompletedHandler;
    use windows::core::{Interface, HSTRING, PCWSTR};

    let _ = janela.with_webview(|wv| unsafe {
        let Ok(nucleo) = wv.controller().CoreWebView2() else {
            return;
        };
        // `Profile` so existe da versao 13 em diante; numa WebView2 antiga o
        // cast falha e ficamos com o comportamento de antes, que funciona.
        let Ok(v13) = nucleo.cast::<ICoreWebView2_13>() else {
            return;
        };
        let Ok(perfil) = v13.Profile() else {
            return;
        };
        let Ok(perfil4) = perfil.cast::<ICoreWebView2Profile4>() else {
            return;
        };

        /*
         * As duas origens: o app e servido por `http://tauri.localhost` no
         * Windows, mas o esquema muda entre versoes e plataformas. Conceder as
         * duas custa uma chamada a mais e evita depender desse detalhe.
         */
        for origem in ["http://tauri.localhost", "https://tauri.localhost"] {
            let texto = HSTRING::from(origem);
            for tipo in [
                COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                COREWEBVIEW2_PERMISSION_KIND_CAMERA,
            ] {
                let _ = perfil4.SetPermissionState(
                    tipo,
                    PCWSTR(texto.as_ptr()),
                    COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                    &SetPermissionStateCompletedHandler::create(Box::new(|_| Ok(()))),
                );
            }
        }
    });
}

/*
 * A marca de entrada do Android TEM de ficar colada nesta funcao.
 *
 * Ela ja esteve em cima de `locale_do_sistema`: quando aquela funcao foi
 * inserida acima do `run`, entrou entre a marca e a funcao que ela marcava. O
 * build nao reclama — a marca aceita qualquer funcao — e o APK saia assinado,
 * com as permissoes certas e sem o app dentro: o Android chamava
 * `locale_do_sistema`, o `run` nunca rodava, e o compilador descartava o Tauri
 * inteiro e o site junto como codigo morto. A biblioteca caiu de 18 MB para
 * 2,7 MB, e foi isso que denunciou.
 */
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // O single-instance PRECISA ser o primeiro plugin registrado (doc oficial:
    // "This assures that it runs before other plugins can interfere"). Por isso
    // ele entra aqui, antes do encadeamento dos demais, e nao dentro do setup().
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Segunda instancia: em vez de abrir outra janela, traz a existente
            // para frente (comportamento de Discord/WhatsApp Desktop).
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }

            /*
             * No Windows o sistema NAO avisa um app ja aberto que um link foi
             * clicado: ele abre uma instancia nova com a URL como unico
             * argumento. E aqui que essa segunda instancia entrega o link para
             * a que ja estava rodando, antes de morrer. Sem isto, clicar num
             * convite com o app aberto nao faria absolutamente nada.
             *
             * NAO ligue a feature "deep-link" do tauri-plugin-single-instance:
             * ela faz exatamente esta chamada antes do callback, e somada a
             * esta linha o convite seria entregue duas vezes.
             */
            use tauri_plugin_deep_link::DeepLinkExt;
            app.deep_link().handle_cli_arguments(argv.iter());
        }));

        /*
         * Atualizacao dentro do app.
         *
         * O updater baixa o instalador novo, confere a ASSINATURA contra a chave
         * publica em `tauri.conf.json` e so entao executa. A assinatura nao e
         * enfeite: o endereco das atualizacoes e publico, e sem ela bastaria
         * alguem conseguir trocar o arquivo la para rodar codigo em todas as
         * maquinas que tem o app instalado.
         *
         * O `process` vem junto porque e ele que reabre o app depois de
         * instalar (`relaunch`).
         */
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .plugin(locale_do_sistema())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|_app| {
            /*
             * Todo este bloco e so de desktop. `deliver_deep_links` usa
             * `get_webview_window` e `eval`, e o esquema `whatscord://` so e
             * registrado pelo instalador do Windows — no Android o caminho de
             * link seria App Links, que exige assetlinks.json e nao esta feito.
             * Sem esta guarda o build para Android nao compila.
             */
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;

                montar_bandeja(_app)?;

                #[cfg(target_os = "windows")]
                if let Some(janela) = _app.get_webview_window("main") {
                    conceder_midia(&janela);
                }

                let handle = _app.handle().clone();
                _app.deep_link().on_open_url(move |event| {
                    deliver_deep_links(
                        &handle,
                        event.urls().into_iter().map(|u| u.to_string()).collect(),
                    );
                });

                /*
                 * Em desenvolvimento nada registrou o esquema no Windows — quem
                 * faz isso na versao final e o instalador NSIS, a partir de
                 * `plugins.deep-link.desktop.schemes`. Registrar aqui tambem em
                 * release faria uma copia portatil roubar o esquema da instalada.
                 */
                #[cfg(debug_assertions)]
                let _ = _app.deep_link().register_all();

                /*
                 * O caso de abrir o app CLICANDO no link, com ele fechado: a URL
                 * chega como argumento de linha de comando e ninguem a leu ainda.
                 * Precisa vir depois do `on_open_url` acima, que e quem escuta.
                 */
                _app.deep_link().handle_cli_arguments(std::env::args());
            }

            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        // ------------------------------------------------------------------
        // PERMISSOES DE MIDIA (microfone / camera / tela)
        //
        // Na WebView2 o estado padrao de uma permission request e "Default",
        // que a doc da Microsoft define como "the default browser behavior is
        // used, which normally prompts users for decision" -> ou seja, aparece
        // um dialogo pedindo microfone/camera.
        //
        // O Tauri 2.11.5 (estavel hoje) NAO expoe a API de permission handler
        // do wry: o changeset `.changes/permission-handler.md` no repo do Tauri
        // marca isso como `minor:feat`, ou seja, so sai no 2.12.0. Por isso o
        // auto-grant de microfone/camera e feito por flag da WebView2 em
        // `app.windows[0].additionalBrowserArgs` (ver tauri.conf.json).
        //
        // Quando o 2.12 sair, da para trocar a flag por isto aqui:
        //
        // .on_permission_request(|_webview, kind| {
        //     use tauri::webview::{PermissionKind, PermissionResponse};
        //     match kind {
        //         PermissionKind::Microphone | PermissionKind::Camera => {
        //             PermissionResponse::Allow
        //         }
        //         // DisplayCapture nao e emitido pela WebView2: o screen share
        //         // passa pelo evento ScreenCaptureStarting, que ja mostra o
        //         // seletor nativo de tela/janela sem codigo do host.
        //         _ => PermissionResponse::Default,
        //     }
        // })
        // ------------------------------------------------------------------
        .invoke_handler(tauri::generate_handler![get_app_version, set_badge_count])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o WhatsCord");
}
