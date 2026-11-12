import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { createGame, discard, discardComputer, legalCards, playCard, sayGo, scoreShow, shuffleDeck, canSayGo } from "../engine/game";
import { chooseDiscards, runComputerTurn } from "../engine/strategy";
import type { Card, Difficulty, GameState } from "../engine/types";
import type { Env } from "./env";
import { auth, requireAuth } from "./auth";
import { originGuard, turnstileSiteKey, withinRateLimit, type AppContext, type AppVariables } from "./security";

type Bindings = { Bindings: Env; Variables: AppVariables };
const app = new Hono<Bindings>();

app.use("/api/*", bodyLimit({ maxSize: 32 * 1024 }));
app.use("/api/*", cors({ origin: (origin, context) => origin === (context.env.APP_ORIGIN ?? new URL(context.req.url).origin) ? origin : "", credentials: true, allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allowHeaders: ["Content-Type", "x-captcha-response"] }));
app.use("/api/*", originGuard());
app.use("/api/*", async (context, next) => {
  // Better Auth validates its own JSON and form-encoded authentication payloads.
  if (context.req.path.startsWith("/api/auth/")) return next();
  if (!["POST", "PATCH", "DELETE"].includes(context.req.method)) return next();
  if (context.req.header("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return context.json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Send this request as JSON." } }, 415);
  }
  try {
    const body = await context.req.json<unknown>();
    if (!body || typeof body !== "object" || Array.isArray(body)) return context.json({ error: { code: "INVALID_INPUT", message: "The request body must be a JSON object." } }, 400);
  } catch { return context.json({ error: { code: "INVALID_JSON", message: "The request body must be valid JSON." } }, 400); }
  return next();
});
app.use("/api/auth/*", async (context, next) => {
  const action = `auth:${context.req.path}`;
  if (context.req.method === "POST" && !(await withinRateLimit(context as AppContext, action, 12))) return context.json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Please try again in a few minutes." } }, 429);
  return next();
});
app.use("/api/games", async (context, next) => {
  if (!(await withinRateLimit(context as AppContext, "game", 240))) return context.json({ error: { code: "RATE_LIMITED", message: "Too many game actions. Please try again shortly." } }, 429);
  return next();
});
app.use("/api/games/*", async (context, next) => {
  if (!(await withinRateLimit(context as AppContext, "game", 240))) return context.json({ error: { code: "RATE_LIMITED", message: "Too many game actions. Please try again shortly." } }, 429);
  return next();
});

function redactDiagnosticText(value: string) {
  return value
    .replace(/(password|passwd|pwd|token|session|cookie|authorization|api[_-]?key|secret|access[_-]?key)(\s*[:=]\s*)("[^"]*"|'[^']*'|`[^`]*`|[^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]")
    .replace(/\b(?:[A-F\d]{1,4}:){2,}[A-F\d:.]{2,}\b/gi, "[REDACTED_IP]")
    .replace(/\b(?:\+?\d[\d ().-]{7,}\d)\b/g, "[REDACTED_PHONE]")
    .replace(/\b[A-F\d]{8}(?:-[A-F\d]{4}){3}-[A-F\d]{12}\b/gi, "[REDACTED_ID]")
    .replace(/\b[A-Z\d_+/=-]{32,}\b/gi, "[REDACTED_SECRET]");
}

app.onError((error, context) => {
  if (error instanceof SyntaxError) return context.json({ error: { code: "INVALID_JSON", message: "The request body must be valid JSON." } }, 400);
  if (error instanceof Error && error.message === "Request body too large") return context.json({ error: { code: "BODY_TOO_LARGE", message: "The request is too large." } }, 413);
  if (error instanceof Error) {
    console.error("Request failed", {
      name: redactDiagnosticText(error.name),
      message: redactDiagnosticText(error.message),
      ...(error.stack ? { stack: redactDiagnosticText(error.stack) } : {}),
    });
  } else {
    console.error("Request failed", { name: "NonErrorException", message: "A non-Error value was thrown." });
  }
  return context.json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } }, 500);
});

