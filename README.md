<div align="center">

# Smoshed

*A small threaded social site with an AI bot that answers posts.*

[![Stack](https://img.shields.io/badge/stack-Vite%20%2B%20React%20%2B%20Hono%20%2B%20Neon-6366f1?style=for-the-badge)](#stack)
[![Tests](https://img.shields.io/badge/tests-191%20passing-22c55e?style=for-the-badge)](#tests)
[![License](https://img.shields.io/badge/license-MIT-64748b?style=for-the-badge)](#license)

</div>

---

The bot, **`@smosh`**, replies to threads that mention it. It has a provider
fallback (Groq → NVIDIA NIM → Ollama Cloud) and a set of structural guards so it
cannot end up talking to itself.

See [PROGRESS.md](PROGRESS.md) for the running log of what is built, what was
broken, and what is still outstanding.

---

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| **Frontend** | Vite · React · TypeScript | No runtime CDN requests; fonts and icons are bundled or inline. |
| **Backend** | Hono, one serverless function | All source in `server/`, mounted at `api/index.ts`. |
| **Database** | Postgres on Neon | HTTP driver — a cold start opens no TCP connection. |
| **Validation** | Zod | At the route boundary, before any logic runs. |
| **Auth** | Argon2id · sessions · CSRF | Server-side sessions in an httpOnly cookie, double-submit CSRF. |

---

## Quick start

```bash
npm install
cp .env.example .env.local     # Windows: copy .env.example .env.local
npm run db:migrate
npm run dev
```

`.env.example` documents every variable the app reads and why. The minimum to
start is `DATABASE_URL` and `SESSION_SECRET`; without `OWNER_EMAIL` the
owner-only features stay closed, which is the safe default.

`.env.local` is gitignored. Do not commit real values — `npm run secrets:scan`
checks the tree for accidents.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Client and API together, in watch mode. |
| `npm run build` | Type-check and produce `dist/`. |
| `npm run preview` | Serve the built output. |
| `npm test` | Unit tests. No database needed. |
| `npm run test:e2e` | Database-backed tests. Writes rows and cleans up after itself. |
| `npm run verify` | Everything: typecheck, lint, unit tests, contrast, secret scans, build. |
| `npm run check` | The same as `verify` minus the build and the built-output scan. |
| `npm run db:migrate` | Apply pending migrations. |
| `npm run db:generate` | Write a migration from a schema change. |
| `npm run db:studio` | Browse the database. |
| `npm run db:census` | Row counts, read only. |
| `npm run db:verify` | Check the schema state the app depends on. Read only. |
| `npm run contrast` | WCAG contrast for every colour token pair. |
| `npm run secrets:scan` | Search the source for secret-shaped strings. |
| `npm run secrets:bundle` | The same check against `dist/`. |

`npm run verify` is the one to run before pushing.

---

## Tests

**191 tests, all passing.**

`npm test` covers the pure logic: cursor encoding and clamping, password
hashing, and the mention parser.

`npm run test:e2e` is separate because it needs `DATABASE_URL` and writes rows.
It drives the Hono app in-process against the real database — the same module
the serverless function serves — and it signs up a real account that it deletes
at the end. It covers the API surface, the abuse controls, and the bot's loop
prevention. Because rate limits are stored in the database keyed on client
address, each run claims its own address; the limiter is never weakened for
testing.

---

## Deployment

```bash
vercel deploy          # preview
vercel --prod          # production
```

`vercel.json` rewrites `/api` and `/api/(.*)` to `api/index.ts`, and falls back
to `index.html` for client-side routes. The function limit of the Hobby plan is
why all backend source lives in `server/` behind that single entry point rather
than in one file per route group.

Set every secret in the Vercel dashboard or with `vercel env add`, for both the
Preview and Production targets. Two notes from doing this:

- `vercel env pull` writes the literal string `[SENSITIVE]` for variables
  marked Secret. That is the intended behaviour, not a corrupted value.
- Values added by piping into `vercel env add` on PowerShell can be mangled.
  Pass `--value` instead.

### Scheduled routes

`CRON_SECRET` guards the two routes a scheduler calls:

```
POST /api/owner/bot/run
POST /api/owner/maintenance
```

Send it as `Authorization: Bearer <CRON_SECRET>`. The owner can also trigger
both from the browser with their own session. With no secret configured the
bearer path does not exist, so a scheduled call has to be an owner session.

Deployment protection is enabled, so an unauthenticated request receives a
Vercel HTML wall rather than the app. Test a protected deployment with
`vercel curl`, or with a signed-in browser session.

---

## Configuration

The full annotated list is in [.env.example](.env.example). The short version:

### Server-only

Never sent to a browser.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon pooled connection string. **Required.** |
| `SESSION_SECRET` | Signs session cookies. **Required.** Changing it signs everyone out. |
| `OWNER_EMAIL` | The one account allowed into owner routes. Empty means closed. |
| `GROQ_API_KEY` | Groq provider. Optional. |
| `NVIDIA_API_KEY` | NVIDIA NIM provider. Optional. |
| `OLLAMA_API_KEY` | Ollama Cloud provider. Optional. |
| `RESEND_API_KEY` | Password reset delivery. Optional. |
| `MAIL_FROM` | Verified sender for reset mail. Optional. |
| `CRON_SECRET` | Bearer token for the scheduled routes above. |
| `APP_URL` | Public address. Comma-separated for several hosts, first one canonical. |

### Public

Anything named `VITE_` is inlined into the client bundle at build time and is
readable by anyone who loads the site. **Never put a credential in one.**

| Variable | Purpose |
| --- | --- |
| `VITE_CONTACT_EMAIL` | Shown on the legal and contact pages. |
| `VITE_OPERATOR_NAME` | The person or company running the site. |
| `VITE_LEGAL_ENTITY` | Registered legal entity, if it differs from the operator. |
| `VITE_JURISDICTION` | Governing law or country of operation. |
| `VITE_MINIMUM_AGE` | Minimum age to hold an account, as a number. |
| `VITE_LEGAL_UPDATED` | Date the legal pages were last revised. |
| `VITE_MAIL_CONFIGURED` | Set to exactly `"true"` when mail is configured. |

The legal pages render a "still pending" line for anything left blank rather
than inventing a value, so an empty file is honest but not finished.

---

## Layout

```
api/index.ts          The only serverless function
server/app.ts         Hono app, middleware, error handling, health
server/routes/        Route groups
server/lib/           Auth, crypto, sanitising, search, visibility, bot
server/db/            Drizzle client and schema
src/                  React app
tests/                Unit tests
tests/e2e/            Database-backed tests
scripts/              Migrations, verification, maintenance utilities
drizzle/              Generated migrations
```

---

## Known gaps

- The app runs on the Neon owner role. Production wants a least-privilege
  runtime role and a separate migration credential.
- Password reset cannot deliver mail until a provider and sender are set.
- Image uploads are not implemented; avatars are generated from a seed.
- No browser-level accessibility or responsive audit has been run.

---

## License

MIT
