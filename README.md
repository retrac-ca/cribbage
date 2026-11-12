# RETRAC Cribbage

A responsive, single-player two-person cribbage game against local computer opponents, hosted as a Cloudflare Worker with D1 persistence. The Worker is authoritative for accounts, legal actions, scoring, game outcomes, and saved progress.

## Stack and layout

- `src/engine/` — framework-independent cards, rules, scoring, and computer strategy.
- `src/worker/` — Hono API, authentication, D1 persistence, and Cloudflare bindings.
- `src/client/` — React, TypeScript, Vite, Tailwind CSS, and the responsive game UI.
- `migrations/` — ordered SQL migrations for Better Auth, users, games, and rate limits.
- `e2e/` — Playwright user journeys against a local Wrangler Worker and D1 database.

The game engine represents both seats independently of the UI. Computer strategy receives only its own cards and public game information. The private deck, opponent's hand, and crib remain in D1 and are omitted from normal API responses. Each mutation requires the latest revision and is saved with a conditional D1 update.

### Authentication

Better Auth handles email/password authentication, scrypt password hashing, database-backed sessions, and account operations. It runs in the existing Hono Worker and uses Cloudflare D1 directly. The Better Auth user model maps to the existing `users` table so `games.user_id` continues to reference the same stable user ID. Application preferences and game ownership remain application-managed.

The production Worker uses `https://crib.retrac.ca` as its explicit origin and a high-entropy `BETTER_AUTH_SECRET` stored as a Cloudflare Worker secret. Passwords are 12–128 characters; sessions last 30 days without sliding refresh. Better Auth uses secure, HTTP-only, same-site cookies. Rate limiting is backed by the existing D1 `rate_limits` table.

Email verification and password-reset messages use Resend when `EMAIL_API_KEY` and `EMAIL_FROM` are configured. They are not configured in the current production account, so account recovery email cannot currently be delivered. Registration remains available and email verification is not required for play. Turnstile is optional and is used only when both its site and secret keys are configured.

## Requirements

- Node.js 22 LTS (Node 22.23.2 was used for validation).
- npm 10 or newer.
- Wrangler 4 (Wrangler 4.160.0 was used for validation).

## Run locally

```sh
npm install
npm run db:migrate:local
npm run dev
```

Open **http://localhost:5173**. Vite serves the React UI and proxies `/api` to the local Wrangler Worker on port 8787. Local D1 data is kept under the ignored `.wrangler/` directory. The default local setup needs no Cloudflare account or secrets.

To run the built Worker/assets together:

```sh
npm run build
npm run preview
```

### Tests

```sh
npm test
npx playwright install chromium   # one-time browser setup
npm run test:e2e
npm audit
```

The E2E command applies local-only migrations and clears only the local rate-limit buckets before starting the app. It does not clear local users/games and never runs a remote migration. The end-to-end journey registers, resumes, and completes a full game; checks invalid/stale actions and private game ownership; verifies history, statistics, login/logout, account deletion, and a narrow viewport.

## Cloudflare configuration

The existing Worker is `cribbage`, the production domain is `crib.retrac.ca`, and `DB` is bound to the existing `retrac-cribbage` D1 database (`29fe0dcd-a2a5-477a-b0af-9a5c20deadea`). Do not create a replacement Worker or database.

`wrangler.toml` binds `DB` to D1 and `ASSETS` to Vite's `dist/` output. The custom domain remains attached to the existing Worker. Compatibility date `2026-11-10` enables Cloudflare's Node.js compatibility APIs; an additional `nodejs_compat` flag is not required for this date.

Better Auth's D1 schema is maintained as checked-in, sequential SQL migrations. Do not rewrite historical migrations or run ad hoc schema changes outside Wrangler migrations. Before applying a production migration, create and verify an export and record the current D1 Time Travel bookmark.

| Setting | Purpose / handling |
| --- | --- |
| `APP_ORIGIN` | Canonical origin, set to `https://crib.retrac.ca` in Wrangler vars |
| `BETTER_AUTH_SECRET` | Required high-entropy secret; configure with `npx wrangler secret put BETTER_AUTH_SECRET` |
| `TURNSTILE_SITE_KEY` | Optional public widget key |
| `TURNSTILE_SECRET_KEY` | Optional server-side Turnstile secret |
| `EMAIL_FROM` | Optional verified Resend sender |
| `EMAIL_API_KEY` | Optional Resend secret |

For local development, copy `.dev.vars.example` to `.dev.vars` and supply a unique local `BETTER_AUTH_SECRET`. Never commit `.dev.vars` or real credentials. Email and Turnstile secrets are optional; without the Resend values, account recovery emails cannot be delivered.

Deployment commands (production changes; use only after backup and migration review):

```sh
npm run build
npm run db:migrate:remote
npx wrangler deploy
```

## API and saved data

The Worker exposes Better Auth endpoints under `/api/auth/*`, protected `/api/me`, game creation and retrieval, revision-checked game actions, history, and statistics. Cookies are never stored by frontend JavaScript. Better Auth enforces origin protections; application writes use same-origin checks, ownership checks, JSON validation, and D1 prepared statements.

One active game is allowed per account. A serialized authoritative game state and revision are saved after each action; completed and resigned games remain in history. Deleting an account cascades through Better Auth's accounts, sessions, verification records, and the user's games. Rate-limit records are periodically expired; game requests also have a per-IP D1 limit.

## Privacy, terms, and launch review

The `/privacy` and `/terms` pages are plain-language drafts, not legal advice or a claim of compliance. Before public launch, add an operator contact address and have these documents reviewed for the applicable jurisdictions. Decide whether email verification must be mandatory, configure and test email delivery and Turnstile, review Cloudflare account/domain/security settings, and arrange backups/retention and operational monitoring for D1. Multiplayer, passwordless/social sign-in, and email-address changes are not part of this release.
