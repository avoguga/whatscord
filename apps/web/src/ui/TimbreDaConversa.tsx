import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { useLingui as useLinguiRuntime } from "@lingui/react";
import {
  TIMBRES,
  playCue,
  salvarTimbreDaSala,
  timbreDaSala,
  type Timbre
} from "../lib/sounds";

/**
 * O som desta conversa.
 *
 * A ideia não é escolher um som bonito: é saber DE ONDE veio sem olhar a tela.
 * Com um timbre por grupo e por pessoa, o trabalho e o time de futebol deixam
 * de soar igual, e dá para ignorar um e atender o outro sem trocar de janela.
 *
 * "Nenhum" é o padrão e significa silêncio para mensagem — um app de grupos que
 * apita a cada mensagem vira um app silenciado. O som existe só onde alguém
 * decidiu que aquela conversa merece ser ouvida.
 */
const NOMES: Record<Timbre, MessageDescriptor> = {
  padrao: msg`Default`,
  agudo: msg`High`,
  grave: msg`Low`,
  arpejo: msg`Chime`,
  mudo: msg`Silent`
};

export function TimbreDaConversa({ roomId, onFeito }: { roomId: string; onFeito: () => void }) {
  const { t } = useLingui();
  const { i18n } = useLinguiRuntime();
  const [atual, setAtual] = useState<Timbre | null>(() => timbreDaSala(roomId));

  function escolher(v: Timbre | null) {
    setAtual(v);
    salvarTimbreDaSala(roomId, v);
    /*
     * Toca na hora da escolha. Sem ouvir, escolher um timbre é escolher uma
     * palavra — e a pessoa só descobriria como soa na próxima mensagem, que é
     * tarde para trocar de ideia.
     */
    if (v && v !== "mudo") void playCue("mensagem", undefined, true, roomId);
  }

  return (
    <div className="timbre-lista">
      <p className="timbre-titulo">
        <Trans>Sound for this conversation</Trans>
      </p>

      <button
        className={`timbre-item${atual === null ? " on" : ""}`}
        onClick={() => escolher(null)}
      >
        <Trans>None</Trans>
        <em>
          <Trans>No sound for messages here</Trans>
        </em>
      </button>

      {TIMBRES.map((v) => (
        <button
          key={v}
          className={`timbre-item${atual === v ? " on" : ""}`}
          onClick={() => escolher(v)}
        >
          {i18n._(NOMES[v])}
        </button>
      ))}

      <button className="timbre-feito" onClick={onFeito}>
        {t`Done`}
      </button>
    </div>
  );
}
