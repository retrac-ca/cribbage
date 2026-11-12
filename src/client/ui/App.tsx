import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError, type Game, type User } from "../api";
import { authClient } from "../auth-client";
import { AuthPage } from "./Auth";
import { GamePage } from "./Game";

interface AuthValue { user: User | null; loading: boolean; setUser: (user: User | null) => void; refresh: () => Promise<void> }
const AuthContext = createContext<AuthValue | null>(null);
export const useAuth = () => { const value = useContext(AuthContext); if (!value) throw new Error("AuthProvider is missing"); return value; };

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const authGeneration = useRef(0);
  const updateUser = (nextUser: User | null) => { authGeneration.current++; setUser(nextUser); };
  const refresh = async () => {
    const generation = authGeneration.current;
    try {
      const session = await authClient.getSession();
      if (session.data?.user) {
        const profile = await api<{ user: User }>("/api/me");
        if (generation === authGeneration.current) setUser(profile.user);
      } else if (generation === authGeneration.current) setUser(null);
    }
    catch (error) { if (generation === authGeneration.current && error instanceof ApiError && error.status === 401) setUser(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  return <AuthContext.Provider value={{ user, loading, setUser: updateUser, refresh }}><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/register" element={<AuthPage mode="register" />} />
    <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
    <Route path="/reset-password" element={<AuthPage mode="reset" />} />
    <Route path="/game" element={<Protected><GamePage /></Protected>} />
    <Route path="/history" element={<Protected><HistoryPage /></Protected>} />
    <Route path="/account" element={<Protected><AccountPage /></Protected>} />
    <Route path="/privacy" element={<LegalPage kind="privacy" />} />
    <Route path="/terms" element={<LegalPage kind="terms" />} />
    <Route path="*" element={<NotFound />} />
  </Routes></AuthContext.Provider>;
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth(); const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? <Dashboard /> : <Landing />;
}

function Mark({ light = false }: { light?: boolean }) {
  return <Link to="/" className={`brand ${light ? "brand-light" : ""}`} aria-label="RETRAC Cribbage home"><span className="brand-icon"><span>R</span></span><span className="brand-copy"><strong>RETRAC</strong><small>CRIBBAGE CLUB</small></span></Link>;
}

function Landing() {
  return <main className="landing"><header className="landing-nav wrap"><Mark /><div className="nav-links"><Link to="/login" className="nav-login">Log in</Link><Link to="/register" className="button button-light">Join the table <span>↗</span></Link></div></header>
    <section className="hero wrap"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot" /> THE CLASSIC, RECONSIDERED</div><h1>A better hand,<br /><em>one peg</em> at a time.</h1><p>Good cards help. A little strategy helps more. Pull up a chair for a thoughtful game of cribbage against a worthy computer opponent.</p><div className="hero-actions"><Link to="/register" className="button button-gold">Start playing <span>→</span></Link><Link to="/login" className="text-link">I have an account <span>↗</span></Link></div><div className="hero-proof"><div className="avatar-stack"><i>R</i><i>♣</i><i>7</i></div><span>Tradition, with a fresh deal.</span></div></div>
      <div className="hero-art" aria-label="Illustration of a cribbage board and playing cards"><div className="art-glow" /><div className="board"><div className="board-top"><span>RETRAC</span><span>121</span></div><div className="peg-track"><div className="track track-one">{Array.from({ length: 36 }, (_, i) => <i key={`a${i}`} />)}</div><div className="track track-two">{Array.from({ length: 36 }, (_, i) => <i key={`b${i}`} />)}</div><div className="peg peg-gold" /><div className="peg peg-cream" /></div><div className="board-bottom"><span>THE LONG GAME</span><span>✳</span></div></div><div className="playing-card card-float card-float-one"><small>J</small><span>♠</span><b>J</b></div><div className="playing-card card-float card-float-two"><small>5</small><span>♥</span><b>5</b></div><div className="art-note"><span>01</span> KEEP YOUR WITS ABOUT YOU</div></div>
    </section><div className="landing-footer wrap"><span>THE GAME IS ALWAYS ON YOUR SIDE.</span><div className="landing-footer-right"><span>PLAY AT YOUR OWN PACE <b>✳</b></span><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></div></div>
  </main>;
}

function Shell({ children, eyebrow, title, actions }: { children: ReactNode; eyebrow?: string; title?: string; actions?: ReactNode }) {
  const { user } = useAuth();
  const logout = async () => { try { await authClient.signOut(); } finally { window.location.replace("/"); } };
  return <div className="app-shell"><header className="app-header wrap"><Mark /><nav className="app-nav"><Link to="/">Dashboard</Link><Link to="/history">Game history</Link><Link to="/account">Account</Link></nav><div className="header-user"><span className="user-initial">{user?.displayName.slice(0, 1).toUpperCase()}</span><span>{user?.displayName}</span><button className="icon-button logout-button" onClick={() => void logout()} aria-label="Log out" title="Log out">↗</button></div></header>
    <main className="app-main wrap">{title && <div className="page-heading"><div><span className="eyebrow eyebrow-dark">{eyebrow}</span><h1>{title}</h1></div>{actions}</div>}{children}</main>
    <footer className="app-footer wrap"><Mark /><span>Good game. Good company.</span><div><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link></div></footer>
  </div>;
}

function Dashboard() {
  const { user } = useAuth(); const [active, setActive] = useState<Game | null>(null); const [stats, setStats] = useState<{ games: number; wins: number; losses: number; winRate: number; averageScore: number }>();
  const [recent, setRecent] = useState<{ id: string; difficulty: string; playerScore: number; computerScore: number; result: string; completedAt: string | null }[]>([]);
  const [error, setError] = useState(""); const [difficulty, setDifficulty] = useState<Game["difficulty"]>("medium"); const navigate = useNavigate();
  useEffect(() => { Promise.all([api<{ game: Game | null }>("/api/games/active"), api<{ stats: typeof stats }>("/api/stats"), api<{ games: typeof recent }>("/api/games/history")]).then(([a, s, h]) => { setActive(a.game); setStats(s.stats); setRecent(h.games.slice(0, 3)); }).catch(() => setError("Couldn't load your game data. Please refresh.")); }, []);
  const start = async () => { setError(""); try { const result = await api<{ game: Game }>("/api/games", { method: "POST", body: JSON.stringify({ difficulty }) }); setActive(result.game); navigate("/game"); } catch (failure) { if (failure instanceof ApiError && failure.code === "ACTIVE_GAME_EXISTS") navigate("/game"); else setError(failure instanceof Error ? failure.message : "Could not start a game."); } };
  return <Shell eyebrow="YOUR TABLE IS READY" title={`Good ${getDaypart()}, ${user?.displayName.split(" ")[0]}.`}><div className="dashboard-grid"><section className="welcome-card"><div className="welcome-top"><span className="tag"><i /> {active ? "GAME IN PROGRESS" : "YOUR NEXT GAME"}</span><span className="welcome-flower">✳</span></div><h2>{active ? "Your seat is saved." : "Fancy a game?"}</h2><p>{active ? `Round ${active.round} · ${active.difficulty[0].toUpperCase() + active.difficulty.slice(1)} opponent. Pick up exactly where you left off.` : "A fresh deal, a sharp opponent, and all the time in the world."}</p>
        {!active && <div className="difficulty-picker"><label htmlFor="difficulty">PLAY AGAINST</label><select id="difficulty" value={difficulty} onChange={event => setDifficulty(event.target.value as Game["difficulty"])}><option value="easy">Easy · Friendly</option><option value="medium">Medium · Thoughtful</option><option value="hard">Hard · Competitive</option></select></div>}
        <button className="button button-gold" onClick={() => active ? navigate("/game") : void start()}>{active ? "Resume game" : "Deal me in"}<span>→</span></button>{error && <p className="form-error">{error}</p>}</section>
      <section className="stats-card"><div className="section-kicker">YOUR SEASON <span>✳</span></div><div className="stat-major"><strong>{stats?.games ?? 0}</strong><span>GAMES PLAYED</span></div><div className="stat-pair"><div><strong>{stats?.wins ?? 0}<small>W</small></strong><span>WINS</span></div><i /><div><strong>{stats?.winRate ?? 0}<small>%</small></strong><span>WIN RATE</span></div></div><Link to="/history" className="stat-link">View your record <span>→</span></Link></section></div>
    <section className="recent-section"><div className="section-title"><div><span className="eyebrow eyebrow-dark">THE LAST FEW DEALS</span><h2>Recent games</h2></div><Link to="/history" className="text-link">All history <span>→</span></Link></div>{recent.length ? <div className="recent-list">{recent.map(item => <div className="recent-row" key={item.id}><span className={`result-badge ${item.result}`}>{item.result === "win" ? "W" : "L"}</span><div><strong>vs. {item.difficulty[0].toUpperCase() + item.difficulty.slice(1)} computer</strong><small>{item.completedAt ? new Date(item.completedAt).toLocaleDateString() : "Recently"}</small></div><span className="recent-score">{item.playerScore}<i>—</i>{item.computerScore}</span><span className="recent-outcome">{item.result === "win" ? "Victory" : "Defeat"}</span></div>)}</div> : <div className="empty-state"><span>♧</span><p>No games yet. Your first hand is waiting.</p></div>}</section>
  </Shell>;
}

function getDaypart() { const hour = new Date().getHours(); return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"; }

function HistoryPage() {
  const [games, setGames] = useState<{ id: string; difficulty: string; playerScore: number; computerScore: number; result: string; startedAt: string; completedAt: string | null; status: string }[]>([]);
  const [stats, setStats] = useState<{ games: number; wins: number; losses: number; winRate: number; averageScore: number; byDifficulty: Record<string, { games: number; wins: number }> }>();
  useEffect(() => { void Promise.all([api<{ games: typeof games }>("/api/games/history"), api<{ stats: typeof stats }>("/api/stats")]).then(([history, summary]) => { setGames(history.games); setStats(summary.stats); }); }, []);
  return <Shell eyebrow="KEEPING SCORE" title="Your game book."><section className="history-stats"><div><strong>{stats?.games ?? 0}</strong><span>GAMES</span></div><div><strong>{stats?.wins ?? 0}</strong><span>WINS</span></div><div><strong>{stats?.losses ?? 0}</strong><span>LOSSES</span></div><div><strong>{stats?.winRate ?? 0}%</strong><span>WIN RATE</span></div><div><strong>{stats?.averageScore ?? 0}</strong><span>AVERAGE SCORE</span></div></section>
    <div className="section-title history-title"><div><span className="eyebrow eyebrow-dark">EVERY DEAL COUNTS</span><h2>Completed games</h2></div></div>{games.length ? <div className="history-table"><div className="history-head"><span>RESULT</span><span>OPPONENT</span><span>DATE</span><span>SCORE</span></div>{games.map(item => <div className="history-row" key={item.id}><span className={`history-result ${item.result}`}>{item.result === "win" ? "VICTORY" : "DEFEAT"}</span><span>{item.difficulty[0].toUpperCase() + item.difficulty.slice(1)} computer</span><span>{new Date(item.completedAt ?? item.startedAt).toLocaleDateString()}</span><strong>{item.playerScore} <i>—</i> {item.computerScore}</strong></div>)}</div> : <div className="empty-state"><span>♧</span><p>Your completed games will be kept here.</p><Link className="text-link" to="/">Play your first game →</Link></div>}
    <section className="difficulty-record"><h3>By difficulty</h3>{["easy", "medium", "hard"].map(level => <div key={level}><span>{level[0].toUpperCase() + level.slice(1)}</span><span>{stats?.byDifficulty?.[level]?.wins ?? 0} wins / {stats?.byDifficulty?.[level]?.games ?? 0} games</span></div>)}</section>
  </Shell>;
}

function AccountPage() {
  const { user, refresh } = useAuth(); const [name, setName] = useState(user?.displayName ?? ""); const [hints, setHints] = useState(user?.preferences?.showHints !== false);
  const [emailDeliveryConfigured, setEmailDeliveryConfigured] = useState(false);
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [verificationMessage, setVerificationMessage] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ emailDeliveryConfigured: boolean }>("/api/config").then(config => setEmailDeliveryConfigured(config.emailDeliveryConfigured)).catch(() => undefined); }, []);
  const save = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(""); setMessage(""); try {
    const updated = await authClient.updateUser({ name: name.trim() });
    if (updated.error) throw new Error(updated.error.message);
    await api("/api/me", { method: "PATCH", body: JSON.stringify({ preferences: { showHints: hints } }) });
    await refresh(); setMessage("Your settings are saved.");
  } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save settings."); } finally { setBusy(false); } };
  const resendVerification = async () => { setVerificationMessage(""); try {
    const result = await authClient.sendVerificationEmail({ email: user?.email ?? "", callbackURL: "/" });
    if (result.error) throw new Error(result.error.message);
    setVerificationMessage("If your address can be verified, a link will be sent.");
  } catch (failure) { setVerificationMessage(failure instanceof Error ? failure.message : "Could not send a verification link."); } };
  const remove = async () => { if (!window.confirm("Permanently delete your account and all game history? This cannot be undone.")) return; setBusy(true); try {
    const result = await authClient.deleteUser({ password });
    if (result.error) throw new Error(result.error.message);
    window.location.replace("/");
  } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not delete account."); } finally { setBusy(false); } };
  return <Shell eyebrow="THE HOUSE RULES" title="Your account."><div className="account-layout"><form className="account-panel" onSubmit={event => void save(event)}><h2>Player details</h2><p>Just the basics. Your password stays private.</p><label>Display name<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={40} required /></label><label>Email address<input value={user?.email ?? ""} readOnly /><small>{user?.emailVerified ? "Email verified" : emailDeliveryConfigured ? "A verification link is available for your address." : "Email delivery isn't configured; account recovery email won't be sent."}</small></label>{!user?.emailVerified && emailDeliveryConfigured && <><button type="button" className="quiet-button resend-verification" onClick={() => void resendVerification()}>Resend verification email →</button>{verificationMessage && <p className={verificationMessage.includes("couldn't") ? "form-error" : "form-success"}>{verificationMessage}</p>}</>}<h3>Table preferences</h3><label className="toggle-row"><span>Show game hints<small>Helpful reminders while you play</small></span><input type="checkbox" checked={hints} onChange={event => setHints(event.target.checked)} /></label>{message && <p className="form-success">{message}</p>}{error && <p className="form-error">{error}</p>}<button className="button button-green" disabled={busy}>{busy ? "Saving…" : "Save changes"}<span>→</span></button></form>
    <section className="account-panel account-danger"><h2>Close your account</h2><p>This permanently removes your profile, active game, and game history.</p><label>Confirm with your password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label><button className="button button-danger" disabled={busy || !password} onClick={() => void remove()}>Delete my account</button></section></div></Shell>;
}

function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  return <div className="legal-page"><header className="app-header wrap"><Mark /><Link to="/" className="text-link">Back to the table →</Link></header><article className="legal-copy"><span className="eyebrow eyebrow-dark">RETRAC CRIBBAGE</span><h1>{kind === "privacy" ? "Privacy notice" : "Terms of use"}</h1><p className="legal-updated">A plain-language starting point — last updated November 2026.</p>{kind === "privacy" ? <><h2>Information we keep</h2><p>We store your email address, display name, a scrypt password hash in Better Auth credential records, account preferences, session records (which may include IP address and user-agent data), and game history so you can use the service and resume games. Game state is stored on Cloudflare infrastructure. We do not store your password in readable form.</p><h2>How information is used</h2><p>Information is used to provide sign-in, save games, calculate your record, and protect the service from abuse. If email delivery is configured, your address is used for account verification and password-reset messages.</p><h2>Cookies and retention</h2><p>A secure, HTTP-only session cookie keeps you signed in. Sessions expire; completed game records remain until you delete your account. Deleting your account removes its associated records.</p><h2>Service providers and contact</h2><p>The application is hosted on Cloudflare. Email delivery, if enabled, is handled by the configured email provider. Before launch, the operator should add a contact address, confirm applicable privacy requirements, and publish any jurisdiction-specific disclosures.</p></> : <><h2>Using the service</h2><p>RETRAC Cribbage is provided for personal, recreational play. You are responsible for maintaining the security of your account and for providing accurate registration details.</p><h2>Fair play and availability</h2><p>Game rules and results are processed by the server. We may suspend abusive accounts or change the service. Availability, data retention, and support arrangements should be confirmed by the operator before public launch.</p><h2>No legal promise</h2><p>This draft is a starting point, not legal advice or a claim of legal compliance. The operator should have these terms reviewed for the intended audience and jurisdiction before launch.</p></>}</article></div>;
}

function Loading() { return <div className="loading-screen"><span className="loading-mark">R</span><span>Setting the table…</span></div>; }
function NotFound() { return <div className="not-found"><Mark /><h1>That page got shuffled.</h1><Link className="button button-green" to="/">Back to the table →</Link></div>; }

export { Mark, Shell };
