import { useState } from "react";
import type { FormEvent } from "react";
import { Logo } from "../components/Icon.tsx";
import { translate } from "../i18n/index.ts";
import { makeCredentials, SubsonicError, sub } from "../lib/subsonic.ts";
import { useSession } from "../state/session.ts";

export function Login() {
  const signIn = useSession((s) => s.signIn);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const creds = makeCredentials(user.trim(), password);
    try {
      await sub.ping(creds);
      signIn(creds);
    } catch (err) {
      setError(
        err instanceof SubsonicError && err.code === 40
          ? translate("login.badCredentials")
          : translate("login.failed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="wall" aria-hidden="true">
        {Array.from({ length: 36 }, (_, i) => (
          <span key={i} className={`wall-tile t${i % 9}`} />
        ))}
      </div>
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <div className="brand">
          <Logo size={36} />
          Needle
        </div>
        <h1>{translate("login.heading")}</h1>
        <p>{translate("login.subtitle")}</p>
        <label className="field">
          <span>{translate("login.server")}</span>
          <input
            value={location.host}
            readOnly
            aria-readonly="true"
            tabIndex={-1}
          />
        </label>
        <label className="field">
          <span>{translate("login.username")}</span>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            autoFocus
          />
        </label>
        <label className="field">
          <span>{translate("login.password")}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder={translate("login.passwordHint")}
            required
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn primary"
          disabled={busy || !user || !password}
        >
          {busy ? translate("login.busy") : translate("login.submit")}
        </button>
        <p className="fine">{translate("login.privacy")}</p>
      </form>
    </div>
  );
}
