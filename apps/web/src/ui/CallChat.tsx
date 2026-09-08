import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useStore } from "../store";
import { clock } from "../lib/format";
import { Avatar } from "./Avatar";
import { IconClose, IconSend } from "./icons";

/**
 * A conversa do canal, ao lado da chamada.
 *
 * Antes disto, chamada e conversa se excluíam: a chamada é uma folha que cobre
 * a tela inteira, e ler o que alguém escreveu exigia minimizá-la — o que troca
 * o vídeo por uma tarja. Quem está apresentando não pode fazer isso, e é
 * justamente quem mais recebe "não estou ouvindo" por escrito.
 *
 * É um painel e não a tela de conversa inteira: aqui não cabe cabeçalho, busca,
 * nem menu. O que precisa caber é ler as últimas mensagens e responder em uma
 * linha, sem tirar os olhos de quem fala.
 *
 * Não reaproveita `Chat.tsx` de propósito: aquele componente traz cabeçalho,
 * busca, respostas, anexos e menu, e nada disso cabe numa coluna de 320px ao
 * lado de um vídeo. O que se lê aqui e o que se lê lá é a mesma lista do store,
 * então as duas telas não divergem.
 */
export function CallChat({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { t } = useLingui();
  const me = useStore((s) => s.me);
  const mensagens = useStore((s) => s.messages[roomId]);
  const abrir = useStore((s) => s.openRoom);
  const enviar = useStore((s) => s.send);

  const [texto, setTexto] = useState("");
  const fim = useRef<HTMLDivElement>(null);

  /*
   * A conversa pode nunca ter sido aberta nesta sessão — entrar num canal de
   * voz direto pelo rail não carrega mensagem nenhuma. Sem isto, o painel
   * abriria vazio numa sala cheia de histórico.
   *
   * `openRoom` também marca este canal como o ativo, e isso é efeito colateral
   * assumido: ao fechar a chamada a pessoa fica exatamente no canal que estava
   * lendo, que é para onde ela ia querer ir de qualquer forma. Também zera o
   * contador de não lidas, o que é honesto — ela está lendo.
   */
  useEffect(() => {
    if (!mensagens) void abrir(roomId);
  }, [roomId, mensagens, abrir]);

  // Sempre no fim: aqui ninguém está lendo histórico, está acompanhando.
  useLayoutEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [mensagens?.length]);

  const lista = mensagens ?? [];

  async function mandar() {
    const conteudo = texto.trim();
    if (!conteudo) return;
    setTexto("");
    await enviar(roomId, conteudo, []);
  }

  return (
    <aside className="call-chat" aria-label={t`Channel chat`}>
      <header>
        <strong>
          <Trans>Chat</Trans>
        </strong>
        <button className="icon-btn" onClick={onClose} aria-label={t`Close the chat`}>
          <IconClose size={18} />
        </button>
      </header>

      <div className="call-chat-list">
        {lista.length === 0 && (
          <p className="call-chat-empty">
            <Trans>Nothing written here yet.</Trans>
          </p>
        )}
        {lista.map((m) => (
          <div key={m.clientMsgId ?? m.id} className={`call-chat-msg${m.author.id === me?.id ? " mine" : ""}`}>
            <Avatar name={m.author.displayName} url={m.author.avatarUrl} size={26} />
            <div>
              <span className="call-chat-quem">
                {m.author.displayName} <em>{clock(m.createdAt)}</em>
              </span>
              <span className="call-chat-texto">
                {m.deleted ? <em>{t`This message was deleted`}</em> : m.content}
              </span>
            </div>
          </div>
        ))}
        <div ref={fim} />
      </div>

      <form
        className="call-chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void mandar();
        }}
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={t`Write to the channel`}
          aria-label={t`Write to the channel`}
        />
        <button type="submit" disabled={!texto.trim()} aria-label={t`Send`}>
          <IconSend size={18} />
        </button>
      </form>
    </aside>
  );
}