function safeUser(user: { id: string; email: string; display_name: string; email_verified: number; preferences: string; created_at: string }) {
  let preferences: Record<string, unknown> = {};
  try { preferences = JSON.parse(user.preferences); } catch { /* use empty preferences */ }
  return { id: user.id, email: user.email, displayName: user.display_name, emailVerified: Boolean(user.email_verified), preferences, createdAt: user.created_at };
}
function randomFloat() { return crypto.getRandomValues(new Uint32Array(1))[0] / 0x1_0000_0000; }
function sanitized(state: GameState) {
  const show = state.phase === "show" || state.phase === "complete";
  const { deck: _deck, showHands: _showHands, ...rest } = state;
  return {
    ...rest,
    hands: [show && state.showHands[0].length === 4 ? state.showHands[0] : state.hands[0], show ? (state.showHands[1].length === 4 ? state.showHands[1] : state.hands[1]) : []] as [Card[], Card[]],
    computerCardCount: show && state.showHands[1].length === 4 ? 4 : state.hands[1].length,
    crib: show ? state.crib : [],
    legalCardIds: state.phase === "pegging" && state.turn === 0 ? legalCards(state, 0).map(card => card.id) : [],
    canSayGo: canSayGo(state, 0),
  };
}
function parseGame(row: { state: string }): GameState { return JSON.parse(row.state) as GameState; }
async function activeGame(context: AppContext) {
  return context.env.DB.prepare("SELECT id, revision, status, state FROM games WHERE user_id = ? AND status = 'active' LIMIT 1").bind(context.get("user").id).first<{ id: string; revision: number; status: string; state: string }>();
}
async function persist(context: AppContext, row: { id: string; revision: number }, state: GameState, status: "active" | "completed" | "resigned" = "active") {
  const oldRevision = row.revision;
  state.revision = oldRevision + 1;
  state.updatedAt = new Date().toISOString();
  const done = status !== "active";
  const result = await context.env.DB.prepare(
    "UPDATE games SET state = ?, revision = ?, status = ?, player_score = ?, computer_score = ?, winner = ?, updated_at = ?, completed_at = ? WHERE id = ? AND user_id = ? AND revision = ? AND status = 'active'",
  ).bind(JSON.stringify(state), state.revision, status, state.scores[0], state.scores[1], state.winner, state.updatedAt, done ? state.updatedAt : null, row.id, context.get("user").id, oldRevision).run();
  if (result.meta.changes !== 1) return false;
  return true;
}
async function gameRow(context: AppContext, id: string) {
  return context.env.DB.prepare("SELECT id, revision, status, state FROM games WHERE id = ? AND user_id = ? LIMIT 1").bind(id, context.get("user").id).first<{ id: string; revision: number; status: string; state: string }>();
}
function expectedRevision(body: Record<string, unknown>) { return Number.isSafeInteger(body.revision) && Number(body.revision) >= 0 ? Number(body.revision) : null; }
function completeStatus(state: GameState) { return state.phase === "complete" ? "completed" as const : "active" as const; }
function actionFailure(message: string) { return { error: { code: "INVALID_ACTION", message } } as const; }

app.get("/api/health", context => context.json({ status: "ok", app: "RETRAC Cribbage" }));
app.get("/api/config", context => context.json({
  turnstileSiteKey: turnstileSiteKey(context.env),
  emailDeliveryConfigured: Boolean(context.env.EMAIL_API_KEY && context.env.EMAIL_FROM),
}));

app.all("/api/auth/*", context => auth.handler(context.req.raw));

