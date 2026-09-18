import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { useStore } from "../store";
import { Avatar } from "./Avatar";
import { Scrim } from "./Scrim";
import { IconAoVivo, IconClose } from "./icons";
import {
  criarTransmissao,
  entrarNoAr,
  type Transmissao,
  type Visibilidade
} from "../lib/transmissoes";

/*
 * A tela de início arrasta o `livekit-client` junto, pelo mesmo motivo que a
 * tela de chamada: é de longe a maior dependência do app. Quem só veio ler
 * mensagem não pode pagar por ela.
 */
const TelaDaTransmissao = lazy(() =>
  import("./Transmissao").then((m) => ({ default: m.TelaDaTransmissao }))
);

/**
 * A tela de início: o que está no ar agora.
 *
 * Mostra o que a pessoa PODE ver, e isso é decidido no servidor — uma
 * transmissão por link nunca entra nesta lista, nem para quem tem o código, ou o
 * código deixaria de ser segredo no instante em que alguém abrisse o app.
 */
export function Home() {
  const { t } = useLingui();
  const transmissoes = useStore((s) => s.transmissoes);
  const aoVivo = useStore((s) => s.aoVivo);
  const abrindo = useStore((s) => s.abrindoTransmissao);
  const refresh = useStore((s) => s.refreshTransmissoes);
  const abrir = useStore((s) => s.abrirTransmissao);
  const notify = useStore((s) => s.notify);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /*
   * Relê de tempos em tempos. Entrar no ar é um evento de outra pessoa, em outro
   * computador — sem isto, a tela só mudaria quando alguém a reabrisse, e uma
   * vitrine que não se atualiza sozinha parece quebrada.
   *
   * Trinta segundos, e não três: a consulta pergunta a presença de cada
   * transmissão, e a única coisa que muda entre uma leitura e outra é um número.
   */
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (aoVivo) {
    return (
      <Suspense
        fallback={
          <div className="home">
            <p className="home-vazio">
              <Trans>Opening the broadcast…</Trans>
            </p>
          </div>
        }
      >
        <TelaDaTransmissao />
      </Suspense>
    );
  }

  async function assistirEsta(qual: Transmissao) {
    setErro(null);
    try {
      await abrir(qual.id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : t`That broadcast could not be opened.`);
    }
  }

  return (
    <main className="home">
      <header className="home-top">
        <div>
          <h2>
            <Trans>Live now</Trans>
          </h2>
          <span>
            {transmissoes.length === 0 ? (
              <Trans>Nobody is broadcasting right now.</Trans>
            ) : (
              plural(transmissoes.length, {
                one: "# broadcast going on",
                other: "# broadcasts going on"
              })
            )}
          </span>
        </div>
        <button className="btn-ghost" onClick={() => setCriando(true)}>
          <IconAoVivo size={17} />
          <Trans>Go live</Trans>
        </button>
      </header>

      {erro && <div className="form-error">{erro}</div>}

      {transmissoes.length === 0 ? (
        <div className="home-vazio">
          <p>
            <Trans>
              When someone starts a broadcast you can see, it shows up here. Yours can be open to
              everyone, kept to one space, or shared by a secret link.
            </Trans>
          </p>
        </div>
      ) : (
        <div className="home-grade">
          {transmissoes.map((tr) => (
            <button
              key={tr.id}
              className="live-card"
              disabled={abrindo}
              onClick={() => void assistirEsta(tr)}
            >
              <div className="live-card-palco">
                {/*
                  Sem miniatura de propósito, por enquanto: os arquivos que
                  servimos são públicos por endereço, então a prévia de uma
                  transmissão privada ficaria ao alcance de quem tivesse a URL.
                */}
                <IconAoVivo size={34} />
                <span className="live-tag">
                  <Trans>LIVE</Trans>
                </span>
              </div>
              <div className="live-card-pe">
                <Avatar
                  name={tr.owner?.displayName ?? ""}
                  url={tr.owner?.avatarUrl ?? null}
                  size={34}
                />
                <div>
                  <strong>{tr.title}</strong>
                  <span>
                    {tr.owner?.displayName} ·{" "}
                    {plural(tr.assistindo, { one: "# watching", other: "# watching" })}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {criando && (
        <ModalDeTransmissao
          onClose={() => setCriando(false)}
          onPronto={async (tr) => {
            setCriando(false);
            notify(t`You are live.`);
            await abrir(tr.id);
            void refresh();
          }}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------- começar a transmitir */

function ModalDeTransmissao({
  onClose,
  onPronto
}: {
  onClose: () => void;
  onPronto: (t: Transmissao) => Promise<void>;
}) {
  const { t } = useLingui();
  const spaces = useStore((s) => s.spaces);
  const [titulo, setTitulo] = useState("");
  const [quem, setQuem] = useState<Visibilidade>("PUBLIC");
  const [spaceId, setSpaceId] = useState<string>(spaces[0]?.id ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => campo.current?.focus(), []);

  async function comecar() {
    const limpo = titulo.trim();
    if (!limpo) return;
    setOcupado(true);
    setErro(null);
    try {
      const criada = await criarTransmissao({
        title: limpo,
        visibility: quem,
        spaceId: quem === "SPACE" ? spaceId : null
      });
      /*
       * Criar e entrar no ar são dois passos no servidor de propósito — dá para
       * preparar uma transmissão e só depois abrir —, mas aqui vão juntos: quem
       * apertou "transmitir" quer transmitir, não preencher um cadastro.
       */
      await entrarNoAr(criada.id);
      await onPronto(criada);
    } catch (e) {
      setErro(e instanceof Error ? e.message : t`The broadcast could not be started.`);
      setOcupado(false);
    }
  }

  const semEspaco = quem === "SPACE" && !spaceId;

  return (
    <Scrim onClose={onClose}>
      <header>
        <Trans>Go live</Trans>
      </header>
      <div className="modal-body">
        {erro && <div className="form-error">{erro}</div>}

        <div className="field">
          <label htmlFor="live-title">
            <Trans>What are you showing?</Trans>
          </label>
          <input
            id="live-title"
            ref={campo}
            value={titulo}
            maxLength={80}
            placeholder={t`Ranked with the crew`}
            onChange={(e) => setTitulo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !ocupado && void comecar()}
          />
        </div>

        <p className="section-label" style={{ padding: 0, marginBottom: 8 }}>
          <Trans>Who can watch</Trans>
        </p>
        <div className="live-escolha">
          <button className="chip" aria-pressed={quem === "PUBLIC"} onClick={() => setQuem("PUBLIC")}>
            <Trans>Anyone here</Trans>
          </button>
          <button
            className="chip"
            aria-pressed={quem === "SPACE"}
            disabled={spaces.length === 0}
            onClick={() => setQuem("SPACE")}
          >
            <Trans>One space</Trans>
          </button>
          <button className="chip" aria-pressed={quem === "LINK"} onClick={() => setQuem("LINK")}>
            <Trans>Secret link</Trans>
          </button>
        </div>

        {quem === "PUBLIC" && (
          <p className="settings-note">
            <Trans>Everyone with a WhatsCord account sees it on their Live now screen.</Trans>
          </p>
        )}
        {quem === "LINK" && (
          <p className="settings-note">
            <Trans>
              It never shows up on anyone's Live now screen. Only people you send the link to can
              open it — you get the link once the broadcast starts.
            </Trans>
          </p>
        )}
        {quem === "SPACE" && (
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="live-space">
              <Trans>Which space</Trans>
            </label>
            <select
              id="live-space"
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              style={{
                width: "100%",
                background: "var(--input)",
                border: "1px solid transparent",
                borderRadius: 8,
                padding: "10px 12px",
                color: "var(--text)",
                outline: "none"
              }}
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>
          <Trans>Cancel</Trans>
        </button>
        <button
          className="btn-ghost"
          disabled={ocupado || !titulo.trim() || semEspaco}
          onClick={() => void comecar()}
        >
          {ocupado ? <Trans>Starting…</Trans> : <Trans>Start</Trans>}
        </button>
      </footer>
    </Scrim>
  );
}

/** O X de fechar, reaproveitado pela tela de transmissão. */
export function BotaoFechar({ onClick, rotulo }: { onClick: () => void; rotulo: string }) {
  return (
    <button className="icon-btn" onClick={onClick} title={rotulo} aria-label={rotulo}>
      <IconClose size={18} />
    </button>
  );
}
