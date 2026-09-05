# Operação — o que está no ar e como mexer

Servidor: `167.88.39.225`, Coolify v4.3.17, projeto **Ideias**, ambiente **production**.
Esse host roda ~105 containers de outros projetos. **Todo recurso do WhatsCord tem
limite explícito de RAM e CPU** — nenhum dos outros tem, e é a única proteção contra
o OOM killer escolher a vítima errada.

## Recursos

| Recurso | UUID | Estado | Limites |
|---|---|---|---|
| `whatscord-db` (Postgres 16) | `amsrkhgnfipvjuuhibtabcmh` | rodando | 1 GB / 1.0 vCPU |
| `whatscord-redis` | `yi9sanupks2eogho038xc3ux` | rodando | 512 MB / 0.5 vCPU, `maxmemory 384mb` + `allkeys-lru` |
| `whatscord-livekit` | `hw6pnl5q8trsftjmvbztx9jb` | rodando | 1 GB / 1.5 vCPU |
| `whatscord-api` | `wk62aoxzoqblzeivwxzrleqx` | rodando | 768 MB / 1.0 vCPU |
| `whatscord-minio` | `ucuirutn6mdrgybquzuwpwct` | **parado** | ver "MinIO" abaixo |

Endereços:

- API: `https://api.whatscord.167.88.39.225.sslip.io` — `/health` responde o estado real
  (`{"ok":true,"storage":"local","calls":true,"realtimeScaling":true}`)
- LiveKit: `wss://livekit.167.88.39.225.sslip.io` (signaling), TCP 7881 e UDP 7882-7885 direto no host

Segredos gerados ficam em `.secrets/generated.env`, que está no `.gitignore`.
As mesmas chaves estão nas variáveis de ambiente do Coolify.

## Armadilhas que já custaram deploy

Cada uma abaixo aconteceu de verdade neste servidor.

**1. `NODE_ENV=production` quebra o build.** O Coolify injeta as variáveis da aplicação
também no build, e o npm pula `devDependencies` quando vê isso — some o `typescript`
e os `@types`, e o `tsc` falha. O `docker/api.Dockerfile` força `ENV NODE_ENV=development`
no estágio de build por causa disso.

**2. O HEALTHCHECK precisa estar na imagem.** Em build por Dockerfile o Coolify lê
`.State.Health.Status` do container e **não** injeta probe próprio. Sem `HEALTHCHECK`
no Dockerfile, o `docker inspect` retorna estado vazio e o rolling update aborta com
"Health check failed". E o `node:alpine` não tem `curl` nem `wget` — por isso o
Dockerfile instala `curl`.

**3. `connect_to_docker_network` não funciona para serviços compose.** Setar a flag
via API e redeployar não adiciona a rede `coolify` ao compose gerado. Foi o que
impediu a API de resolver o hostname do MinIO. Bancos do Coolify já nascem na rede
`coolify` — por isso o Postgres funcionava e o MinIO não.

**4. A API do Coolify tem convenções próprias:**
- `redis_conf` e `docker_compose_raw` precisam vir em **base64**.
- Restart e stop são **POST**, não GET.
- O endpoint de logs quer o nome do serviço no compose (`minio`), não o nome do
  container (`minio-<uuid>`).
- Não existe `POST /applications/dockercompose`; compose customizado vai em `POST /services`.
- Não existe template one-click de MinIO nem de LiveKit nesta instância (342 tipos).
- Volume persistente para aplicação vai em `custom_docker_run_options`
  (`-v whatscord-uploads:/data/uploads`); o endpoint `/storages` só aceita file mounts.

**5. `--console-address` mata o MinIO em silêncio.** A MinIO removeu o console web da
edição community; a flag virou inválida e o processo sai **antes de inicializar o
logger**, então o container reinicia para sempre sem escrever uma linha de log.

**6. A tag `v1.9.13` do LiveKit não existe.** Esse número vem da imagem própria do
Stoat (`ghcr.io/stoatchat/livekit-server`). No Docker Hub oficial a última é `v1.13.6`.

## MinIO: por que está parado

O plano era MinIO para anexos. Ele entrou em loop de crash sem escrever log mesmo
com a configuração mínima, e o problema 3 acima significa que a API não resolveria
o hostname dele de qualquer jeito. Somando o fato de a MinIO ter parado de publicar
no Docker Hub depois de **2025-09-07**, parei de insistir.

**Os anexos hoje vão para um volume persistente ao lado da API** (`whatscord-uploads`
montado em `/data/uploads`), atrás da mesma interface em `apps/api/src/lib/storage.ts`.
Upload, download e mensagem com anexo estão testados e funcionando.

**Para voltar a S3 depois** (MinIO em VPS separada, Cloudflare R2, o que for): basta
definir `S3_ENDPOINT`, `S3_ACCESS_KEY` e `S3_SECRET_KEY` nas variáveis da API. O driver
troca sozinho e nenhum outro arquivo muda — os downloads continuam sendo proxy da API
nos dois casos. R2 é a opção com melhor custo (egress zero) e não compete por disco
com os outros 105 containers.

## Ajuste de host pendente

O LiveKit loga no boot:

```
UDP receive buffer is too small for a production set-up  current=425984 suggested=5000000
```

Corrigir exige root no servidor (não dá pela API do Coolify):

```bash
sysctl -w net.core.rmem_max=7500000
sysctl -w net.core.wmem_max=7500000
# para persistir:
echo -e "net.core.rmem_max=7500000\nnet.core.wmem_max=7500000" >> /etc/sysctl.conf
```

Sem isso a chamada funciona, mas perde pacote sob carga.

## Verificar que está tudo de pé

```bash
# API
curl https://api.whatscord.167.88.39.225.sslip.io/health

# LiveKit (espera 200 e o corpo "OK")
curl -i https://livekit.167.88.39.225.sslip.io/

# UDP do LiveKit realmente aberto
nc -vzu 167.88.39.225 7882
nc -vz  167.88.39.225 7881
```

Um teste ponta a ponta (registrar, abrir DM, mandar mensagem, subir e baixar arquivo,
reagir, pegar token do LiveKit) está no histórico da sessão e pode ser repetido com
qualquer cliente HTTP.
