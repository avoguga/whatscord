import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  definirInicializacao,
  inicializacaoPossivelAqui,
  lerInicializacao,
  type EstadoDaInicializacao
} from "../lib/inicializacao";
import { IconClose } from "./icons";

/**
 * Abrir com o Windows: o aviso de uma vez só e a seção nas Configurações.
 *
 * O recurso nasce LIGADO — é o que Discord e Teams fazem, e é o que faz um app
 * de conversa servir para receber mensagem sem a pessoa lembrar de abri-lo. Mas
 * ligar algo por alguém sem contar é o que dá má fama ao padrão. Por isso o
 * aviso existe, aparece uma única vez, e já oferece desligar ali mesmo.
 */

/* ------------------------------------------------------------------ aviso */

export function AvisoDeInicializacao() {
  const { t } = useLingui();
  const [estado, setEstado] = useState<EstadoDaInicializacao | null>(null);
  const [fechado, setFechado] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void lerInicializacao().then((e) => {
      if (vivo) setEstado(e);
    });
    return () => {
      vivo = false;
    };
  }, []);

  if (!estado?.ligadaAgoraPorPadrao || fechado) return null;

  async function desligar() {
    setOcupado(true);
    try {
      await definirInicializacao(false);
    } catch {
      /* se falhar, a seção nas Configurações mostra o estado real */
    }
    setFechado(true);
  }

  return (
    <div className="update-notice" role="status" aria-live="polite">
      <div className="update-notice-text">
        <strong>
          <Trans>WhatsCord now opens when Windows starts</Trans>
        </strong>
        <small>
          <Trans>It starts in the tray, near the clock — no window in your way. You can change this in Settings.</Trans>
        </small>
        <div className="update-actions">
          <button className="btn-link" onClick={() => setFechado(true)}>
            <Trans>Got it</Trans>
          </button>
          <button className="btn-link" disabled={ocupado} onClick={() => void desligar()}>
            <Trans>Turn off</Trans>
          </button>
        </div>
      </div>
      <button
        className="update-notice-close"
        onClick={() => setFechado(true)}
        title={t`Close`}
        aria-label={t`Close`}
      >
        <IconClose size={15} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------ em Configurações */

export function SecaoInicializacao() {
  const [estado, setEstado] = useState<EstadoDaInicializacao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    void lerInicializacao().then((e) => {
      if (vivo) setEstado(e);
    });
    return () => {
      vivo = false;
    };
  }, []);

  if (!inicializacaoPossivelAqui || !estado?.disponivel) return null;

  async function alternar(ligar: boolean) {
    setOcupado(true);
    setFalhou(false);
    try {
      // O estado REAL depois, e não o pedido: uma política do Windows pode
      // impedir, e o interruptor não pode mentir.
      const real = await definirInicializacao(ligar);
      setEstado((e) => (e ? { ...e, ligada: real, ligadaAgoraPorPadrao: false } : e));
      if (real !== ligar) setFalhou(true);
    } catch {
      setFalhou(true);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <h4 className="settings-head">
        <Trans>Windows startup</Trans>
      </h4>
      <label className="device-toggle update-auto">
        <input
          type="checkbox"
          checked={estado.ligada}
          disabled={ocupado}
          onChange={(e) => void alternar(e.target.checked)}
        />
        <span>
          <Trans>Open WhatsCord when Windows starts</Trans>
          <small>
            <Trans>
              It starts in the tray, near the clock, so you get messages without having to remember to open it. No
              window pops up in your way.
            </Trans>
          </small>
        </span>
      </label>
      {/*
        A pessoa pode ter desligado pelo próprio Windows (Gerenciador de
        Tarefas, ou Configurações > Aplicativos > Inicialização). O interruptor
        mostra isso como desligado, e religar aqui vale — é a vontade mais
        recente. Dizer isso evita a sensação de que o app "ignorou" o sistema.
      */}
      {!estado.ligada && (
        <p className="settings-note">
          <Trans>If you turned it off in Windows' Task Manager, turning it on here brings it back.</Trans>
        </p>
      )}
      {falhou && (
        <div className="form-error">
          <Trans>Windows did not allow this change. A company policy on this computer may be blocking it.</Trans>
        </div>
      )}
    </>
  );
}
