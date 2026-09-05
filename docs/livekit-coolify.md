# LiveKit no Coolify — receita de deploy

Validado em execução em 05/09/2026, com cliente externo conectando pela internet:
9/9 tracks, 11 mbps agregados, 0,353% de perda, 0 erros (3 publicadores x 3
assinantes). Também validado o caminho real do app — token emitido pela API,
assinatura HS256 conferida, mídia na sala que a API criou: 0% de perda.

## Correção importante

A primeira versão deste documento dizia "**não use `network_mode: host`**" e
recomendava bridge com portas publicadas. **Estava errado, e foi a causa raiz de
todas as chamadas falharem.** A recomendação vinha de pesquisa de documentação
sem execução; o que se mediu depois contradiz.

A doc oficial do LiveKit diz o contrário, textualmente:

> "If running in a Dockerized environment, host networking should be used for
> optimal performance."
> — docs.livekit.io/home/self-hosting/deployment

## A causa raiz (medida, não suposta)

Em modo bridge o sintoma era: signaling conecta, participante entra na sala,
e nenhum par ICE se forma. Nos logs, 3730 ocorrências de
`Failed to ping without candidate pairs` em 100% das sessões.

O que a investigação por SSH mostrou, em ordem:

| Verificação | Resultado |
|---|---|
| Firewall do host e do provedor | limpo — ufw inativo, INPUT ACCEPT, sem regra bloqueando |
| UDP externo chegando na eth0 | **sim** — 739 pacotes numa única tentativa |
| conntrack | 764 de 262144, sem descarte |
| DNAT e regra de FORWARD | corretas, apontando para o IP certo |
| Resposta saindo da eth0 | **zero pacotes** |
| Captura dentro do netns do container | **zero pacotes** do cliente chegando |
| LiveKit testado de dentro da VPS, pela URL pública | funcionava, 1.2 mbps, 0% de perda |

O mecanismo: **o LiveKit não escuta em `0.0.0.0` — ele abre um socket por
interface de rede, no boot.** E o Coolify anexa todo Service a **duas** redes:
a do projeto (nomeada com o UUID do recurso) e a rede `coolify`. O pacote do
cliente entrava por uma interface e a resposta ICE saía pelo socket da outra,
morrendo dentro do container antes de chegar na eth0 do host.

Confirmado por `netstat` dentro do container:

```
udp  172.18.0.16:7882   1/livekit-server     <- rede coolify (alvo do DNAT)
udp  172.24.0.2:7882    1/livekit-server     <- rede do projeto
```

### Por que não dá para consertar isso no compose

Três becos sem saída, todos testados:

1. **Declarar uma rede só no compose não adianta.** O Coolify anexa a rede
   `coolify` *por fora* do compose (por causa do label `traefik.docker.network`).
   O arquivo gerado em `/data/coolify/services/<uuid>/docker-compose.yml` declara
   só a rede do UUID, e mesmo assim o container sobe com as duas.
2. **`rtc.interfaces.includes: [eth0]` não adianta.** O Docker troca qual rede é
   `eth0` a cada redeploy — num deploy `eth0` era `172.18.x`, no seguinte era
   `172.24.x`. Nome de interface não é estável.
3. **`rtc.ips.includes` deixou o servidor sem nenhum socket UDP.** O formato
   estava certo — `IPsConfig` aceita CIDR mesmo (confirmado em
   `mediatransportutil/pkg/rtcconfig/config.go`; é `interfaces` que vai por nome).
   Mas com `ips.includes: 172.18.0.0/16` o `ss -lun` dentro do container não
   mostrava **nenhum** socket UDP em 7882-7885 — nem na interface que casava com
   o filtro. Só o resolver do Docker em `127.0.0.11`. TCP 7880/7881 normais.
   Sem socket UDP não há candidato a oferecer, e daí os 3730
   `without candidate pairs`. Não determinei por que o bind não acontece;
   possivelmente relacionado ao issue livekit#4437 (filtros de IP ignorados
   a partir da v1.10, corrigido no PR #4440).

   **Não use filtro de IP aqui sem testar o bind primeiro** (`ss -lun` dentro do
   container). Com `node_ip` + `use_external_ip: false` o servidor já anuncia só
   o IP público — o filtro não é necessário.

