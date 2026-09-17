; Ganchos do instalador NSIS do WhatsCord.
;
; ATENCAO ao $UpdateMode. O instalador novo chama o DESINSTALADOR antigo com
; /UPDATE a cada atualizacao (installer.nsi do Tauri, linha 357 na 2.11.4). Sem a
; checagem abaixo, toda atualizacao apagaria a inicializacao com o Windows — em
; silencio, e a pessoa acharia que o recurso parou de funcionar sozinho.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; Desinstalacao de verdade: nao deixar o Windows tentando abrir um
    ; executavel que nao existe mais, nem uma entrada fantasma no Gerenciador
    ; de Tarefas. O nome tem de bater com NOME em src/inicializacao.rs.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WhatsCord"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "WhatsCord"
  ${EndIf}
!macroend
