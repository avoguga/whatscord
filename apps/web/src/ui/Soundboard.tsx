import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { useLingui as useLinguiRuntime } from "@lingui/react";
import {
  ESPERA_MS,
  bandejaSilenciada,
  favoritosDaSala,
  ordenarBandeja,
  salvarBandejaSilenciada,
  salvarFavoritosDaSala,
  type SomId
} from "../lib/soundboard";
import {
  BANDEJA_VAZIA,
  apagarSom,
  carregarBandeja,
  esquecerEndereco,
  prepararSons,
  subirSom,
  type Bandeja,
  type SomDaNuvem
} from "../lib/sonsDaNuvem";

/**
 * Como cada som embutido se chama.
 *
 * Mora aqui, e não junto do catálogo, porque `msg` é um macro: ele só vira
 * texto durante o build. O catálogo precisa continuar sendo um arquivo comum,
 * que roda em Node — é assim que o empacotamento do recado e a ordem da bandeja
 * podem ser testados sem navegador.
 *
 * `Record<SomId, ...>` de propósito: acrescentar um som e esquecer o nome vira
 * erro de compilação, e não um botão sem legenda descoberto por um usuário.
 */
const NOMES: Record<SomId, MessageDescriptor> = {
  tada: msg`Ta-da`,
  buzina: msg`Air horn`,
  erro: msg`Wrong`,
  tambor: msg`Rimshot`,
  sino: msg`Ding`,
  boing: msg`Boing`,
  sussurro: msg`Crickets`,
  fanfarra: msg`Fanfare`
};

/** O que um botão da bandeja precisa, venha ele de onde vier. */
type Botao = {
  chave: string;
  /** O id que viaja no recado: o do embutido, ou o do banco. */
  id: string;
  /** Só para som que alguém subiu. Embutido é sintetizado dos dois lados. */
  url: string | null;
  face: string;
  nome: string;
  /** `null` quando não dá para apagar (embutido, ou não é seu). */
  aoApagar: (() => void) | null;
};