A saída é `network_mode: host`: o Coolify **para de injetar o bloco `networks:`**
quando `network_mode` está definido (coollabsio/coolify PR #6235, mergeado).
Sem bridge não há DNAT, nem `docker-proxy`, nem socket por interface.

## O custo: o Traefik perde o roteamento por label

Sem rede, o provider Docker do Traefik não consegue descobrir o container. O
roteamento HTTPS passa a ser por **arquivo dinâmico**, que o Traefik do Coolify
já suporta (`--providers.file.directory=/traefik/dynamic/` com `watch=true`).

O arquivo vive em `/data/coolify/proxy/dynamic/` — **fora do controle do Coolify
e fora deste repositório**. Se o proxy for recriado, precisa ser reposto. A cópia
canônica está em `infra/traefik-livekit.yml`.

O endereço `172.17.0.1` é a gateway do `docker0`: o Traefik roda em container e
alcança por ali o serviço que escuta no host. Não é invenção — o mesmo padrão já
estava em uso nesta VPS em `srs-stream.yml`.

## Divisão de tráfego

| Porta | Vai por onde | Por quê |
|---|---|---|
| 7880 signaling | **Traefik** (WSS, TLS) | doc: "should be placed behind a load balancer that can terminate SSL" |
| 7881 ICE/TCP | direto no host | doc: "cannot be behind load balancer or TLS, and must be exposed on the node" |
| 7882-7885 UDP mux | direto no host | mídia nunca passa por proxy |

Mux com 4 portas, uma por vCPU. O `config-sample.yaml` oficial: "we recommend
using a range of ports greater or equal to the number of vCPUs on the machine".
No mux as portas não escalam com participantes (vários compartilham o mesmo
socket, demultiplexado pelo ICE) — escalam com paralelismo de CPU. Esta máquina
tem 4 vCPUs, logo `7882-7885`.

Não confundir com `port_range_start/end`: **aquele** é o modo clássico, onde cada
participante consome portas dedicadas, e por isso a doc de VM usa 50000-60000.
Quatro portas ali seriam absurdamente pouco; quatro portas de mux são o correto.

Em host networking ampliar o mux não custa nada — não há uma regra DNAT por
porta, que era a preocupação válida do modo bridge.

## docker-compose.yml

```yaml
services:
  livekit:
    image: livekit/livekit-server:v1.13.6
    restart: unless-stopped
    network_mode: host
    mem_limit: 1g
    mem_reservation: 128m
    cpus: 1.5
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
    labels:
      - traefik.enable=false
```

Sem `ports:` (host networking não publica nada) e sem `networks:`.
`traefik.enable=false` porque o roteamento agora é por arquivo.

## Roteamento no Traefik

`/data/coolify/proxy/dynamic/whatscord-livekit.yml` — ver `infra/traefik-livekit.yml`.
O Traefik recarrega sozinho (`watch=true`), não precisa reiniciar o proxy.

## node_ip vs use_external_ip

Com host networking o IP público está direto na `eth0`, então o LiveKit
enxergaria o IP certo sozinho. Mantemos `node_ip` fixo e `use_external_ip: false`
mesmo assim: é determinístico e evita o self-ping de validação por STUN.

O que se mede em host networking: o LiveKit **liga socket em toda interface** —
o IP público, um IPv6, e as oito gateways de bridge do Docker (`172.17.0.1` até
`172.25.0.1`, uma por projeto do Coolify):

```
UNCONN  172.17.0.1:7882     livekit-server
UNCONN  172.18.0.1:7882     livekit-server
...
UNCONN  167.88.39.225:7882  livekit-server
```

Os sockets de bridge são inúteis, mas inofensivos: com `advertiseInternalIP=false`
no log de boot, o servidor **anuncia** só `167.88.39.225`. É o desperdício descrito
no issue livekit#4437. A limpeza óbvia seria `ips.excludes`, mas ver o beco sem
saída nº 3 acima antes de tentar: filtro de IP nesta máquina zerou o bind de UDP.

## Efeito colateral a saber

Em host networking a **porta 7880 fica acessível direto no IP público, sem TLS**
(`http://167.88.39.225:7880`). O signaling continua sendo servido por HTTPS via
Traefik, mas a porta crua também responde. Fechar exige regra de firewall no
host — e cuidado: portas publicadas por container fazem DNAT no `PREROUTING`,
antes do `INPUT` onde o ufw atua, então ufw sozinho não fecha porta de container
(neste caso, como não há publicação de porta, uma regra de `INPUT` funciona).

## Redis: deixar desligado

Habilitar Redis coloca o LiveKit em modo distribuído, que só traz ganho com 2+
nós. Num VPS único é dependência extra sem benefício. Se um dia for necessário,
usar `db: 3` para isolar das chaves dos outros apps do servidor.

## Traefik e WebSocket

Funciona sem configuração extra — WSS é upgrade HTTP/1.1 comum e o Traefik é
construído sobre o `httputil.ReverseProxy` do Go, que trata protocol switching
nativamente. Não aplicar o middleware `gzip` neste router (compressão sobre
stream de signaling é fonte clássica de bug de buffering).

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
**`screen_share_audio` é obrigatório** para o áudio do compartilhamento de tela
subir — sem ele, a tela vai muda. Campos de admin (`roomCreate`, `roomAdmin`,
`roomRecord`) só no token de serviço do backend, nunca no do cliente.

## Testes

```bash
curl -sSL https://get.livekit.io/cli | bash
export LK_URL=wss://livekit.167.88.39.225.sslip.io

# Signaling vivo através do Traefik
curl -i https://livekit.167.88.39.225.sslip.io/

# O teste que vale: mídia real ponta a ponta, rodado de FORA da VPS.
# Rodar de dentro da VPS não prova nada — passava mesmo com tudo quebrado.
lk load-test --url $LK_URL --api-key $LK_KEY --api-secret $LK_SECRET \
  --room teste --video-publishers 2 --subscribers 2 --duration 20s
```

Sucesso é ver a tabela de tracks com bitrate e perda baixa. `could not connect
after timeout` é falha de ICE.

### Como diagnosticar de novo, se voltar

A sequência que funcionou, em ordem de decisão:

```bash
# 1) O pacote do cliente chega no host?
tcpdump -n -i eth0 'udp port 7882'
# 2) O servidor responde alguma coisa? (filtre por IP, NAO por porta --
#    se a resposta sair pela bridge errada ela vai mascarada com outra porta)
tcpdump -n -i eth0 "host <ip-do-cliente>"
# 3) O pacote chega DENTRO do container?
nsenter -t $(docker inspect -f '{{.State.Pid}}' <cid>) -n tcpdump -n -i any udp
# 4) Em quais enderecos o livekit tem socket?
docker exec <cid> netstat -lun | grep 788
# 5) Pares ICE se formaram?
docker logs <cid> 2>&1 | grep -c 'without candidate pairs'
```

**Cuidado de método:** `tcpdump ... &` com `nohup` morre junto com o canal SSH e
devolve 0 pacotes — um falso negativo que aqui levou à conclusão errada de que o
provedor bloqueava UDP. Segure o canal aberto (thread com paramiko) ou use
`timeout N tcpdump` em foreground.

## O que ainda não foi validado

1. **Healthcheck em `/`** — o 200 nessa rota é comportamento observado, não
   documentado. Alternativa: `prometheus_port: 6789` e checar `:6789/metrics`.
2. **TURN/TLS na 5349** (para redes corporativas que bloqueiam UDP) — exige
   entrypoint novo na config estática do Traefik do Coolify. Não testado.
3. **`sslip.io`** funciona, mas o rate limit do Let's Encrypt é por domínio
   registrado e o sslip.io é muito usado. Para produção, domínio próprio.

## Fontes

docs.livekit.io/home/self-hosting/deployment · /ports-firewall ·
github.com/livekit/livekit/config-sample.yaml ·
docs.livekit.io/frontends/reference/tokens-grants ·
coolify.io/docs/knowledge-base/docker/compose ·
github.com/coollabsio/coolify/pull/6235 (não injeta `networks:` com `network_mode`) ·
github.com/coollabsio/coolify/issues/11371 (`connect_to_docker_network` ignorado em compose) ·
github.com/coollabsio/coolify/pull/9594 (Jitsi: UDP precisa de `ports`, não `expose`) ·
doc.traefik.io/traefik (providers/file)
