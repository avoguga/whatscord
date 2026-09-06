import { useRef, useState } from "react";
import { api, uploadFile } from "../lib/api";
import { useStore, type User } from "../store";
import { ImageError, squareThumbnail } from "../lib/image";
import { resolveTheme, type Theme } from "../lib/theme";
import { Avatar } from "./Avatar";
import { Scrim } from "./Scrim";
import { DevicePicker } from "./DevicePicker";

/**
 * Configurações, em seções.
 *
 * Era uma coluna só: perfil, dispositivos e sair, empilhados. Isso funciona
 * com três controles e desmonta no quarto — a tela vira uma rolagem longa onde
 * "trocar o microfone" e "sair da conta" ficam à mesma distância do olho,
 * embora uma seja rotineira e a outra irreversível.
 *
 * A divisão é a do Discord: uma coluna de categorias à esquerda, o conteúdo à
 * direita, e a conta separada do resto — porque é a única parte que vive no
 * servidor e vale para todos os aparelhos, enquanto aparência e dispositivos
 * são deste computador.
 *
 * No celular as duas colunas não cabem lado a lado, então viram mestre-detalhe:
 * a lista primeiro, o detalhe por cima, com voltar. Também é o que o Discord
 * faz — e é o motivo de `secao` poder ser `null`: no desktop `null` só quer
 * dizer "ainda ninguém escolheu, mostre a primeira".
 */

type SecaoId = "conta" | "voz" | "aparencia";

const SECOES: { id: SecaoId; titulo: string; grupo: string; icone: string }[] = [
  { id: "conta", titulo: "Minha conta", grupo: "Conta", icone: "person" },
  { id: "voz", titulo: "Voz e vídeo", grupo: "Aplicativo", icone: "mic" },
  { id: "aparencia", titulo: "Aparência", grupo: "Aplicativo", icone: "palette" }
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me);
  const [secao, setSecao] = useState<SecaoId | null>(null);

  // No desktop as duas colunas aparecem juntas, então sempre há uma seção
  // aberta; `null` só significa "a primeira".
  const atual = secao ?? "conta";
  const titulo = SECOES.find((s) => s.id === atual)!.titulo;

  if (!me) return null;

  const grupos = [...new Set(SECOES.map((s) => s.grupo))];

  return (
    <Scrim onClose={onClose} className="modal-wide">
      <div className="settings-shell" data-view={secao ? "detalhe" : "lista"}>
        <nav className="settings-nav" aria-label="Categorias">
          {/*
            Só visível no celular, onde esta coluna ocupa o diálogo inteiro e
            leva junto o "fechar" que mora no cabeçalho do detalhe.
          */}
          <div className="settings-list-head">
            <h3>Configurações</h3>
            <button className="settings-close" onClick={onClose} aria-label="Fechar">
              <Fechar />
            </button>
          </div>
          {grupos.map((g) => (
            <div key={g}>
              <h4>{g}</h4>
              {SECOES.filter((s) => s.grupo === g).map((s) => (
                <button
                  key={s.id}
                  className={`settings-tab${s.id === atual ? " on" : ""}`}
                  aria-current={s.id === atual ? "page" : undefined}
                  onClick={() => setSecao(s.id)}
                >
                  <Icone nome={s.icone} />
                  {s.titulo}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <section className="settings-panel">
          <header className="settings-panel-head">
            {/*
              Só aparece no celular, onde esta coluna cobre a lista. No desktop
              a lista está do lado e um "voltar" não teria para onde voltar.
            */}
            <button className="settings-back" onClick={() => setSecao(null)} aria-label="Voltar">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path fill="currentColor" d="M15.7 4.3 8 12l7.7 7.7 1.4-1.4L10.8 12l6.3-6.3z" />
              </svg>
            </button>
            <h3>{titulo}</h3>
            <button className="settings-close" onClick={onClose} aria-label="Fechar">
              <Fechar />
            </button>
          </header>

          <div className="settings-panel-body">
            {atual === "conta" && <SecaoConta me={me} onClose={onClose} />}
            {atual === "voz" && <SecaoVoz />}
            {atual === "aparencia" && <SecaoAparencia />}
          </div>
        </section>
      </div>
    </Scrim>
  );
}

function Fechar() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"
      />
    </svg>
  );
}

function Icone({ nome }: { nome: string }) {
  const caminhos: Record<string, string> = {
    person:
      "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z",
    mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V22h2v-3.1A7 7 0 0 0 19 12h-2Z",
    palette:
      "M12 3a9 9 0 0 0 0 18c.8 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8Zm-4.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d={caminhos[nome]} />
    </svg>
  );
}

/* ------------------------------------------------------------------ conta */

function SecaoConta({ me, onClose }: { me: User; onClose: () => void }) {
  const signOut = useStore((s) => s.signOut);
  const notify = useStore((s) => s.notify);

  const [displayName, setDisplayName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio ?? "");
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
    <>
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

      <button
        className="btn-primary"
        disabled={busy || !changed || !displayName.trim()}
        onClick={save}
      >
        {busy ? "Saving…" : "Save changes"}
      </button>

      <div className="settings-rule" />

      <p className="settings-note">
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
    </>
  );
}

/* -------------------------------------------------------------------- voz */

function SecaoVoz() {
  const notify = useStore((s) => s.notify);
  return (
    <>
      {/*
        Aqui para a escolha ser feita com calma, antes de o telefone tocar. O
        mesmo seletor existe dentro da chamada, para quando o fone só é
        conectado no meio dela.
      */}
      <DevicePicker onNotice={(text) => notify(text, "bad")} />
    </>
  );
}

/* -------------------------------------------------------------- aparência */

const TEMAS: { id: Theme; titulo: string; descricao: string }[] = [
  { id: "light", titulo: "Claro", descricao: "Fundo branco o dia todo." },
  { id: "dark", titulo: "Escuro", descricao: "Fundo escuro o dia todo." },
  {
    id: "system",
    titulo: "Igual ao dispositivo",
    descricao: "Acompanha o modo claro ou escuro do sistema."
  }
];

function SecaoAparencia() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  return (
    <>
      <h4 className="settings-head">Tema</h4>
      <div className="theme-choices" role="radiogroup" aria-label="Tema">
        {TEMAS.map((t) => (
          <label key={t.id} className={`theme-choice${theme === t.id ? " on" : ""}`}>
            <input
              type="radio"
              name="tema"
              value={t.id}
              checked={theme === t.id}
              onChange={() => setTheme(t.id)}
            />
            {/*
              A amostra é a paleta de verdade, não um ícone: quem escolhe tema
              quer ver a cor, e um rótulo "Claro" sem amostra obriga a testar
              para descobrir. `data-preview` é o que pinta cada uma.
            */}
            <span className="theme-swatch" data-preview={t.id === "system" ? resolveTheme("system") : t.id}>
              <span className="theme-swatch-bar" />
              <span className="theme-swatch-bubble" />
            </span>
            <span className="theme-choice-text">
              <strong>{t.titulo}</strong>
              <small>{t.descricao}</small>
            </span>
          </label>
        ))}
      </div>
    </>
  );
}
