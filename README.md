# WhatsCord

Discord's capabilities — spaces, text channels, voice rooms, calls, screen sharing —
wearing WhatsApp's interface. Desktop app for Windows.

```
apps/api        Node 22 · Fastify · Prisma · Socket.IO · LiveKit tokens
apps/web        React 19 · Vite · TypeScript   (the UI, loaded by Tauri)
apps/desktop    Tauri v2 (Rust) shell
infra/          docker-compose for LiveKit and MinIO on Coolify
docs/           architecture decisions and the LiveKit deploy recipe
```

## Why this shape

The research behind every choice is in [`docs/decisoes.md`](docs/decisoes.md), including
what was rejected and why. The short version:

- **LiveKit self-hosted** carries all voice, video and screen sharing. The API only mints
  tokens — media never touches it, so a screen share does not eat the server's bandwidth.
- **No sync engine.** Chat is an append-only ordered log; Postgres plus a WebSocket plus a
  local outbox covers it. Zero has no offline writes, Electric was acquired, InstantDB is
  winding down.
- **Tauri, not Electron**, because the target is Windows only for now — there
  `getDisplayMedia` works directly in the WebView2 webview. The day macOS or Linux enters
  scope, screen capture has to move to a native Rust sidecar.
- **No end-to-end encryption in v1.** libsignal is AGPL-only and MLS costs months.

## Running it locally

```bash
npm install

# API — needs Postgres and (optionally) Redis, MinIO and LiveKit
cp apps/api/.env.example apps/api/.env   # then fill it in
npm run dev:api

# UI in the browser
npm run dev:web

# UI in the desktop shell (needs the Rust toolchain)
npm run dev:desktop
```

## Building the Windows app

```bash
npm run dist:desktop
```

Produces an NSIS installer under `apps/desktop/src-tauri/target/release/bundle/`.
It is unsigned, so SmartScreen will warn on first run — see `apps/desktop/README.md`.

## Deployment

Everything runs on one Coolify server:

| Resource | What it is |
|---|---|
| `whatscord-db` | Postgres, capped at 1 GB / 1 vCPU |
| `whatscord-redis` | Redis for socket fan-out and presence, 512 MB with `maxmemory` |
| `whatscord-minio` | stopped — see `docs/operacao.md`; attachments live on a volume next to the API |
| `whatscord-livekit` | LiveKit SFU, UDP mux on 7882-7885 |
| `whatscord-api` | this repo, `docker/api.Dockerfile` |

Every resource has explicit memory and CPU limits because the host runs a hundred other
containers and none of the rest do.
