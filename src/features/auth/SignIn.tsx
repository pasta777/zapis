/* ────────────────────────────────────────────────────────────────
   The gate.

   Shown instead of the app when there is no session. Registration is
   only reachable when the server was given an invite code — the form
   still offers it, and the server is what actually refuses.
   ──────────────────────────────────────────────────────────────── */

import { useState, type FormEvent } from "react";
import { api, type Account } from "../../api/client.ts";
import { useT } from "../../i18n/index.tsx";

export function SignIn({ onSignedIn }: { onSignedIn: (user: Account) => void }) {
  const t = useT();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [handle, setHandle] = useState("");
  const [display, setDisplay] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");
    try {
      const { user } =
        mode === "login"
          ? await api.login(handle, password)
          : await api.register({ handle, display: display || handle, password, invite });
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ll ll-gate">
      <header className="ll-head">
        <div className="ll-brand">
          <span className="ll-mark">§</span>
          <span>{t.s.brand}</span>
        </div>
      </header>

      <form className="ll-card ll-signin" onSubmit={submit}>
        <h2>{mode === "login" ? t.t("signIn") : t.t("register")}</h2>

        <label className="ll-field">
          <span>{t.t("handle")}</span>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            required
          />
        </label>

        {mode === "register" && (
          <label className="ll-field">
            <span>{t.t("displayName")}</span>
            <input
              value={display}
              onChange={(e) => setDisplay(e.target.value)}
              placeholder={handle}
              maxLength={40}
            />
          </label>
        )}

        <label className="ll-field">
          <span>{t.t("password")}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
        </label>

        {mode === "register" && (
          <label className="ll-field">
            <span>{t.t("inviteCode")}</span>
            <input
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
        )}

        {error && <div className="ll-error">{error}</div>}

        <button className="ll-primary" type="submit" disabled={busy}>
          {mode === "login" ? t.t("signIn") : t.t("register")}
        </button>

        <button
          className="ll-ghost sm"
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login" ? t.t("needAccount") : t.t("haveAccount")}
        </button>
      </form>
    </div>
  );
}
