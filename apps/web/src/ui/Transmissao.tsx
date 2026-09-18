import { useEffect, useRef, useState } from "react";
import {
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant
} from "livekit-client";
import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { useStore } from "../store";
import { Avatar } from "./Avatar";
import { Chat } from "./Chat";
import { IconAoVivo, IconHangup, IconMic, IconMicOff, IconScreen } from "./icons";
import { getSocket } from "../lib/socket";
import { sairDoAr } from "../lib/transmissoes";
import { linkDaTransmissao } from "../lib/transmissoes";
import { shareOrigin } from "../lib/deeplink";
import {
  QUALIDADE_DE_TRANSMISSAO,
  canShareScreen,
  publishOptionsDeTransmissao,
  restricoesDeTela
} from "../lib/screenshare";

/**
 * Assistir e transmitir.
 *
 * A mesma tela dos dois lados, porque a diferença não está no que se vê e sim no
 * CRACHÁ: o token de quem transmite publica, o de quem assiste não. O servidor
 * decide isso; aqui só se pergunta `souDono` para saber quais botões desenhar.
 *
 * Quem assiste entra no LiveKit como participante ESCONDIDO — é o que impede a
 * tela de quem transmite de tentar desenhar um quadradinho por pessoa na
 * plateia. Por isso a contagem não vem do LiveKit: vem da nossa presença, pelo
 * socket.
 */
