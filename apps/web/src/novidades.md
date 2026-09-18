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

## 0.2.7

- Sair da chamada tira você da chamada de verdade. Havia casos em que a tela fechava mas a conexão de voz continuava aberta, e quem entrasse no canal depois ainda ouvia o seu microfone.
- Os botões de sair da chamada estavam escritos em inglês.

## 0.2.6

- Correção de texto: o aviso de apagar um espaço dizia "para as 1 pessoas" quando havia só uma pessoa nele.

## 0.2.5

- Dá para mudar o nome do espaço e pôr uma imagem nele. Abra o espaço, em Convite e membros. Antes o nome era escolhido na criação e ficava assim para sempre.
- Os canais do espaço podem ser renomeados e apagados por quem administra, na mesma tela. Apagar um canal leva as mensagens dele junto, e a confirmação avisa antes.
- O dono pode apagar o espaço inteiro. Até agora só dava para sair; um espaço criado por engano ficava na lista de todo mundo para sempre.

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
