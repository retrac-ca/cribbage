import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "./env";

const encoder = new TextEncoder();

export async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export interface UserRow { id: string; email: string; display_name: string; email_verified: number; preferences: string; created_at: string }
export interface AppVariables { user: UserRow }
export type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

export function originGuard(): MiddlewareHandler<{ Bindings: Env }> {
  return async (context, next) => {
    const method = context.req.method.toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return next();
    const origin = context.req.header("Origin");
    const requestUrl = new URL(context.req.url);
    const expected = context.env.APP_ORIGIN ?? requestUrl.origin;
    const localDevOrigin = ["localhost", "127.0.0.1"].includes(requestUrl.hostname) && (!origin || origin === "http://localhost:5173");
    if (!localDevOrigin && (!origin || origin !== expected)) return context.json({ error: { code: "INVALID_ORIGIN", message: "The request origin could not be verified." } }, 403);
    return next();
  };
}

export async function withinRateLimit(context: AppContext, action: string, max: number, windowSeconds = 900): Promise<boolean> {
  const ip = context.req.header("CF-Connecting-IP") ?? "local";
  const bucket = `${action}:${await sha256(ip)}`;
  const now = Math.floor(Date.now() / 1000);
  await context.env.DB.prepare("DELETE FROM rate_limits WHERE window_started < ?").bind(now - 86_400).run();
  const row = await context.env.DB.prepare(
    "INSERT INTO rate_limits(bucket,count,window_started) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN window_started <= ? THEN 1 ELSE count+1 END, window_started=CASE WHEN window_started <= ? THEN excluded.window_started ELSE window_started END RETURNING count",
  ).bind(bucket, now, now - windowSeconds, now - windowSeconds).first<{ count: number }>();
  return (row?.count ?? max + 1) <= max;
}

export async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<boolean> {
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, text }), signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch { return false; }
}

export function turnstileSiteKey(env: Env) { return env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY ? env.TURNSTILE_SITE_KEY : ""; }