app.use("/api/me", requireAuth);
app.use("/api/me/*", requireAuth);
app.get("/api/me", context => context.json({ user: safeUser(context.get("user")) }));
app.patch("/api/me", async context => {
  const body = await context.req.json<Record<string, unknown>>();
  const current = context.get("user");
  let preferences: Record<string, unknown>;
  try { preferences = JSON.parse(current.preferences); } catch { preferences = {}; }
  if (body.preferences && typeof body.preferences === "object" && !Array.isArray(body.preferences)) {
    const input = body.preferences as Record<string, unknown>;
    if (typeof input.sound === "boolean") preferences.sound = input.sound;
    if (typeof input.showHints === "boolean") preferences.showHints = input.showHints;
  }
  await context.env.DB.prepare("UPDATE users SET preferences = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(preferences), new Date().toISOString(), current.id).run();
  const updated = { ...current, preferences: JSON.stringify(preferences) };
  return context.json({ user: safeUser(updated) });
});

app.post("/api/games", requireAuth, async context => {
  const body = await context.req.json<Record<string, unknown>>();
  const difficulty = body.difficulty;
  if (!["easy", "medium", "hard"].includes(String(difficulty))) return context.json({ error: { code: "INVALID_INPUT", message: "Choose easy, medium, or hard difficulty." } }, 400);
  if (await activeGame(context as AppContext)) return context.json({ error: { code: "ACTIVE_GAME_EXISTS", message: "Resume or finish your active game before starting another." } }, 409);
  const now = new Date().toISOString();
  const state = createGame({ deck: shuffleDeck(randomFloat), dealer: Math.floor(randomFloat() * 2), difficulty: difficulty as Difficulty, now });
  const id = state.id;
  try {
    await context.env.DB.prepare("INSERT INTO games(id,user_id,status,difficulty,revision,state,player_score,computer_score,started_at,updated_at) VALUES(?,?,'active',?,0,?,0,0,?,?)").bind(id, context.get("user").id, difficulty, JSON.stringify(state), now, now).run();
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) return context.json({ error: { code: "ACTIVE_GAME_EXISTS", message: "Resume or finish your active game before starting another." } }, 409);
    throw error;
  }
  return context.json({ game: sanitized(state) }, 201);
});

app.get("/api/games/active", requireAuth, async context => {
  const row = await activeGame(context as AppContext);
  return row ? context.json({ game: sanitized(parseGame(row)) }) : context.json({ game: null });
});

app.post("/api/games/:id/action", requireAuth, async context => {
  const body = await context.req.json<Record<string, unknown>>();
  const revision = expectedRevision(body);
  if (revision === null || typeof body.action !== "string") return context.json({ error: { code: "INVALID_INPUT", message: "A valid revision and game action are required." } }, 400);
  const row = await gameRow(context as AppContext, context.req.param("id"));
  if (!row) return context.json({ error: { code: "GAME_NOT_FOUND", message: "Game not found." } }, 404);
  if (row.status !== "active") return context.json({ error: { code: "GAME_COMPLETE", message: "This game has already ended." } }, 409);
  if (revision !== row.revision) return context.json({ error: { code: "STALE_REVISION", message: "The game has changed. Refresh to get the latest state." } }, 409);
  const state = parseGame(row);
  try {
    switch (body.action) {
      case "discard": {
        if (!Array.isArray(body.cardIds) || !body.cardIds.every(id => typeof id === "string")) throw new Error("Choose two cards to discard.");
        discard(state, 0, body.cardIds as string[]);
        discardComputer(state, chooseDiscards(state, state.difficulty, randomFloat));
        if (state.phase === "pegging") runComputerTurn(state);
        break;
      }
      case "play":
        if (typeof body.cardId !== "string") throw new Error("Choose a card to play.");
        playCard(state, 0, body.cardId);
        runComputerTurn(state);
        break;
      case "go":
        sayGo(state, 0);
        runComputerTurn(state);
        break;
      case "show":
        scoreShow(state, shuffleDeck(randomFloat));
        break;
      case "resign":
        state.winner = 1; state.phase = "complete"; state.events.push({ player: 1, points: 0, reason: "You resigned" });
        break;
      default: throw new Error("That game action is not supported.");
    }
  } catch (error) {
    return context.json(actionFailure(error instanceof Error ? error.message : "That move is not legal."), 400);
  }
  const status = body.action === "resign" ? "resigned" : completeStatus(state);
  if (!(await persist(context as AppContext, row, state, status))) return context.json({ error: { code: "STALE_REVISION", message: "The game changed before your move was saved. Refresh to get the latest state." } }, 409);
  return context.json({ game: sanitized(state) });
});

