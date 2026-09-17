/*!
 * Abrir o WhatsCord quando o Windows inicia.
 *
 * Por que isto NAO usa o `tauri-plugin-autostart`, que existe e e oficial:
 * lido o codigo dele (2.5.1, sobre auto-launch 0.5.0), dois problemas.
 *
 * 1. Grava o caminho SEM ASPAS no registro — `format!("{} {}", caminho, args)`.
 *    Numa maquina com espaco no nome do usuario ("C:\Users\Joao Silva\..."),
 *    isso so funciona porque o Windows tenta os pedacos do caminho um a um ate
 *    achar um executavel. Funciona por sorte, nao por projeto.
 * 2. O `enable()` dele sobrescreve a escolha feita no Gerenciador de Tarefas.
 *    Quem desativou o app la teria a escolha desfeita sem saber.
 *
 * O que fica aqui e pouco: uma linha no `Run` do usuario, e o respeito ao que o
 * Windows registra em `StartupApproved` quando a pessoa desliga pelo sistema.
 */

/** O argumento que faz o app abrir direto na bandeja, sem janela. */
pub const ARG_OCULTO: &str = "--oculto";

/** O nome do valor no registro. Tem de bater com o `hooks.nsh` do instalador. */
#[cfg(windows)]
const NOME: &str = "WhatsCord";
#[cfg(windows)]
const CHAVE_RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const CHAVE_APROVADO: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

/**
 * A linha gravada no registro: caminho ENTRE ASPAS, e o app abre na bandeja.
 *
 * Abrir na bandeja e o que torna a inicializacao automatica aceitavel. Uma
 * janela pulando na frente logo ao ligar o computador e o tipo de coisa que faz
 * a pessoa ir desligar o recurso — e ai ela perde o que ele tem de bom, que e
 * receber mensagem sem lembrar de abrir o app.
 */
pub fn linha_do_registro(executavel: &str) -> String {
    format!("\"{}\" {}", executavel, ARG_OCULTO)
}

/**
 * O que o Windows diz em `StartupApproved\Run` — o interruptor do Gerenciador
 * de Tarefas e de Configuracoes > Aplicativos > Inicializacao.
 *
 * O valor tem 12 bytes. O primeiro com o bit menos significativo LIGADO (0x03,
 * 0x07) quer dizer desativado pela pessoa; desligado (0x02, 0x06), ativado.
 * Sem valor ou com formato estranho, vale o `Run`: e o que o Windows faz.
 */
pub fn aprovado_pelo_windows(bytes: Option<&[u8]>) -> bool {
    match bytes {
        Some(b) if !b.is_empty() => b[0] & 1 == 0,
        _ => true,
    }
}

/** 12 bytes de "ativado": o que o Windows grava quando a pessoa liga pelo sistema. */
#[cfg(windows)]
const APROVADO: [u8; 12] = [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

#[cfg(windows)]
fn executavel() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.display().to_string())
        .map_err(|e| e.to_string())
}

/** Esta ligada DE VERDADE: a linha existe E o Windows nao a desativou. */
#[cfg(windows)]
pub fn ligada() -> bool {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let tem_linha = hkcu
        .open_subkey(CHAVE_RUN)
        .and_then(|k| k.get_value::<String, _>(NOME))
        .is_ok();
    if !tem_linha {
        return false;
    }
    let bruto = hkcu
        .open_subkey(CHAVE_APROVADO)
        .and_then(|k| k.get_raw_value(NOME))
        .ok();
    aprovado_pelo_windows(bruto.as_ref().map(|v| v.bytes.as_slice()))
}

/**
 * Liga. So chamado por pedido explicito da pessoa (ou uma unica vez, na
 * primeira abertura) — por isso aqui e certo marcar tambem o `StartupApproved`
 * como ativado: se ela desativou pelo sistema e agora religou pelo app, a
 * vontade mais recente e esta.
 */
