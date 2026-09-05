# LiveKit no Coolify — receita de deploy

Pesquisado e verificado em 05/09/2026 contra as docs oficiais e o fonte do Coolify.
Ainda **não executado** — ver "o que falta validar" no fim.

## A decisão que importa: portas UDP

**Não use a faixa 50000-60000 e não use `network_mode: host`.**

A faixa larga vem do modo clássico, onde cada participante consome duas portas
(10.000 portas ≈ 5.000 participantes). Publicar isso no Docker cria uma regra DNAT
por porta: o `iptables-restore` do dockerd leva minutos, start/stop do container trava
e a memória explode. Num VPS que já roda 105 containers, isso é inaceitável.

O **ICE/UDP mux** resolve pela raiz — todo o tráfego de mídia entra por uma faixa
minúscula. Regra de dimensionamento: **nº de portas ≥ nº de vCPUs** (é sobre
paralelismo de sockets, não sobre capacidade de sala). Com 4 vCPUs: `7882-7885`.
Quatro mapeamentos em vez de dez mil.

`network_mode: host` daria performance máxima, mas no Coolify tira o container da
rede `coolify`, quebra o roteamento do Traefik e expõe a 7880 sem TLS. Só considerar
se medir gargalo real.

## Divisão de tráfego

| Porta | Vai por onde | Por quê |
|---|---|---|
| 7880 signaling | **Traefik** (WSS, TLS) | doc: "should be placed behind a load balancer that can terminate SSL" |
| 7881 ICE/TCP | **direto no host** | doc: "cannot be behind load balancer or TLS, and must be exposed on the node" |
| 7882-7885 UDP mux | **direto no host** | mídia nunca passa por proxy |

## docker-compose.yml

Recurso do tipo Docker Compose no Coolify. Deixe o campo de domínio da UI **vazio** —
os labels abaixo são os mesmos que o Coolify gera (verificado em
`bootstrap/helpers/docker.php`: entrypoints `http`/`https`, certresolver `letsencrypt`,
middleware `redirect-to-https`).

```yaml
services:
  livekit:
    # Fixar a tag depois do 1o deploy:
    #   docker run --rm livekit/livekit-server --version
    image: livekit/livekit-server:latest
    restart: unless-stopped

    # Config via env var é mecanismo oficial — dispensa volume.
    environment:
      LIVEKIT_CONFIG: |
        port: 7880
        log_level: info
        rtc:
          udp_port: 7882-7885
          tcp_port: 7881
          use_external_ip: false
          node_ip: 167.88.39.225
        keys:
          ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
        logging:
          level: info
          pion_level: error
          json: true
          sample: true

    # MÍDIA: direto no host. A 7880 nao aparece aqui de proposito.
    ports:
      - "7881:7881/tcp"
      - "7882-7885:7882-7885/udp"

    networks:
      - coolify

    labels:
      - traefik.enable=true
      - traefik.docker.network=coolify
      - traefik.http.routers.livekit.entryPoints=https
      - traefik.http.routers.livekit.rule=Host(`livekit.167.88.39.225.sslip.io`)
      - traefik.http.routers.livekit.tls=true
      - traefik.http.routers.livekit.tls.certresolver=letsencrypt
      - traefik.http.routers.livekit.service=livekit
      - traefik.http.services.livekit.loadbalancer.server.port=7880
      - traefik.http.routers.livekit-http.entryPoints=http
      - traefik.http.routers.livekit-http.rule=Host(`livekit.167.88.39.225.sslip.io`)
      - traefik.http.routers.livekit-http.middlewares=redirect-to-https
      # NAO adicionar o middleware `gzip` neste router.

    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:7880/"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

networks:
  coolify:
    external: true
```

Secrets no Coolify: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

## Redis: deixar desligado

Habilitar Redis coloca o LiveKit em **modo distribuído**, que só traz ganho com 2+ nós.
Num VPS único é dependência extra sem benefício — e temos 105 containers para não
sobrecarregar. Se algum dia for necessário, usar `db: 3` para isolar das chaves dos
outros apps do servidor.

## node_ip vs use_external_ip

Em rede bridge o container só enxerga 172.x. Como o IP público é fixo, fixamos
`node_ip` e desligamos `use_external_ip` — mais determinístico e evita o self-ping
de validação falhar por hairpin NAT do Docker. Se preferir descoberta automática,
inverta e adicione `skip_external_ip_validation: true`.

**Esta é a falha nº 1 em deploy de LiveKit.** Sintoma: signaling conecta, o participante
entra na sala, mas ninguém vê nem ouve ninguém e o ICE fica em `checking`.

## Traefik e WebSocket

Funciona **sem configuração extra** — WSS é upgrade HTTP/1.1 comum e o Traefik é
construído sobre o `httputil.ReverseProxy` do Go, que trata protocol switching
nativamente. Não existe "enable websocket" como havia no nginx.

