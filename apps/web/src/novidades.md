# Novidades do WhatsCord

Este arquivo é a fonte das notas de cada versão do app de desktop.

- `scripts/release-desktop.mjs` lê a seção da versão que está sendo publicada e a
  coloca no `latest.json` — é o que aparece no aviso "Reinicie para atualizar".
  Sem seção para a versão, o script se recusa a publicar.
- O app embute este arquivo no build. Depois de atualizar, ele mostra as seções
  das versões que a pessoa ainda não tinha visto, sem depender de rede.

Formato: um `## <versão>` por versão, a mais nova em cima, e um item por linha
começando com `- `. Texto simples, sem HTML — é mostrado como texto. Escreva para
quem usa o app, não para quem programa: o que a pessoa nota de diferente.

## 0.2.4

- O WhatsCord abre sozinho quando o Windows inicia, direto na bandeja, perto do relógio — sem janela na sua frente. Para desligar, vá em Configurações, em Inicialização com o Windows.

## 0.2.3

- Quando uma atualização fica pronta, aparece um aviso para reiniciar, com a lista do que mudou.
- Depois de atualizar sozinho, o WhatsCord mostra o que há de novo — como este aviso.
- As novidades de cada versão também ficam em Configurações, em Atualizações.

## 0.2.2

- Clique na foto de alguém, no topo da conversa ou no painel de membros, para vê-la grande.
- O painel de emoji não corta mais a última coluna.
- Arquivos baixados saem com o nome original, e não com um código.

## 0.2.1

- A atualização instala ao abrir o app, ao sair pela bandeja ou quando ninguém está usando — nunca durante uma chamada.

## 0.2.0

- O WhatsCord passa a se atualizar sozinho. Esta é a última versão que precisa ser instalada à mão.
