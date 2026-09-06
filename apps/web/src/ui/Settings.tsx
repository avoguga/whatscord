import { useRef, useState } from "react";
import { api, uploadFile } from "../lib/api";
import { useStore, type User } from "../store";
import { ImageError, squareThumbnail } from "../lib/image";
import { Avatar } from "./Avatar";
import { Scrim } from "./Scrim";
import { DevicePicker } from "./DevicePicker";

/**
 * The account panel the rail's avatar and gear both open.
 *
 * Signing out used to live in an unlabelled popover hanging off the avatar,
 * and the gear next to it did nothing — so the two most account-shaped buttons
 * in the app were one dead end and one hidden menu.
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me);
  const signOut = useStore((s) => s.signOut);
  const notify = useStore((s) => s.notify);

  const [displayName, setDisplayName] = useState(me?.displayName ?? "");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Troca a foto de perfil.
   *
   * Reduz para um quadrado de 256 px ANTES de subir. O upload é genérico e não
   * redimensiona nada — sem isso, uma foto de 4 MB do celular seria baixada
   * inteira em cada linha da lista de conversas.
   */
  async function trocarFoto(file: File) {
    setEnviandoFoto(true);
    setError(null);
    try {
      const pequena = await squareThumbnail(file);
      const enviado = await uploadFile(pequena);
      const res = await api.patch<{ user: User }>("/users/me", { avatarUrl: enviado.url });
      useStore.setState({ me: res.user });
      notify("Photo updated.");
    } catch (err) {
      setError(
        err instanceof ImageError
          ? err.message
          : err instanceof Error
            ? err.message
            : "That photo could not be saved."
      );
    } finally {
      setEnviandoFoto(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removerFoto() {
    setEnviandoFoto(true);
    setError(null);
    try {
      const res = await api.patch<{ user: User }>("/users/me", { avatarUrl: null });
      useStore.setState({ me: res.user });
      notify("Photo removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That photo could not be removed.");
    } finally {
      setEnviandoFoto(false);
    }
  }

  if (!me) return null;
  const changed = displayName.trim() !== me.displayName || (bio ?? "") !== (me.bio ?? "");

  async function save() {
    if (!displayName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.patch<{ user: User }>("/users/me", {
        displayName: displayName.trim(),
        bio: bio.trim()
      });
      useStore.setState({ me: res.user });
      notify("Profile saved.");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Scrim onClose={onClose}>
      <header>Your account</header>
      <div className="modal-body">
        {error && <div className="form-error">{error}</div>}

        <div className="settings-id">
          <button
            className="avatar-edit"
            onClick={() => fileRef.current?.click()}
            disabled={enviandoFoto}
            title="Change your photo"
            aria-label="Change your photo"
          >
            <Avatar name={me.displayName} url={me.avatarUrl} size={64} />
            <span className="avatar-edit-hint">{enviandoFoto ? "Saving…" : "Change"}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void trocarFoto(f);
            }}
          />
          <div>
            <strong>{me.displayName}</strong>
            <span>@{me.username}</span>
            {me.avatarUrl && (
              <button className="btn-link" disabled={enviandoFoto} onClick={() => void removerFoto()}>
                Remove photo
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="set-name">Display name</label>
          <input
            id="set-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={48}
          />
        </div>

        <div className="field">
          <label htmlFor="set-bio">About you</label>
          <input
            id="set-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={300}
            placeholder="Optional"
          />
        </div>

        <button className="btn-primary" disabled={busy || !changed || !displayName.trim()} onClick={save}>
          {busy ? "Saving…" : "Save changes"}
        </button>

        <div style={{ height: 1, background: "var(--divider)", margin: "22px 0 16px" }} />

        {/*
          Here so the choice can be made calmly, before a call is ringing. The
          same picker is inside the call for when the headset is only plugged
          in halfway through.
        */}
        <h3 className="settings-head">Audio and video</h3>
        <DevicePicker onNotice={(text) => notify(text, "bad")} />

        <div style={{ height: 1, background: "var(--divider)", margin: "22px 0 16px" }} />

        <p style={{ color: "var(--text-dim)", fontSize: 13.5, margin: "0 0 12px" }}>
          Signing out clears this session on this device. Anything you sent stays where it is.
        </p>
        <button
          className="btn-outline danger"
          onClick={async () => {
            await signOut();
            notify("Signed out.");
          }}
        >
          Sign out
        </button>
      </div>
      <footer>
        <button className="btn-ghost" onClick={onClose}>Close</button>
      </footer>
    </Scrim>
  );
}