Dois cuidados: não aplicar o middleware `gzip` neste router (compressão sobre stream
de signaling é fonte clássica de bug de buffering), e sticky sessions só importam
com 2+ nós.

## Chaves e JWT

```bash
docker run --rm livekit/livekit-server generate-keys
```

Nunca usar `devkey`/`secret` (só existem no modo `--dev`).

O backend assina HS256 com o secret. Payload:

```json
{
  "iss": "APIMmxiL8rquKztZEoZJV9Fb",
  "sub": "user-123",
  "nbf": 1619065263,
  "exp": 1621657263,
  "name": "Gustavo",
  "video": {
    "room": "sala-do-time",
    "roomJoin": true,
    "canPublish": true,
    "canSubscribe": true,
    "canPublishData": true,
    "canPublishSources": ["camera", "microphone", "screen_share", "screen_share_audio"]
  }
}
```

`iss` = API key, `sub` = identity do participante.
**`screen_share_audio` é obrigatório** para o áudio do compartilhamento de tela subir —
sem ele, a tela vai muda. Campos de admin (`roomCreate`, `roomAdmin`, `roomRecord`)
só no token de serviço do backend, nunca no do cliente.

## Testes

```bash
curl -sSL https://get.livekit.io/cli | bash
export LK_URL=wss://livekit.167.88.39.225.sslip.io
export LK_KEY=APIxxxx
export LK_SECRET=xxxx

# 1) Signaling vivo?
curl -i https://livekit.167.88.39.225.sslip.io/

# 2) Upgrade WSS passa pelo Traefik? Espere 101 ou 4xx do LiveKit. 502 = proxy errado.
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://livekit.167.88.39.225.sslip.io/rtc

# 3) Token de teste
lk token create --api-key $LK_KEY --api-secret $LK_SECRET \
  --join --room teste --identity dev1 --valid-for 1h

# 4) Publicar mídia sintética — valida ICE/DTLS ponta a ponta
lk room join --url $LK_URL --api-key $LK_KEY --api-secret $LK_SECRET \
  --identity publisher --publish-demo teste

# 5) Carga leve
lk load-test --url $LK_URL --api-key $LK_KEY --api-secret $LK_SECRET \
  --room teste --video-publishers 3 --subscribers 10 --duration 60s

# 6) UDP realmente aberto? (do desktop)
nc -vzu 167.88.39.225 7882
nc -vz  167.88.39.225 7881
```

**Como saber se caiu para TCP/TURN:** em `chrome://webrtc-internals`, o par de candidatos
selecionado com `protocol: udp` e `candidateType: host/srflx` é o caminho bom;
`protocol: tcp` ou `candidateType: relay` é fallback. Se **todo mundo** cair em `tcp`,
o UDP mux não está acessível — quase sempre firewall ou `node_ip` errado.

## Firewall

```bash
ufw allow 22/tcp
ufw allow 80,443/tcp
ufw allow 8000/tcp          # Coolify — restringir ao seu IP se possível
ufw allow 7881/tcp
ufw allow 7882:7885/udp
ufw reload
```

**Pegadinha:** portas publicadas pelo Docker fazem DNAT na chain `PREROUTING`, antes do
`INPUT` onde o ufw atua. As portas já ficam acessíveis sem essas regras, e o ufw não
consegue fechá-las sem mexer na `DOCKER-USER`. As regras documentam a intenção, mas
não conte com o ufw para bloquear porta publicada por container.

## O que falta validar

Três pontos que o agente marcou como não verificados em execução:

1. **Healthcheck em `/`** — o 200 nessa rota é comportamento observado, não documentado.
   Alternativa citável: `prometheus_port: 6789` e checar `:6789/metrics`.
2. **HS256** — é o que o `livekit-server-sdk` emite, mas a página de tokens não declara
   o algoritmo. Confirmar decodificando o header do primeiro token.
3. **TURN/TLS na porta 5349 via TCP router do Traefik** (fase 2, para redes corporativas
   que bloqueiam UDP) — exige adicionar um entrypoint na config estática do Traefik do
   Coolify. Hipótese a testar, não receita pronta.

Outro risco anotado: `sslip.io` funciona, mas o rate limit do Let's Encrypt é por domínio
registrado e o sslip.io é muito usado — dá para esbarrar em limite compartilhado.
Para produção, domínio próprio.

## Fontes

docs.livekit.io/home/self-hosting/deployment · /ports-firewall · /distributed ·
github.com/livekit/livekit/config-sample.yaml · docs.livekit.io/frontends/reference/tokens-grants ·
coolify.io/docs/knowledge-base/docker/compose · coollabsio/coolify bootstrap/helpers/docker.php ·
doc.traefik.io/traefik (routing/load-balancing/service)
