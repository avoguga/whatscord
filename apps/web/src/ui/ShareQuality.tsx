import { Trans, useLingui } from "@lingui/react/macro";
import {
  RESOLUCOES,
  TAXAS,
  bitrateDe,
  type Fps,
  type Qualidade,
  type Resolucao
} from "../lib/screenshare";

/**
 * Resolução e quadros por segundo do compartilhamento de tela.
 *
 * Dois controles separados, e não uma lista de perfis prontos ("texto",
 * "vídeo"), porque era isso que existia e escondia a única coisa que a pessoa
 * queria mudar: a taxa de quadros. Quem reclamou de "poucos FPS" não tinha como
 * descobrir que "texto" queria dizer 15 — o número não aparecia em lugar
 * nenhum, e os dois eixos vinham amarrados um ao outro sem motivo.
 *
 * Mesmo componente na tela de configurações e dentro da chamada: são a mesma
 * decisão, e mantê-la em dois lugares diferentes é como as duas telas começam a
 * divergir.
 */
export function QualidadeDeTela({
  valor,
  onChange,
  compacto
}: {
  valor: Qualidade;
  onChange: (q: Qualidade) => void;
  /** No menu rápido não cabe explicação; nas configurações, cabe. */
  compacto?: boolean;
}) {
  const { t } = useLingui();

  const rotuloRes = (r: Resolucao) => (r === 0 ? t`Source` : `${r}p`);

  return (
    <div className="share-quality">
      <div className="share-row" role="radiogroup" aria-label={t`Resolution`}>
        <span className="share-row-label">
          <Trans>Resolution</Trans>
        </span>
        <div className="share-chips">
          {RESOLUCOES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={valor.resolucao === r}
              className={`share-chip${valor.resolucao === r ? " on" : ""}`}
              onClick={() => onChange({ ...valor, resolucao: r })}
            >
              {rotuloRes(r)}
            </button>
          ))}
        </div>
      </div>

      <div className="share-row" role="radiogroup" aria-label={t`Frames per second`}>
        <span className="share-row-label">
          <Trans>Frames per second</Trans>
        </span>
        <div className="share-chips">
          {TAXAS.map((f: Fps) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={valor.fps === f}
              className={`share-chip${valor.fps === f ? " on" : ""}`}
              onClick={() => onChange({ ...valor, fps: f })}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {!compacto && (
        <p className="share-note">
          {/*
            O número da banda aparece porque é a consequência que a pessoa não
            tem como adivinhar: 1440p a 60 pede quase 10 Mbps de subida, e numa
            conexão doméstica comum isso derruba a chamada inteira. Dizer o
            custo na hora da escolha evita o suporte depois.
          */}
          <Trans>
            About {(bitrateDe(valor) / 1_000_000).toFixed(1)} Mbps of upload. More frames need more
            connection; if the picture stutters, drop to 30.
          </Trans>
        </p>
      )}
    </div>
  );
}
