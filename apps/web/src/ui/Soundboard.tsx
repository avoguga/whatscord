import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { useLingui as useLinguiRuntime } from "@lingui/react";
import {
  ESPERA_MS,
  favoritosDaSala,
  ordenarBandeja,
  salvarFavoritosDaSala,
  type SomId
} from "../lib/soundboard";

/**
 * Como cada som se chama.
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

/**
 * A bandeja de sons, dentro da chamada.
 *
 * Apertar um botão toca para todo mundo. A espera entre um som e outro não é
 * detalhe de implementação: sem ela a bandeja vira uma arma — alguém segura o
 * botão e ninguém mais consegue conversar. Ela aparece como o botão esmaecendo,
 * porque um botão que não responde e não explica parece quebrado.
 *
 * Clique com o botão direito fixa o som no começo da bandeja, e isso é a parte
 * "por grupo": o time de trabalho e o grupo dos amigos não usam os mesmos
 * efeitos, e caçar o mesmo som no meio de oito toda vez é o atrito que mata a
 * funcionalidade.
 */
export function Soundboard({
  roomId,
  onTocar,
  onFechar
}: {
  roomId: string;
  onTocar: (id: SomId) => void;
  onFechar: () => void;
}) {
  const { t } = useLingui();
  const { i18n } = useLinguiRuntime();

  const [favoritos, setFavoritos] = useState<SomId[]>(() => favoritosDaSala(roomId));
  const [esperandoAte, setEsperandoAte] = useState(0);
  const [agora, setAgora] = useState(() => Date.now());

  // Um relógio só enquanto há espera correndo: sem isto o botão ficaria
  // esmaecido até o próximo render acontecer por outro motivo.
  useEffect(() => {
    if (esperandoAte <= agora) return;
    const id = window.setInterval(() => setAgora(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [esperandoAte, agora]);

  const esperando = esperandoAte > agora;
  const bandeja = ordenarBandeja(roomId);

  function apertar(id: SomId) {
    if (esperando) return;
    setEsperandoAte(Date.now() + ESPERA_MS);
    setAgora(Date.now());
    onTocar(id);
  }

  function fixar(id: SomId) {
    const novos = favoritos.includes(id)
      ? favoritos.filter((x) => x !== id)
      : [id, ...favoritos].slice(0, 4);
    setFavoritos(novos);
    salvarFavoritosDaSala(roomId, novos);
  }

  return (
    <div className="quick-menu quick-menu-wide soundboard" role="dialog" aria-label={t`Soundboard`}>
      <p className="quick-head">
        <Trans>Soundboard</Trans>
      </p>

      <div className="soundboard-grade">
        {bandeja.map((som) => {
          const nome = i18n._(NOMES[som.id]);
          return (
          <button
            key={som.id}
            className={`soundboard-som${favoritos.includes(som.id) ? " fixado" : ""}`}
            disabled={esperando}
            onClick={() => apertar(som.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              fixar(som.id);
            }}
            title={nome}
            aria-label={nome}
          >
            <span aria-hidden="true">{som.face}</span>
            <em>{nome}</em>
          </button>
          );
        })}
      </div>

      <p className="soundboard-nota">
        <Trans>Everyone in the call hears it. Right-click to pin a sound to the front.</Trans>
      </p>

      <button className="quick-full" onClick={onFechar}>
        <Trans>Done</Trans>
      </button>
    </div>
  );
}