export function Soundboard({
  roomId,
  spaceId,
  onTocar,
  onFechar
}: {
  roomId: string;
  /** `null` numa conversa direta: sem espaço, não há bandeja de espaço. */
  spaceId: string | null;
  onTocar: (id: string, url: string | null) => void;
  onFechar: () => void;
}) {
  const { t } = useLingui();
  const { i18n } = useLinguiRuntime();

  const [favoritos, setFavoritos] = useState<SomId[]>(() => favoritosDaSala(roomId));
  const [esperandoAte, setEsperandoAte] = useState(0);
  const [agora, setAgora] = useState(() => Date.now());
  const [silenciada, setSilenciada] = useState(() => bandejaSilenciada());

  const [nuvem, setNuvem] = useState<Bandeja>(BANDEJA_VAZIA);
  const [erro, setErro] = useState<string | null>(null);
  const [subindo, setSubindo] = useState(false);
  const escolher = useRef<HTMLInputElement>(null);
  /** Para onde vai o próximo upload: a bandeja do espaço, ou a minha. */
  const [destino, setDestino] = useState<"meus" | "espaco">("meus");

  // Um relógio só enquanto há espera correndo: sem isto o botão ficaria
  // esmaecido até o próximo render acontecer por outro motivo.
  useEffect(() => {
    if (esperandoAte <= agora) return;
    const id = window.setInterval(() => setAgora(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [esperandoAte, agora]);

  /*
   * Os sons subidos chegam quando a bandeja abre, e o arquivo de cada um começa
   * a baixar junto. Esperar o primeiro clique para baixar faria o primeiro toque
   * de cada som chegar atrasado — e um efeito atrasado chega depois da piada.
   */
  useEffect(() => {
    let vivo = true;
    carregarBandeja(spaceId)
      .then((b) => {
        if (!vivo) return;
        setNuvem(b);
        prepararSons([...b.meus, ...b.doEspaco]);
      })
      .catch(() => {
        /*
         * Falhar aqui não pode fechar a bandeja: os oito embutidos continuam
         * funcionando sem rede nenhuma, e são eles que a pessoa veio usar.
         */
        if (vivo) setNuvem(BANDEJA_VAZIA);
      });
    return () => {
      vivo = false;
    };
  }, [spaceId]);

  const esperando = esperandoAte > agora;

  function apertar(id: string, url: string | null) {
    if (esperando) return;
    setEsperandoAte(Date.now() + ESPERA_MS);
    setAgora(Date.now());
    onTocar(id, url);
  }

  function fixar(id: SomId) {
    const novos = favoritos.includes(id)
      ? favoritos.filter((x) => x !== id)
      : [id, ...favoritos].slice(0, 4);
    setFavoritos(novos);
    salvarFavoritosDaSala(roomId, novos);
  }

  async function remover(som: SomDaNuvem) {
    setErro(null);
    try {
      await apagarSom(som.id);
      esquecerEndereco(som.url);
      setNuvem((b) => ({
        ...b,
        meus: b.meus.filter((s) => s.id !== som.id),
        doEspaco: b.doEspaco.filter((s) => s.id !== som.id)
      }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : t`That sound could not be removed.`);
    }
  }

  async function subir(arquivo: File) {
    setErro(null);
    setSubindo(true);
    try {
      /*
       * O nome sai do arquivo, sem a extensão, e é editável depois — perguntar
       * antes transformaria "mandar um som" em um formulário, e ninguém manda um
       * som para preencher formulário.
       */
      const nome = arquivo.name.replace(/\.[^.]+$/, "").slice(0, 24) || "som";
      const som = await subirSom({
        arquivo,
        nome,
        emoji: "🔊",
        spaceId: destino === "espaco" ? spaceId : null
      });
      prepararSons([som]);
      setNuvem((b) =>
        som.escopo === "espaco"
          ? { ...b, doEspaco: [...b.doEspaco, som] }
          : { ...b, meus: [...b.meus, som] }
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : t`That sound could not be added.`);
    } finally {
      setSubindo(false);
      // Sem isto, escolher o MESMO arquivo de novo não dispara `change`.
      if (escolher.current) escolher.current.value = "";
    }
  }

  const embutidos: Botao[] = ordenarBandeja(roomId).map((som) => ({
    chave: `embutido:${som.id}`,
    id: som.id,
    url: null,
    face: som.face,
    nome: i18n._(NOMES[som.id]),
    aoApagar: null
  }));

  const daNuvem = (som: SomDaNuvem): Botao => ({
    chave: `nuvem:${som.id}`,
    id: som.id,
    url: som.url,
    face: som.emoji,
    nome: som.name,
    aoApagar: () => void remover(som)
  });

  const grades: { titulo: string; botoes: Botao[]; vazio?: string }[] = [
    ...(spaceId
      ? [
          {
            titulo: t`This space`,
            botoes: nuvem.doEspaco.map(daNuvem),
            vazio: t`No sounds here yet. Admins can add up to ${nuvem.limites.porEspaco}.`
          }
        ]
      : []),
    {
      titulo: t`Yours`,
      botoes: nuvem.meus.map(daNuvem),
      vazio: t`Sounds you add travel with you into any call.`
    },
    { titulo: t`Built in`, botoes: embutidos }
  ];

  return (
    <div className="quick-menu quick-menu-wide soundboard" role="dialog" aria-label={t`Soundboard`}>
      <p className="quick-head">
        <Trans>Soundboard</Trans>
      </p>

      <div className="soundboard-rolagem">
        {grades.map((grade) => (
          <div key={grade.titulo} className="soundboard-grupo">
            <p className="soundboard-titulo">{grade.titulo}</p>
            {grade.botoes.length === 0 ? (
              <p className="soundboard-vazio">{grade.vazio}</p>
            ) : (
              <div className="soundboard-grade">
                {grade.botoes.map((b) => (
                  <div key={b.chave} className="soundboard-slot">
                    <button
                      className={`soundboard-som${
                        favoritos.includes(b.id as SomId) ? " fixado" : ""
                      }`}
                      disabled={esperando || subindo}
                      onClick={() => apertar(b.id, b.url)}
                      onContextMenu={(e) => {
                        // Fixar só vale para os embutidos: os outros já vêm
                        // agrupados pelo dono, que é uma ordem mais forte.
                        if (!b.url) {
                          e.preventDefault();
                          fixar(b.id as SomId);
                        }
                      }}
                      title={b.nome}
                      aria-label={b.nome}
                    >
                      <span aria-hidden="true">{b.face}</span>
                      <em>{b.nome}</em>
                    </button>
                    {b.aoApagar && (
                      <button
                        className="soundboard-apagar"
                        onClick={b.aoApagar}
                        title={t`Remove this sound`}
                        aria-label={t`Remove ${b.nome}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {erro && <p className="soundboard-erro">{erro}</p>}

      {/*
        Adicionar.
        -------------------------------------------------------------------
        O seletor de destino só aparece quando HÁ destino para escolher: numa
        conversa direta não existe espaço, e uma opção que não leva a lugar
        nenhum só faz a pessoa se perguntar o que ela faz.
      */}
      <div className="soundboard-adicionar">
        {spaceId && (
          <div className="soundboard-destino" role="group" aria-label={t`Where the sound goes`}>
            <button
              className={destino === "meus" ? "on" : ""}
              onClick={() => setDestino("meus")}
              aria-pressed={destino === "meus"}
            >
              <Trans>Mine</Trans>
            </button>
            <button
              className={destino === "espaco" ? "on" : ""}
              onClick={() => setDestino("espaco")}
              aria-pressed={destino === "espaco"}
            >
              <Trans>This space</Trans>
            </button>
          </div>
        )}
        <input
          ref={escolher}
          type="file"
          accept="audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,.mp3,.ogg,.wav,.webm,.m4a"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void subir(f);
          }}
        />
        <button
          className="quick-full"
          disabled={subindo}
          onClick={() => escolher.current?.click()}
        >
          {subindo ? t`Adding…` : t`Add a sound…`}
        </button>
        <p className="soundboard-limite">
          <Trans>Up to {Math.round(nuvem.limites.bytes / 1024)} KB, so it plays instantly.</Trans>
        </p>
      </div>

      <p className="soundboard-nota">
        <Trans>Everyone in the call hears it. Right-click a built-in sound to pin it.</Trans>
      </p>

      {/*
        Silenciar fica DENTRO da bandeja, ao lado dos sons.
        -----------------------------------------------------------------
        Quem quer calar os efeitos procura onde eles estão, nao num painel de
        configuracoes tres cliques adiante. E o proprio interruptor explica que
        o que voce mesmo apertar continua tocando — sem isso a pessoa aperta um
        som, nao ouve nada e conclui que a bandeja quebrou.
      */}
      <label className="soundboard-silencio">
        <input
          type="checkbox"
          checked={silenciada}
          onChange={(e) => {
            setSilenciada(e.target.checked);
            salvarBandejaSilenciada(e.target.checked);
          }}
        />
        <span>
          <Trans>Mute sounds other people play (yours still play)</Trans>
        </span>
      </label>

      <button className="quick-full" onClick={onFechar}>
        <Trans>Done</Trans>
      </button>
    </div>
  );
}
