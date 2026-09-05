import { useState } from "react";
import { useStore } from "../store";

export function Auth() {
  const [mode, setMode] = useState<"in" | "up">("in");
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
      if (mode === "in") {
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
      setError(err instanceof Error ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>WhatsCord</h1>
        <p className="sub">
          {mode === "in" ? "Sign in to pick up where you left off." : "Create an account to get started."}
        </p>

        {error && <div className="form-error">{error}</div>}

        {mode === "in" ? (
          <>
            <div className="field">
              <label htmlFor="identifier">Email or username</label>
              <input id="identifier" value={form.identifier} onChange={set("identifier")} autoFocus autoComplete="username" />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" value={form.password} onChange={set("password")} autoComplete="current-password" />
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="displayName">Your name</label>
              <input id="displayName" value={form.displayName} onChange={set("displayName")} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="username">Username</label>
              <input id="username" value={form.username} onChange={set("username")} placeholder="lowercase, no spaces" autoComplete="username" />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={form.email} onChange={set("email")} autoComplete="email" />
            </div>
            <div className="field">
              <label htmlFor="new-password">Password</label>
              <input id="new-password" type="password" value={form.password} onChange={set("password")} placeholder="at least 8 characters" autoComplete="new-password" />
            </div>
          </>
        )}

        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}
        </button>

        <p className="auth-switch">
          {mode === "in" ? "No account yet? " : "Already have one? "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "in" ? "up" : "in");
              setError(null);
            }}
          >
            {mode === "in" ? "Create one" : "Sign in"}
          </button>
        </p>
      </form>
    </div>
  );
}