app.get("/api/games/history", requireAuth, async context => {
  const rows = await context.env.DB.prepare("SELECT id,difficulty,player_score,computer_score,winner,started_at,completed_at,status FROM games WHERE user_id = ? AND status IN ('completed','resigned') ORDER BY completed_at DESC LIMIT 100").bind(context.get("user").id).all<{ id: string; difficulty: string; player_score: number; computer_score: number; winner: number | null; started_at: string; completed_at: string | null; status: string }>();
  return context.json({ games: rows.results.map(row => ({ id: row.id, difficulty: row.difficulty, playerScore: row.player_score, computerScore: row.computer_score, result: row.winner === 0 ? "win" : row.winner === 1 ? "loss" : "draw", startedAt: row.started_at, completedAt: row.completed_at, status: row.status })) });
});

app.get("/api/stats", requireAuth, async context => {
  const summary = await context.env.DB.prepare("SELECT COUNT(*) AS games, SUM(CASE WHEN winner = 0 THEN 1 ELSE 0 END) AS wins, SUM(CASE WHEN winner = 1 THEN 1 ELSE 0 END) AS losses, AVG(player_score) AS average_score FROM games WHERE user_id = ? AND status IN ('completed','resigned')").bind(context.get("user").id).first<{ games: number; wins: number | null; losses: number | null; average_score: number | null }>();
  const byDifficulty = await context.env.DB.prepare("SELECT difficulty,COUNT(*) AS games,SUM(CASE WHEN winner = 0 THEN 1 ELSE 0 END) AS wins FROM games WHERE user_id = ? AND status IN ('completed','resigned') GROUP BY difficulty").bind(context.get("user").id).all<{ difficulty: string; games: number; wins: number | null }>();
  const games = summary?.games ?? 0; const wins = summary?.wins ?? 0; const losses = summary?.losses ?? 0;
  return context.json({ stats: { games, wins, losses, winRate: games ? Math.round(wins / games * 100) : 0, averageScore: Math.round(summary?.average_score ?? 0), byDifficulty: Object.fromEntries(byDifficulty.results.map(row => [row.difficulty, { games: row.games, wins: row.wins ?? 0 }])) } });
});

app.get("/api/games/:id", requireAuth, async context => {
  const row = await gameRow(context as AppContext, context.req.param("id"));
  if (!row) return context.json({ error: { code: "GAME_NOT_FOUND", message: "Game not found." } }, 404);
  return context.json({ game: sanitized(parseGame(row)) });
});

app.all("/api/*", context => context.json({ error: { code: "NOT_FOUND", message: "API route not found." } }, 404));

export default {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext) {
      const response = await app.fetch(request, env, executionContext);
      const headers = new Headers(response.headers);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      headers.set("X-Frame-Options", "DENY");
      headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      headers.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
      headers.set("Strict-Transport-Security", "max-age=31536000");
      if (request.url.includes("/api/")) {
        headers.set("Cache-Control", "no-store");
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }
      if (response.status !== 404 || !env.ASSETS) return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      const asset = await env.ASSETS.fetch(request);
      const resultHeaders = new Headers(asset.headers);
      for (const [key, value] of headers) if (!resultHeaders.has(key)) resultHeaders.set(key, value);
      return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers: resultHeaders });
  },
};
