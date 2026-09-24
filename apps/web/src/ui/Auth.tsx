import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useStore } from "../store";
import { peekPendingInvite } from "../lib/deeplink";
import { pedirLinkDeSenha } from "../lib/senha";

export function Auth() {
  const { t, i18n } = useLingui();
  const [mode, setMode] = useState<"in" | "up" | "esqueci">("in");
  /** Já pediu o link: a tela troca o formulário pela confirmação. */
  const [linkPedido, setLinkPedido] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    identifier: "",
    password: "",
    email: "",
    username: "",
    displayName: ""
  });

  const signIn = useStore((s) => s.signIn);
  const signUp = useStore((s) => s.signUp);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "esqueci") {
        // O e-mail sai na língua em que a pessoa está usando o app.
        await pedirLinkDeSenha(form.email.trim(), (i18n.locale || "pt").slice(0, 2));
        setLinkPedido(true);
      } else if (mode === "in") {
        await signIn(form.identifier.trim(), form.password);
      } else {
        await signUp({
          email: form.email.trim(),
          username: form.username.trim().toLowerCase(),
          displayName: form.displayName.trim() || form.username.trim(),
          password: form.password
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t`That did not work. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  /*
   * "Esqueci a senha", na mesma cartela do login.
   *
   * A confirmação diz "se houver uma conta" — e não "mandamos" — porque o
   * servidor responde igual exista ou não a conta. Afirmar que mandou seria
   * mentir para quem digitou um e-mail errado; dizer que não achou seria contar
   * a qualquer um quem tem conta aqui.
   */
  if (mode === "esqueci") {
    return (
      <div className="auth">
        <form className="auth-card" onSubmit={submit}>
          <h1>WhatsCord</h1>
          {linkPedido ? (
            <>
              <p className="sub">
                <Trans>Check your email.</Trans>
              </p>
              <div className="auth-invite">
                <Trans>
                  If there is an account with that email, a link to choose a new password is on its
                  way. It works for 30 minutes. Look in the spam folder too.
                </Trans>
              </div>
            </>
          ) : (
            <>
              <p className="sub">
                <Trans>Type the email of your account and we'll send you a link to choose a new password.</Trans>
              </p>
              {error && <div className="form-error">{error}</div>}
              <div className="field">
                <label htmlFor="forgot-email">
                  <Trans>Email</Trans>
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  autoComplete="email"
                  autoFocus
                />
              </div>
              <button className="btn-primary" type="submit" disabled={busy || !form.email.trim()}>
                {busy ? <Trans>One moment…</Trans> : <Trans>Send the link</Trans>}
              </button>
            </>
          )}
          <p className="auth-switch">
            <button
              type="button"
              onClick={() => {
                setMode("in");
                setLinkPedido(false);
                setError(null);
              }}
            >
              <Trans>Back to sign in</Trans>
            </button>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>WhatsCord</h1>
        <p className="sub">
          {mode === "in" ? (
            <Trans>Sign in to pick up where you left off.</Trans>
          ) : (
            <Trans>Create an account to get started.</Trans>
          )}
        </p>

        {/* Quem chegou por um link de convite precisa saber que ele não se
            perdeu no login — senão parece que o link simplesmente não fez nada. */}
        {peekPendingInvite() && (
          <div className="auth-invite">
            {/*
              Frase inteira em cada ramo, e não costurada de pedaços: em
              espanhol e português a ordem das palavras muda, e um pedaço solto
              no meio impede o tradutor de reordenar.
            */}
            {mode === "in" ? (
              <Trans>You were invited to a space. Sign in and you will be taken straight in.</Trans>
            ) : (
              <Trans>
                You were invited to a space. Create your account and you will be taken straight in.
              </Trans>
            )}
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        {mode === "in" ? (
          <>
            <div className="field">
              <label htmlFor="identifier"><Trans>Email or username</Trans></label>
              <input id="identifier" value={form.identifier} onChange={set("identifier")} autoFocus autoComplete="username" />
            </div>
            <div className="field">
              <label htmlFor="password"><Trans>Password</Trans></label>
              <input id="password" type="password" value={form.password} onChange={set("password")} autoComplete="current-password" />
            </div>
            <button
              type="button"
              className="auth-forgot"
              onClick={() => {
                // Leva o que já foi digitado, se parecer um e-mail.
                if (form.identifier.includes("@")) setForm({ ...form, email: form.identifier.trim() });
                setMode("esqueci");
                setError(null);
              }}
            >
              <Trans>Forgot your password?</Trans>
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="displayName"><Trans>Your name</Trans></label>
              <input id="displayName" value={form.displayName} onChange={set("displayName")} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="username"><Trans>Username</Trans></label>
              <input id="username" value={form.username} onChange={set("username")} placeholder={t`lowercase, no spaces`} autoComplete="username" />
            </div>
            <div className="field">
              <label htmlFor="email"><Trans>Email</Trans></label>
              <input id="email" type="email" value={form.email} onChange={set("email")} autoComplete="email" />
            </div>
            <div className="field">
              <label htmlFor="new-password"><Trans>Password</Trans></label>
              <input id="new-password" type="password" value={form.password} onChange={set("password")} placeholder={t`at least 8 characters`} autoComplete="new-password" />
            </div>
          </>
        )}

        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? (
            <Trans>One moment…</Trans>
          ) : mode === "in" ? (
            <Trans>Sign in</Trans>
          ) : (
            <Trans>Create account</Trans>
          )}
        </button>

        <p className="auth-switch">
          {mode === "in" ? <Trans>No account yet? </Trans> : <Trans>Already have one? </Trans>}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "in" ? "up" : "in");
              setError(null);
            }}
          >
            {mode === "in" ? <Trans>Create one</Trans> : <Trans>Sign in</Trans>}
          </button>
        </p>
      </form>
    </div>
  );
}