export function TelaDaTransmissao() {
  const { t } = useLingui();
  const aoVivo = useStore((s) => s.aoVivo);
  const fechar = useStore((s) => s.fecharTransmissao);
  const notify = useStore((s) => s.notify);
  const refresh = useStore((s) => s.refreshTransmissoes);

  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [estado, setEstado] = useState<"ligando" | "no-ar" | "falhou">("ligando");
  const [erro, setErro] = useState<string | null>(null);
  const [compartilhando, setCompartilhando] = useState(false);
  const [micLigado, setMicLigado] = useState(false);
  const [revisao, setRevisao] = useState(0);
  const [copiado, setCopiado] = useState(false);
  const bump = () => setRevisao((n) => n + 1);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audiosRef = useRef<HTMLDivElement>(null);
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;

  const stream = aoVivo?.stream;
  const como = aoVivo?.como;
  const souDono = stream?.souDono ?? false;

  /*
   * O endereço e o crachá, soltos do objeto que os trouxe.
   *
   * Isto não é preciosismo: o efeito que conecta depende deles, e `aoVivo` é um
   * objeto novo a cada mudança no store — a contagem de quem assiste muda de
   * minuto em minuto. Dependendo do objeto, o efeito desmontava a conexão e
   * montava outra a cada atualização, e como `disconnect` é assíncrono, o
   * `connect` seguinte era abortado pelo anterior. Resultado medido no
   * navegador: "connecting → disconnect" em ciclo, e a tela nunca abria.
   */
  const endereco = como?.modo === "webrtc" ? como.url : null;
  const cracha = como?.modo === "webrtc" ? como.token : null;

  /*
   * A frase de erro por referência: usada uma vez, dentro do efeito, e trazê-la
   * pela dependência faria o efeito reconectar a cada troca de idioma.
   */
  const erroRef = useRef("");
  erroRef.current = t`The broadcast could not be opened.`;

  /* ------------------------------------------------------------- conexão */
  useEffect(() => {
    if (!endereco || !cracha) return;
    let cancelado = false;

    (async () => {
      try {
        room
          .on(RoomEvent.TrackSubscribed, () => bump())
          .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
            track.detach();
            bump();
          })
          .on(RoomEvent.ParticipantConnected, () => bump())
          .on(RoomEvent.ParticipantDisconnected, () => bump())
          .on(RoomEvent.LocalTrackPublished, () => bump())
          .on(RoomEvent.LocalTrackUnpublished, () => bump())
          .on(RoomEvent.Disconnected, () => {
            /*
             * Só sai da tela se ELA CHEGOU A ABRIR.
             *
             * Um `Disconnected` que chega antes da primeira conexão bem-sucedida
             * é falha de conexão, não fim de transmissão — e fechar a tela nele
             * devolve a pessoa para a lista sem dizer o que houve. Foi
             * exatamente o que aconteceu: uma desconexão atrasada, de uma
             * tentativa anterior, fechava a tela que tinha acabado de abrir.
             *
             * Quando ela chega DEPOIS de estar no ar, aí sim é o fim: o servidor
             * derruba a sala inteira quando o dono sai, e é assim que a plateia
             * fica sabendo sem depender de um aviso que pode não chegar.
             */
            setEstado((antes) => {
              if (antes === "no-ar") fecharRef.current();
              return "falhou";
            });
          });

        await room.connect(endereco, cracha);
        if (cancelado) {
          /*
           * A tela fechou enquanto isto conectava. O `disconnect` da limpeza
           * encontrou uma sala ainda não conectada e não teve o que fazer — sem
           * esta linha, a conexão que acabou de subir ficaria aberta para
           * sempre. É o mesmo fantasma que já custou caro nas chamadas.
           */
          void room.disconnect().catch(() => undefined);
          return;
        }
        setEstado("no-ar");
        bump();
      } catch (e) {
        if (cancelado) return;
        setEstado("falhou");
        setErro(e instanceof Error ? e.message : erroRef.current);
      }
    })();

    return () => {
      cancelado = true;
      room.removeAllListeners();
      void room.disconnect().catch(() => undefined);
    };
  }, [endereco, cracha, room]);

  /* ----------------------------------------------- presença de quem assiste */
  useEffect(() => {
    /*
     * O dono não se conta como plateia. "3 assistindo" tem de querer dizer três
     * pessoas assistindo — se quem apresenta entrasse na conta, uma transmissão
     * vazia diria "1 assistindo" e ninguém saberia que está falando sozinho.
     */
    if (!stream || souDono) return;
    const s = getSocket();
    s?.emit("stream:join", { streamId: stream.id });
    return () => {
      s?.emit("stream:leave", { streamId: stream.id });
    };
  }, [stream?.id, souDono]);

  /* ---------------------------------------------------- pendurar as faixas */
  useEffect(() => {
    const el = videoRef.current;
    const caixa = audiosRef.current;
    if (!el || !caixa) return;

    /*
     * Uma faixa de vídeo por vez, e a da TELA ganha da câmera. Numa transmissão
     * o que importa é o que está sendo mostrado; a câmera, quando houver, é
     * acompanhamento — e um palco que troca sozinho entre as duas seria pior do
     * que não ter câmera nenhuma.
     */
    let escolhida: Track | null = null;
    const audios: Track[] = [];

    const considerar = (pub: RemoteTrackPublication) => {
      const track = pub.track;
      if (!track) return;
      if (pub.kind === Track.Kind.Audio) {
        audios.push(track);
        return;
      }
      if (pub.source === Track.Source.ScreenShare) escolhida = track;
      else if (!escolhida) escolhida = track;
    };

    room.remoteParticipants.forEach((p: RemoteParticipant) => {
      (p.trackPublications as Map<string, RemoteTrackPublication>).forEach(considerar);
    });

    // O dono se vê pelo que ele mesmo publicou — o LiveKit não devolve as
    // próprias faixas como remotas.
    if (souDono) {
      const minhaTela = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      if (minhaTela?.track) escolhida = minhaTela.track;
    }

    if (escolhida) (escolhida as Track).attach(el);
    else el.srcObject = null;

    caixa.replaceChildren();
    for (const a of audios) {
      const som = a.attach();
      som.autoplay = true;
      caixa.appendChild(som);
    }

    return () => {
      if (escolhida) (escolhida as Track).detach(el);
      for (const a of audios) a.detach();
    };
  }, [revisao, room, souDono]);

  if (!stream || !como) return null;

  /* ------------------------------------------------------------- ações */

  async function compartilharTela() {
    setErro(null);
    try {
      const q = QUALIDADE_DE_TRANSMISSAO;
      const captura = await navigator.mediaDevices.getDisplayMedia(
        restricoesDeTela(q) as DisplayMediaStreamOptions
      );
      const video = captura.getVideoTracks()[0];
      if (!video) return;
      video.contentHint = "motion";
      await room.localParticipant.publishTrack(video, {
        ...publishOptionsDeTransmissao(q),
        source: Track.Source.ScreenShare
      });
      const audio = captura.getAudioTracks()[0];
      if (audio) {
        await room.localParticipant.publishTrack(audio, { source: Track.Source.ScreenShareAudio });
      }
      video.addEventListener("ended", () => {
        setCompartilhando(false);
        bump();
      });
      setCompartilhando(true);
      bump();
    } catch (e) {
      // Cancelar o seletor do navegador é um "não, obrigado", não um erro.
      if (e instanceof DOMException && e.name === "NotAllowedError") return;
      setErro(e instanceof Error ? e.message : t`The screen could not be shared.`);
    }
  }

  async function alternarMicrofone() {
    try {
      const novo = !micLigado;
      await room.localParticipant.setMicrophoneEnabled(novo);
      setMicLigado(novo);
    } catch {
      setErro(t`No microphone found.`);
    }
  }

  async function encerrar() {
    try {
      await sairDoAr(stream!.id);
      notify(t`Your broadcast has ended.`);
    } catch {
      /* Mesmo se o aviso falhar, sair da tela é o que a pessoa pediu. */
    }
    fechar();
    void refresh();
  }

  const link = stream.inviteCode ? linkDaTransmissao(stream.inviteCode, shareOrigin(window.location.origin)) : null;

  async function copiarLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1800);
    } catch {
      setErro(t`The link could not be copied.`);
    }
  }

  return (
    <main className="live">
      <div className="live-palco">
        <header className="live-top">
          <span className="live-tag">
            <IconAoVivo size={14} />
            <Trans>LIVE</Trans>
          </span>
          <div className="live-top-title">
            <strong>{stream.title}</strong>
            <span>
              {stream.owner?.displayName} ·{" "}
              {plural(stream.assistindo, { one: "# watching", other: "# watching" })}
            </span>
          </div>
          <button className="btn-ghost" onClick={souDono ? () => void encerrar() : fechar}>
            {souDono ? <Trans>End broadcast</Trans> : <Trans>Leave</Trans>}
          </button>
        </header>

        {erro && <div className="form-error">{erro}</div>}

        <div className="live-video">
          <video ref={videoRef} autoPlay playsInline muted={souDono} />
          {estado === "ligando" && (
            <p className="live-aviso">
              <Trans>Connecting…</Trans>
            </p>
          )}
          {estado === "no-ar" && !compartilhando && souDono && (
            <div className="live-aviso">
              <p>
                <Trans>You are live. Nothing is on screen yet.</Trans>
              </p>
              {canShareScreen && (
                <button className="btn-outline" onClick={() => void compartilharTela()}>
                  <IconScreen size={17} />
                  <Trans>Share your screen</Trans>
                </button>
              )}
            </div>
          )}
          {estado === "no-ar" && !souDono && (
            <p className="live-aviso live-aviso-sumindo">
              <Trans>Waiting for the picture…</Trans>
            </p>
          )}
        </div>

        {/* Os sons remotos. Ficam fora do vídeo porque podem ser vários: o
            microfone de quem transmite e o áudio do que está na tela dele. */}
        <div ref={audiosRef} hidden />

        {souDono && (
          <div className="live-controles">
            <button
              className={`call-btn${micLigado ? " on" : " off"}`}
              onClick={() => void alternarMicrofone()}
              title={micLigado ? t`Mute` : t`Talk`}
            >
              {micLigado ? <IconMic /> : <IconMicOff />}
            </button>
            {canShareScreen && (
              <button
                className={`call-btn${compartilhando ? " on" : ""}`}
                onClick={() => void compartilharTela()}
                title={compartilhando ? t`Share a different screen` : t`Share your screen`}
              >
                <IconScreen />
              </button>
            )}
            <button className="call-btn hangup" onClick={() => void encerrar()} title={t`End broadcast`}>
              <IconHangup />
            </button>
          </div>
        )}

        {souDono && link && (
          <div className="live-link">
            <span>
              {stream.visibility === "LINK" ? (
                <Trans>Only people with this link can watch:</Trans>
              ) : (
                <Trans>Send this to bring someone in:</Trans>
              )}
            </span>
            <code>{link}</code>
            <button className="btn-link" onClick={() => void copiarLink()}>
              {copiado ? <Trans>Copied</Trans> : <Trans>Copy</Trans>}
            </button>
          </div>
        )}
      </div>

      {/*
        O bate-papo é a conversa da sala da transmissão — a mesma tela de
        conversa de sempre, sem uma linha nova. Foi o que tornou "transmitir com
        chat" um recurso pequeno em vez de um sistema de mensagens paralelo.
      */}
      <aside className="live-chat">
        <Chat onStartCall={() => undefined} />
      </aside>
    </main>
  );
}

/** Quem está transmitindo, para a lista. Pequeno de propósito. */
export function QuemTransmite({
  nome,
  avatarUrl
}: {
  nome: string;
  avatarUrl: string | null;
}) {
  return <Avatar name={nome} url={avatarUrl} size={30} />;
}
