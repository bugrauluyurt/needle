import { useState } from "react";
import type { FormEvent } from "react";
import { Logo } from "../components/Icon.tsx";
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
      setError(err instanceof SubsonicError && err.code === 40
        ? "That username and password don’t match a Navidrome account."
        : "Couldn’t reach Navidrome. Check that it’s running and that Needle’s server can reach it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="wall" aria-hidden="true">
        {Array.from({ length: 36 }, (_, i) => <span key={i} className={`wall-tile t${i % 9}`} />)}
      </div>
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <div className="brand">
          <Logo size={36} />
          Needle
        </div>
        <h1>Sign in to your music</h1>
        <p>Use your Navidrome account.</p>
        <label className="field">
          <span>Server</span>
          <input value={location.host} readOnly aria-readonly="true" tabIndex={-1} />
        </label>
        <label className="field">
          <span>Username</span>
          <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Your Navidrome password" required />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button type="submit" className="btn primary" disabled={busy || !user || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="fine">Your password goes to your Navidrome server only; Needle keeps a token, not the password.</p>
      </form>
    </div>
  );
}
