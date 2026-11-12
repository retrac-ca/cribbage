export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  APP_ORIGIN?: string;
  BETTER_AUTH_SECRET: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
}
