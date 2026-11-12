import { env, waitUntil } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { captcha } from "better-auth/plugins";
import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import { sendEmail, type AppVariables, type UserRow } from "./security";

const workerEnv = env as unknown as Env;
const baseURL = workerEnv.APP_ORIGIN ?? "https://crib.retrac.ca";
const emailConfigured = Boolean(workerEnv.EMAIL_API_KEY && workerEnv.EMAIL_FROM);
const turnstileConfigured = Boolean(workerEnv.TURNSTILE_SECRET_KEY && workerEnv.TURNSTILE_SITE_KEY);

function deliverEmail(to: string, subject: string, text: string) {
  if (!emailConfigured) return;
  waitUntil(sendEmail(workerEnv, to, subject, text).then(sent => {
    if (!sent) console.error("Better Auth email delivery failed");
  }));
}

export const auth = betterAuth({
  appName: "RETRAC Cribbage",
  database: workerEnv.DB,
  secret: workerEnv.BETTER_AUTH_SECRET,
  baseURL,
  trustedOrigins: [baseURL],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    requireEmailVerification: false,
    revokeSessionsOnPasswordReset: true,
    ...(emailConfigured ? {
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
        deliverEmail(user.email, "Reset your RETRAC Cribbage password", `Use this one-time link to choose a new password:\n\n${url}`);
      },
    } : {}),
  },
  emailVerification: {
    sendOnSignUp: emailConfigured,
    sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
      deliverEmail(user.email, "Verify your RETRAC Cribbage email", `Confirm your email with this link:\n\n${url}`);
    },
  },
  user: {
    modelName: "users",
    fields: {
      name: "display_name",
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    additionalFields: {
      preferences: {
        type: "string",
        required: true,
        defaultValue: '{"sound":true,"showHints":true}',
        input: false,
        returned: false,
      },
    },
    deleteUser: { enabled: true },
    validateUserInfo: ({ user, source }) => {
      if (source.action !== "create-user") return;
      const name = typeof user.name === "string" ? user.name : "";
      if (name.trim().length < 2 || name.length > 40 || name !== name.trim()) {
        return {
          error: "invalid_name",
          errorDescription: "Name must be between 2 and 40 characters.",
        };
      }
    },
  },
  session: {
    expiresIn: 30 * 24 * 60 * 60,
    disableSessionRefresh: true,
    freshAge: 5 * 60,
  },
  rateLimit: {
    // The Hono auth middleware uses the existing atomic, D1-backed limiter.
    enabled: false,
  },
  plugins: turnstileConfigured ? [captcha({
    provider: "cloudflare-turnstile",
    secretKey: workerEnv.TURNSTILE_SECRET_KEY!,
    endpoints: ["/sign-up/email"],
  })] : [],
  advanced: {
    useSecureCookies: true,
    ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    // The pinned schema is checked with Better Auth's migration planner and D1
    // migrations; avoid doing schema introspection on live requests.
    database: { generateId: "uuid", validateSchema: false },
    cookies: {
      session_token: {
        name: "retrac_session",
        attributes: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
      },
    },
  },
});

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (context, next) => {
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) return context.json({ error: { code: "UNAUTHENTICATED", message: "Please log in to continue." } }, 401);

  const user = await context.env.DB.prepare(
    "SELECT id,email,display_name,email_verified,preferences,created_at FROM users WHERE id = ? LIMIT 1",
  ).bind(session.user.id).first<UserRow>();
  if (!user) return context.json({ error: { code: "UNAUTHENTICATED", message: "Please log in to continue." } }, 401);

  context.set("user", user);
  await next();
};
