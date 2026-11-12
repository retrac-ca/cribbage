import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { authClient } from "../auth-client";
import { Mark, useAuth } from "./App";

declare global { interface Window { turnstile?: { render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string; remove: (widgetId: string) => void } } }
type Mode = "login" | "register" | "forgot" | "reset";

export function AuthPage({ mode }: { mode: Mode }) {
  const { refresh } = useAuth(); const navigate = useNavigate(); const [params] = useSearchParams();
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [password, setPassword] = useState(""); const [repeat, setRepeat] = useState("");
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [turnstileKey, setTurnstileKey] = useState(""); const [turnstileToken, setTurnstileToken] = useState("");
  const [emailDeliveryConfigured, setEmailDeliveryConfigured] = useState(false);
  const captcha = useRef<HTMLDivElement>(null); const widgetId = useRef<string>(""); const token = params.get("token") ?? "";

  useEffect(() => {
    if (!["register", "forgot", "reset"].includes(mode)) return;
    void api<{ turnstileSiteKey: string; emailDeliveryConfigured: boolean }>("/api/config")
      .then(config => { setTurnstileKey(config.turnstileSiteKey); setEmailDeliveryConfigured(config.emailDeliveryConfigured); })
      .catch(() => undefined);
  }, [mode]);
  useEffect(() => {
    if (mode !== "register" || !turnstileKey || !captcha.current) return;
    const render = () => { if (!window.turnstile || !captcha.current) return; window.turnstile.remove(widgetId.current); widgetId.current = window.turnstile.render(captcha.current, { sitekey: turnstileKey, callback: setTurnstileToken, "expired-callback": () => setTurnstileToken(""), "error-callback": () => setTurnstileToken("") }); };
    if (window.turnstile) render();
    else { const script = document.querySelector<HTMLScriptElement>("#turnstile-script") ?? document.createElement("script"); script.id = "turnstile-script"; script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; script.async = true; script.defer = true; script.onload = render; if (!script.parentNode) document.head.appendChild(script); }
    return () => { if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current); };
  }, [mode, turnstileKey]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "login") {
        const result = await authClient.signIn.email({ email: email.trim(), password });
        if (result.error) throw new Error(result.error.message);
        await refresh(); navigate("/", { replace: true });
      } else if (mode === "register") {
        if (password !== repeat) throw new Error("Those passwords don't match.");
        if (turnstileKey && !turnstileToken) throw new Error("Complete the security check before joining.");
        if (name.trim().length < 2 || name.trim().length > 40) throw new Error("Name must be between 2 and 40 characters.");
        const result = await authClient.signUp.email({
          email: email.trim(), name: name.trim(), password,
          fetchOptions: turnstileToken ? { headers: { "x-captcha-response": turnstileToken } } : undefined,
        });
        if (result.error) throw new Error(result.error.message);
        await refresh(); navigate("/", { replace: true });
      } else if (mode === "forgot") {
        if (!emailDeliveryConfigured) throw new Error("Password reset email is not configured yet. Please contact the site operator.");
        const result = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: `${window.location.origin}/reset-password` });
        if (result.error) throw new Error(result.error.message);
        setMessage("If an account exists, a password reset link will be sent.");
      } else if (mode === "reset") {
        if (password !== repeat) throw new Error("Those passwords don't match.");
        const result = await authClient.resetPassword({ newPassword: password, token });
        if (result.error) throw new Error(result.error.message);
        setMessage("Your password has been updated. Please log in.");
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setBusy(false); }
  };

  const title = mode === "login" ? "Welcome back." : mode === "register" ? "Pull up a chair." : mode === "forgot" ? "Forgot your password?" : "A fresh start.";
  const subtitle = mode === "login" ? "Your next hand is waiting." : mode === "register" ? "Your seat at the table is just a few details away." : mode === "forgot" ? "Enter the email on your account and we'll send a reset link if delivery is enabled." : "Choose a new password for your account.";

  return <main className="auth-layout"><section className="auth-aside"><div className="auth-aside-top"><Mark light /><span>EST. SINCE THE FIRST DEAL</span></div><div className="auth-aside-center"><div className="auth-flower">✳</div><p>“The best games are<br />the ones that make<br />you think.”</p><span>GOOD CARDS. BETTER COMPANY.</span></div><div className="auth-aside-bottom"><span>RETRAC CRIBBAGE</span><span>crib.retrac.ca</span></div></section>
     <section className="auth-main"><div className="auth-mobile-brand"><Mark /></div><div className="auth-form-wrap"><span className="eyebrow eyebrow-dark">{mode === "login" ? "BACK AT THE TABLE" : mode === "register" ? "A NEW PLAYER JOINS" : "ACCOUNT RECOVERY"}</span><h1>{title}</h1><p className="auth-subtitle">{subtitle}</p>
       <form onSubmit={event => void submit(event)}>
        {(mode === "login" || mode === "register" || mode === "forgot") && <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>}
        {mode === "register" && <label>Your name<input autoComplete="name" required minLength={2} maxLength={40} value={name} onChange={event => setName(event.target.value)} placeholder="What should we call you?" /></label>}
        {(mode === "login" || mode === "register" || mode === "reset") && <label>Password<input type="password" required minLength={mode === "login" ? 1 : 12} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === "login" ? "Your password" : "At least 12 characters"} /></label>}
        {(mode === "register" || mode === "reset") && <label>Confirm password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={repeat} onChange={event => setRepeat(event.target.value)} placeholder="Type it once more" /></label>}
         {mode === "register" && turnstileKey && <div className="turnstile-box"><div ref={captcha} /><small>Protected by Cloudflare Turnstile.</small></div>}
         {mode === "register" && !turnstileKey && <p className="quiet-note">Security check will appear when Turnstile is configured.</p>}
         {(mode === "forgot" || mode === "reset") && !emailDeliveryConfigured && <p className="quiet-note">Email delivery is not configured, so account recovery links cannot currently be sent.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
        <button className="button button-green auth-submit" disabled={busy}>{busy ? "One moment…" : mode === "login" ? "Log in" : mode === "register" ? "Create my account" : mode === "forgot" ? "Send reset link" : "Save new password"}<span>→</span></button>
        {mode === "login" && <Link className="forgot-link" to="/forgot-password">Forgot password?</Link>}
       </form>
      <div className="auth-switch">{mode === "login" ? <>New to the table? <Link to="/register">Create an account</Link></> : mode === "register" ? <>Already have a seat? <Link to="/login">Log in</Link></> : mode === "forgot" || mode === "reset" ? <Link to="/login">← Back to log in</Link> : null}</div><Link to="/" className="auth-back">← Back to RETRAC Cribbage</Link>
    </div></section></main>;
}
