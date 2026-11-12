# Security review — RETRAC Cribbage

## Authentication architecture

- Better Auth 1.7.21 runs in the existing Hono Worker and connects directly to the existing D1 binding.
- Better Auth owns email/password hashing (scrypt), sessions, credential accounts, verification tokens, password reset, and user deletion.
- Better Auth maps its user model to `users`; `display_name`, `email_verified`, `created_at`, `updated_at`, and application `preferences` remain in the existing table. Game foreign keys continue to reference the same user IDs.
- The Better Auth credential is stored in `account.password`; the legacy `password_hash` column is removed. Legacy custom `sessions` and `auth_tokens` tables were removed in a follow-up migration after the Better Auth cutover.
- The custom PBKDF2 hashing, session-cookie, password verification, and token flows are not retained as fallbacks.

## Controls

- Passwords require 12–128 characters. Better Auth's default scrypt hashing is exercised in the Cloudflare-compatible Worker runtime.
- Sessions are D1-backed, fixed at 30 days, and use the `__Secure-retrac_session` cookie with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain` attribute (host-only).
- Better Auth uses an explicit canonical base URL/trusted origin; Hono retains the same-origin origin guard, CORS allowlist, request-size limit, and security headers.
- Auth requests use a D1-backed per-IP, per-endpoint limiter. Game actions retain their D1 per-IP limiter. The `rate_limits` table is retained.
- Email verification and password reset use Better Auth callbacks and the existing Resend helper when configured. Registration does not require a verified email.
- Turnstile is optional and only enabled when both site and secret keys are configured.
- User deletion is performed by Better Auth with password confirmation; D1 cascades continue to remove the deleted account's games and related auth records.
- Game APIs continue to check the authenticated owner ID. Game rules and hidden card state remain server-authoritative.

## Database migration and recovery

Migrations are append-only. `users` and `games` are preserved; the existing `games.user_id` foreign key remains intact. New Better Auth tables are generated for the pinned version. Legacy session/token tables are removed only after the new implementation is deployed and validated. `rate_limits` remains.

The production database was inspected before migration. It contained no user, session, auth-token, or game rows; it had one rate-limit row. Both migrations were tested on an isolated copy containing representative user, active/completed game, legacy session/token, and rate-limit rows. The user/game IDs, game rows, and foreign keys survived; legacy auth tables were then dropped. A pre-migration SQL export passed SQLite `integrity_check` and `foreign_key_check`, and a D1 Time Travel bookmark was recorded. Production acceptance accounts and their games were deleted after the tests; no test user/game rows remain.

## Operational and privacy notes

- Better Auth session records may store the request IP and user-agent. The privacy notice reflects this.
- Resend and Turnstile secrets were absent before cutover. Email verification and password-reset delivery therefore remain unavailable until a verified Resend sender and `EMAIL_API_KEY`/`EMAIL_FROM` are configured. Turnstile is disabled rather than blocking registration.
- Better Auth telemetry is disabled. Auth errors should be monitored through sanitized Worker logs; do not log passwords, cookies, session tokens, verification tokens, or raw email payloads.
- D1 backup/Time Travel and retention procedures should be reviewed periodically. Deleting an account also deletes its saved games and history by design.

## Validation

Validation includes Better Auth 1.7.21's schema planner against the production schema copy, local migration tests with representative user/game rows and foreign-key checks, 26 unit tests, both Worker/React E2E tests locally and against production, a production build, and `npm audit` (zero vulnerabilities). Production sign-up and scrypt password verification succeeded in the deployed Worker. No email-delivery or Turnstile credentials were present, so reset/verification delivery and CAPTCHA remain unavailable until configured.
