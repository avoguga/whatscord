import { useState } from "react";
import { api } from "../lib/api";
import { useStore, type User } from "../store";
import { initials } from "../lib/format";
import { Scrim } from "./Scrim";

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
          <span className="avatar" style={{ width: 56, height: 56, flexBasis: 56, fontSize: 19 }}>
            {initials(me.displayName)}
          </span>
          <div>
            <strong>{me.displayName}</strong>
            <span>@{me.username}</span>
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