#[cfg(windows)]
pub fn ligar() -> Result<(), String> {
    use winreg::{
        enums::{HKEY_CURRENT_USER, REG_BINARY},
        RegKey, RegValue,
    };
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = hkcu.create_subkey(CHAVE_RUN).map_err(|e| e.to_string())?;
    run.set_value(NOME, &linha_do_registro(&executavel()?))
        .map_err(|e| e.to_string())?;
    if let Ok((aprovado, _)) = hkcu.create_subkey(CHAVE_APROVADO) {
        let _ = aprovado.set_raw_value(
            NOME,
            &RegValue {
                vtype: REG_BINARY,
                bytes: APROVADO.to_vec(),
            },
        );
    }
    Ok(())
}

/** Desliga, e tira tambem a entrada do Gerenciador de Tarefas, para nao sobrar lixo la. */
#[cfg(windows)]
pub fn desligar() -> Result<(), String> {
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_SET_VALUE},
        RegKey,
    };
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(run) = hkcu.open_subkey_with_flags(CHAVE_RUN, KEY_SET_VALUE) {
        match run.delete_value(NOME) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    if let Ok(aprovado) = hkcu.open_subkey_with_flags(CHAVE_APROVADO, KEY_SET_VALUE) {
        let _ = aprovado.delete_value(NOME);
    }
    Ok(())
}

/* ----------------------------------------------------------- o padrao */

#[cfg(windows)]
static PRIMEIRA_VEZ: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/**
 * Liga por padrao UMA vez so, na primeira abertura de uma versao que tem o
 * recurso — e nunca mais decide pela pessoa.
 *
 * O marcador e um arquivo na pasta de configuracao, e nao algo no armazenamento
 * da pagina: limpar os dados do navegador embutido nao pode fazer o app voltar
 * a ligar sozinho algo que a pessoa desligou.
 *
 * So no app INSTALADO (`not(debug_assertions)`): rodando em desenvolvimento o
 * executavel fica em `target\debug`, e ligar ali faria a maquina de quem
 * desenvolve abrir o build de teste toda vez que liga.
 */
#[cfg(all(windows, not(debug_assertions)))]
pub fn decidir_padrao<R: tauri::Runtime>(app: &tauri::App<R>) {
    use tauri::Manager;
    let Ok(pasta) = app.path().app_config_dir() else {
        return;
    };
    let marcador = pasta.join("inicializacao-decidida");
    if marcador.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&pasta);
    if ligar().is_ok() {
        PRIMEIRA_VEZ.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    // Grava o marcador mesmo se ligar falhou: tentar de novo a cada abertura
    // seria insistir contra algo (politica, permissao) que nao vai mudar.
    let _ = std::fs::write(&marcador, b"");
}

#[cfg(not(all(windows, not(debug_assertions))))]
pub fn decidir_padrao<R: tauri::Runtime>(_app: &tauri::App<R>) {}

/* ------------------------------------------------------------ comandos */

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Estado {
    /** O recurso existe nesta plataforma (so Windows, por enquanto). */
    disponivel: bool,
    ligada: bool,
    /** Foi ligada por padrao NESTA abertura — o app avisa a pessoa uma vez. */
    ligada_agora_por_padrao: bool,
}

#[tauri::command]
pub fn inicializacao_estado() -> Estado {
    #[cfg(windows)]
    {
        Estado {
            disponivel: true,
            ligada: ligada(),
            ligada_agora_por_padrao: PRIMEIRA_VEZ.load(std::sync::atomic::Ordering::SeqCst),
        }
    }
    #[cfg(not(windows))]
    {
        Estado {
            disponivel: false,
            ligada: false,
            ligada_agora_por_padrao: false,
        }
    }
}

