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
// Bootstrap
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // O single-instance PRECISA ser o primeiro plugin registrado (doc oficial:
    // "This assures that it runs before other plugins can interfere"). Por isso
    // ele entra aqui, antes do encadeamento dos demais, e nao dentro do setup().
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Segunda instancia: em vez de abrir outra janela, traz a existente
            // para frente (comportamento de Discord/WhatsApp Desktop).
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
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
