# WhatsCord — decisões de arquitetura

Base: 10 agentes de pesquisa, 05/09/2026. Fontes nos relatórios citados ao longo.

## Fechado

| Peça | Decisão | Por quê |
|---|---|---|
| Plataforma v1 | **Windows only** | Decisão do cliente. É o que torna o Tauri barato. |
| Shell desktop | **Tauri v2** | Com Windows-only, `getDisplayMedia` funciona direto na webview do WebView2 (Chromium). Custo de screen share ≈ zero. |
| Mídia | **LiveKit self-hosted** | Binário único, Apache-2.0, TURN embutido, screen share como track separado (1080p30 @ 5 Mbps). Rota de fuga paga sem trocar código. |
| UI do cliente | **React 19 + TS + Vite** | Ecossistema. Espelho: Signal Desktop é React 19 + `@tanstack/react-virtual` + SQLCipher. |
| Lista de mensagens | **TanStack Virtual** | Idem Signal. |
| Dados/sync | **Postgres + WebSocket + SQLite local + outbox idempotente** | Chat é log append-only ordenado. Sync engine não se paga. |
| Cursor de sync | **`GET /sync?since=<seq>` por conversa** | Modelo do Simplified Sliding Sync do Matrix. |
| E2EE | **Não na v1** | libsignal é AGPL-only; MLS custa meses. Caminho futuro: `matrix-sdk-crypto` (Apache-2.0). |
| Arquivos | **Volume local ao lado da API** | Escolha original era MinIO; ele nao subiu neste host (ver `operacao.md`). O driver em `lib/storage.ts` aceita S3 tambem — definir as variaveis S3_* troca sem mexer em mais nada. |

## Rejeitado, com motivo

**Stack completa do Stoat neste VPS** — 16 containers sem `mem_limit`, MongoDB dimensionando cache
WiredTiger por RAM do host, RabbitMQ com watermark de 40% do host, e um Caddy que duplica o Traefik.
A máquina já tem 105 containers de outros projetos. Risco de OOM neles, não em nós.
*O Stoat em si passou na due diligence* — voz/vídeo/screenshare funcionam self-hosted (LiveKit v1.9.13
no compose deles desde fev/2026), API tem 87 rotas / 131 operações, `Channel.joinCall()` devolve
URL+token do LiveKit. Se um dia houver VPS separada, a rota é válida.

**Sync engines** — Zero 1.0 não faz escrita offline (matador para "não perder mensagem quando cai a
rede"); Electric foi comprada pela Databricks em ago/2026 e virou foco de IA; InstantDB foi acqui-hired
pela OpenAI e encerra em 2027; Replicache virou closed-source na v10. PowerSync é o único que eu
consideraria, mas o SDK Tauri é alpha sobre Rust SDK pre-alpha.

**CRDTs (Automerge, Yjs, Jazz, Evolu)** — ferramenta errada. Ninguém edita a mesma mensagem
concorrentemente.

**Matrix (tuwunel / continuwuity / Synapse)** — tuwunel é tecnicamente o mais elegante (Apache-2.0,
1 binário + RocksDB, patrocínio estatal, MatrixRTC já é LiveKit). Rejeitado pelo modelo de dados:
DAG de eventos e state resolution para uma UI estilo Discord é atrito grande, "servidor com canais"
vira Spaces + Rooms na mão, e não foi possível confirmar suporte a Simplified Sliding Sync — sem
isso o sync inicial de um cliente novo dói.

**Rocket.Chat** (replica set MongoDB de 3 nós, ~8 GiB de baseline) · **Zulip** (quer a máquina
inteira; modelo é stream+topic, não canais) · **Mattermost** (fonte AGPL ou licença comercial) ·
**Appwrite** (realtime não faz fan-out server-side) · **PocketBase** (sem presence, sem canal
cliente→servidor) · **SimpleX / Nostr** (sem contas / sem grupo durável) · **Spacebar** (API do
Discord, mas em "Development" e com WebRTC próprio que conflita com LiveKit) ·
**Bun/Elysia** (vazamentos de memória documentados em produção em 2026).

## A armadilha de infra que quase pegamos

Todo tutorial de LiveKit manda abrir `50000-60000/udp`. São ~10.000 mapeamentos DNAT no Docker —
o `iptables-restore` do dockerd leva minutos, start/stop de container trava, memória explode.
Numa máquina com 105 containers isso derruba os vizinhos.

**Solução: ICE/UDP mux.** `udp_port: 7882` (ou faixa pequena dimensionada por vCPU, não por
participante). O próprio Stoat já reduziu para 50000-50100 — ainda são 100 mapeamentos, ainda demais.

`network_mode: host` (recomendado pela doc do LiveKit) **não** serve no Coolify: issue #10099 aberta
relata a flag sendo descartada em silêncio, e o container sai da rede do Traefik.

Receita completa em `livekit-coolify.md`.

## Aberto

1. **Linguagem do backend** — ver a discussão abaixo.
2. **Áudio do sistema** no screen share (o som do que está na tela, não só o microfone). Não vem de
   graça em nenhum caminho; o próprio Hopp não faz. Trabalho não estimado.
3. Rodar o checklist de diagnóstico no VPS antes de subir qualquer coisa (exige SSH — a API do
   Coolify não executa comandos).

## Sobre a linguagem do backend

O que o backend precisa fazer é pequeno: auth, CRUD de salas e mensagens, fan-out por WebSocket,
assinar upload no R2, e minar token do LiveKit. A mídia toda é do LiveKit.

Argumento específico deste ambiente contra Rust: **o Coolify buildar no mesmo servidor**. Cada deploy
de Rust custa minutos de CPU numa máquina que já divide recursos com 105 containers. Não é teoria —
é o custo recorrente de cada push.

A survey de 2025 aponta tempo de compilação como principal limitador de produtividade em Rust
(satisfação 6/10). Para dev solo com prazo, foi apontado como o pior risco das opções.

Node/TS compartilha tipos com o cliente React. Go é o meio-termo e é a mesma linguagem do LiveKit.
Elixir traz Channels/PubSub/Presence prontos (dispensaria o Redis) ao custo de 3-6 meses de rampa.
