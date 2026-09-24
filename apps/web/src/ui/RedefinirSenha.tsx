import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useStore } from "../store";
import { redefinirSenha } from "../lib/senha";

/**
 * A tela que o link do e-mail abre: escolher a senha nova.
 *
 * Aparece antes de qualquer outra coisa, com ou sem sessão — quem clicou no
 * link veio para isto. E pede a senha DUAS vezes: aqui não existe "entrar e
 * conferir" antes de a senha valer; um erro de digitação trancaria a pessoa
 * fora da própria conta logo depois de ela recuperar o acesso.
 */
export function RedefinirSenha({ token, onFim }: { token: string; onFim: () => void }) {
  const { t } = useLingui();
  const entrar = useStore((s) => s.entrarComSessao);
  const notify = useStore((s) => s.notify);
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const curta = senha.length > 0 && senha.length < 8;
  const diferente = confirma.length > 0 && confirma !== senha;
  const pode = senha.length >= 8 && confirma === senha && !ocupado;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!pode) return;
    setOcupado(true);
    setErro(null);
    try {
      const sessao = await redefinirSenha(token, senha);
      await entrar(sessao);
      notify(t`Password changed. You're in.`);
      onFim();
    } catch (err) {
      setErro(err instanceof Error ? err.message : t`That did not work. Try again.`);
      setOcupado(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={enviar}>
        <h1>WhatsCord</h1>
        <p className="sub">
          <Trans>Choose a new password.</Trans>
        </p>

        {erro && <div className="form-error">{erro}</div>}

        <div className="field">
          <label htmlFor="reset-senha">
            <Trans>New password</Trans>
          </label>
          <input
            id="reset-senha"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder={t`at least 8 characters`}
            autoComplete="new-password"
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="reset-confirma">
            <Trans>Type it again</Trans>
          </label>
          <input
            id="reset-confirma"
            type="password"
            value={confirma}
            onChange={(e) => setConfirma(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        {curta && (
          <p className="auth-hint">
            <Trans>Use at least 8 characters.</Trans>
          </p>
        )}
        {!curta && diferente && (
          <p className="auth-hint">
            <Trans>The two passwords don't match.</Trans>
          </p>
        )}

        <button className="btn-primary" type="submit" disabled={!pode}>
          {ocupado ? <Trans>One moment…</Trans> : <Trans>Save and sign in</Trans>}
        </button>

        <p className="auth-switch">
          <button type="button" onClick={onFim}>
            <Trans>Back to sign in</Trans>
          </button>
        </p>
      </form>
    </div>
  );
}