/** Liga ou desliga, e devolve o estado REAL depois — nao o pedido. */
#[tauri::command]
pub fn inicializacao_definir(ligada: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        if ligada {
            ligar()?;
        } else {
            desligar()?;
        }
        PRIMEIRA_VEZ.store(false, std::sync::atomic::Ordering::SeqCst);
        Ok(self::ligada())
    }
    #[cfg(not(windows))]
    {
        let _ = ligada;
        Err("indisponivel nesta plataforma".into())
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn caminho_com_espaco_vai_entre_aspas() {
        let linha = linha_do_registro(r"C:\Users\Joao Silva\AppData\Local\WhatsCord\whatscord-desktop.exe");
        assert_eq!(
            linha,
            r#""C:\Users\Joao Silva\AppData\Local\WhatsCord\whatscord-desktop.exe" --oculto"#
        );
    }

    #[test]
    fn abre_na_bandeja() {
        assert!(linha_do_registro(r"C:\x.exe").ends_with(" --oculto"));
    }

    #[test]
    fn sem_valor_do_windows_vale_o_run() {
        assert!(aprovado_pelo_windows(None));
        assert!(aprovado_pelo_windows(Some(&[])));
    }

    #[test]
    fn ativado_pelo_windows() {
        assert!(aprovado_pelo_windows(Some(&[0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
        assert!(aprovado_pelo_windows(Some(&[0x06, 0, 0, 0])));
    }

    /**
     * Contra o registro DE VERDADE desta maquina. Ignorado por padrao porque
     * escreve em HKCU; rode com `cargo test --lib inicializacao -- --ignored`.
     * Limpa tudo o que cria, inclusive se uma asserção falhar no meio.
     */
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn registro_de_verdade() {
        use winreg::{enums::*, RegKey, RegValue};
        struct Limpa;
        impl Drop for Limpa {
            fn drop(&mut self) {
                let _ = desligar();
            }
        }
        let _limpa = Limpa;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let _ = desligar();
        assert!(!ligada(), "comecou ligada: sobrou algo de antes");

        ligar().expect("ligar");
        assert!(ligada(), "ligar nao ligou");
        let gravado: String = hkcu.open_subkey(CHAVE_RUN).unwrap().get_value(NOME).unwrap();
        assert!(gravado.starts_with('"'), "caminho sem aspas: {gravado}");
        assert!(gravado.ends_with("\" --oculto"), "sem --oculto: {gravado}");
        let aprovado = hkcu.open_subkey(CHAVE_APROVADO).unwrap().get_raw_value(NOME).unwrap();
        assert_eq!(aprovado.bytes, APROVADO.to_vec(), "StartupApproved nao ficou como ativado");

        // A pessoa desativa pelo Gerenciador de Tarefas: o Windows grava 0x03 + data.
        let (chave, _) = hkcu.create_subkey(CHAVE_APROVADO).unwrap();
        chave
            .set_raw_value(
                NOME,
                &RegValue {
                    vtype: REG_BINARY,
                    bytes: vec![0x03, 0, 0, 0, 0x10, 0x5c, 0x4a, 0x2e, 0x9b, 0x28, 0xdb, 0x01],
                },
            )
            .unwrap();
        assert!(!ligada(), "ignorou a escolha feita no Gerenciador de Tarefas");

        desligar().expect("desligar");
        assert!(!ligada());
        assert!(hkcu.open_subkey(CHAVE_RUN).unwrap().get_value::<String, _>(NOME).is_err(), "sobrou a linha no Run");
        assert!(hkcu.open_subkey(CHAVE_APROVADO).unwrap().get_raw_value(NOME).is_err(), "sobrou lixo no StartupApproved");
        assert!(desligar().is_ok(), "desligar duas vezes nao pode dar erro");
    }

    #[test]
    fn desativado_pela_pessoa_no_gerenciador_de_tarefas() {
        // 0x03 + a data em que foi desativado (FILETIME), como o Windows grava.
        assert!(!aprovado_pelo_windows(Some(&[0x03, 0, 0, 0, 0x10, 0x5c, 0x4a, 0x2e, 0x9b, 0x28, 0xdb, 0x01])));
        assert!(!aprovado_pelo_windows(Some(&[0x07, 0, 0, 0])));
    }
}
