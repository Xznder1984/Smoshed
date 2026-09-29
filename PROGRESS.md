# Smoshed — Progress Log

Status legend: `done` · `in progress` · `todo` · `blocked (needs owner input)`

`npm run verify` is green: typecheck, lint, 52 unit tests across 5 files, WCAG
contrast over 24 token pairs, a source secret scan, a production build, and a
secret scan of the built output. The database-backed suite is separate and
currently passes 49 tests across 3 files: `npm run test:e2e`.

## Phase 0 — Machine, accounts, and toolchain — done

- Node `v22.20.0`, npm `11.19.0`, git `2.51`.
- Vercel CLI `61.0.0` installed globally; authenticated as `xanderrazeralbarr-1274`.
- `neonctl` `6.3.0` installed globally.
- Neon MCP added to `C:\Users\User\.config\opencode\opencode.json` using
  `Bearer {env:NEON_API_KEY}`. Existing plugins and MCP servers untouched.
  Backup: `C:\Users\User\.config\opencode\opencode.json.smoshed-backup-20260929-145901`.
- 45 Vercel skills and 8 Neon skills installed under `C:\Users\User\.agents\skills`.
- Git initialised on `main` with remote `https://github.com/Xznder1984/Smoshed.git`.
  No commit or push yet.

## Phase 1 — Neon database — done

- Project `smoshed` created: id `little-block-85619914`, region `aws-us-west-2`,
  default branch `br-cold-credit-arw638gk`.
- The connection string printed by the create command was treated as leaked and
  the owner password was rotated immediately. The working value lives only in
  the gitignored `.env.local`.
- Schema `server/db/schema.ts`: 17 tables, 4 enums, covering accounts, sessions,
  posts, replies, likes, reposts, bookmarks, follows, blocks, mutes,
  notifications, reports, bot settings/jobs/audit, rate limits, login attempts.
- Migration `drizzle/0000_true_chimera.sql` applied. The first run stopped
  part-way through index creation, leaving the journal empty; the idempotent
  runner in `scripts/migrate.ts` finished it additively. No table was dropped
  and no data was deleted.
- Migration `drizzle/0001_seed_bot_and_reauth.sql` applied:
  - `sessions.reauthenticated_at` — server-side record of the last password
    confirmation, required before saving bot settings or deleting an account.
  - `@smosh` seeded as user id `smosh-bot`, with an Argon2id hash of a discarded
    random value so the account can never be signed into.
- Migration `drizzle/0002_dazzling_johnny_storm.sql` applied: adds the missing
  unique constraint on `login_attempts.scope` and the `reauthenticated_at`
  column idempotently. See the login bug in Phase 4 for why it was needed.

## Phase 2 — Backend — done

- All implementation lives in `server/`, not `api/`. Vercel's Hobby plan allows
  12 serverless functions, and the original split of one file per route group
  exceeded it, so the routes were consolidated behind the single function
  `api/index.ts`. See Phase 5.
- `server/app.ts` — Hono app, same-origin CORS, security headers, per-request
  session resolution, uniform JSON errors, `/api/health` and `/api/health/db`.
- Auth: Argon2id passwords, server-side sessions in an httpOnly cookie, CSRF
  double-submit, 30-day TTL, re-authentication before sensitive changes.
- Rate limiting: fixed windows in `rate_limits`, per-IP plus per-account, and
  login lockout recorded in `login_attempts`.
- Posts, replies, quotes, likes, reposts, bookmarks, follows, blocks, mutes,
  notifications, search, reports, and moderation routes.
- Visibility is enforced in SQL: a blocked or muted author is filtered out of
  every timeline, profile, thread, and search result, not hidden in the client.
  The rule lives once, in `server/lib/visibility.ts`, so a new timeline cannot
  forget one of the three cases.
- Bot: provider fallback (Groq → NVIDIA → Ollama), prompt-injection-resistant
  system prompt, output sanitising, loop prevention, per-user and global rate
  limits, queued jobs with audit trail.
- All list endpoints use keyset pagination (`server/lib/pagination.ts`) rather
  than offsets, so a polling feed neither skips nor repeats a post when
  something new arrives. The cursor is `(createdAt, id)` because timestamps
  collide.
- Server imports carry explicit `.js` extensions with `NodeNext`, so the same
  sources run under `tsx` locally and as an ESM serverless bundle on Vercel.

### Security decisions taken

- Password reset no longer returns a link in the response. Without a mail
  provider the request is accepted and dropped, so no working takeover link
  ever reaches the browser or the logs. `server/lib/mailer.ts` is the single
  place to wire up a real provider.
- Owner-only operational routes (`/api/owner/bot/run`, `/api/owner/maintenance`)
  accept either an owner session or a `CRON_SECRET` bearer token. A scheduler
  holds no session, and giving it one would mean leaving the owner's password
  somewhere a timer can read it. With no secret configured the bearer path does
  not exist at all rather than matching two empty strings.
- `@smosh` can be blocked, so blocking it is an effective way to stop its
  replies.
- The `DUMMY_PASSWORD_HASH` used for unknown-email sign-ins is a real Argon2id
  digest, so a failed lookup costs the same as a wrong password.
- Sessionless auth endpoints check the request origin directly, because a
  double-submit CSRF token does not exist yet when there is no session. A
  request with no `Origin` is allowed, so non-browser clients still work.
- Login, reauth, and current-password fields accept any non-empty string up to
  200 characters, while signup enforces the strong policy. Validating a *known*
  password against the signup policy turned every legacy or weak password into
  a 422 that also revealed whether the account existed.

## Phase 3 — Frontend — done

Vite/React/TypeScript app in `src/`, Catppuccin Mocha with a cyan accent,
self-hosted Public Sans, inline SVG icons, generated avatars, and no runtime
third-party font or CDN requests.

- Pages: home (following/latest), thread, profile, explore, notifications,
  bookmarks, settings, bot settings, sign in, sign up, forgot/reset password,
  terms, privacy, and not found.
- API contracts were audited route by route against the frontend and aligned.
  Cursor-paginated endpoints return `{ items, nextCursor }`; search and
  suggestions keep their named keys; profile viewer state is nested under
  `person.viewer`; bot settings are flat.
- Reply and quote are wired from every post card through
  `src/hooks/useComposerContext.ts`, so neither button is inert. They share one
  slot because the composer is one box and a reply and a quote are different
  intents. An audit of every `<button>` in the app found no control without an
  action and no icon-only control without an accessible name.
- Auth context split so the provider component and the hook are separate
  modules, which is what React Fast Refresh needs.

### Bugs found and fixed while testing

- `PostBody` deleted the character in front of every mid-sentence mention, so
  "hey @smosh" rendered as "hey@smosh". The mention regex includes the preceding
  character to avoid reading an email address as a mention, and the code was
  consuming the whole match instead of skipping past it.
- The mention pattern allowed a 30-character handle while the real limit is 20,
  so a longer token was truncated into a link to a different, shorter account.
  The bound is now `MAX_HANDLE_LENGTH` with a `(?![\w])` guard.
- `?limit=` with an empty value became a limit of 1 rather than the default,
  silently truncating feeds.
- The post delete button was offered to admins, but the server only allows the
  author, so it always failed.
- `--subtle` and the control border failed WCAG AA against the surfaces they
  sit on. Tokens were strengthened and all 24 configured pairs now pass.

## Phase 4 — Tests — done

Unit tests (`npm test`, 5 files, 52 tests):

- `tests/pagination.test.ts` — cursor round-trip, limit clamping, rejection of
  tampered cursors, and over-fetch trimming.
- `tests/crypto.test.ts` — Argon2id verification, malformed-hash handling, token
  entropy, keyed hashing, and length-mismatch-safe comparison.
- `tests/post-body.test.ts` — mention and link segmentation, the email-address
  guard, the handle-length bound, and character-loss checks on adversarial input.

Database-backed tests (`npm run test:e2e`, 3 files, 49 tests). Excluded from
`npm test` because they need `DATABASE_URL` and write rows. A preview deployment
cannot be reached by an unauthenticated request because Vercel deployment
protection returns an HTML wall, so the app is driven in-process through
`server/app.ts`, the exact module the serverless function serves.

- `tests/e2e/api.test.ts` — signup, origin and CSRF enforcement, sessions,
  posts, threads, likes, replies, quotes, profiles, bookmarks, notifications,
  export, password changes, reauth, owner gates, forged cookies, and deletion.
  Signs up a real account and deletes it through the deletion endpoint, so a run
  that gets as far as signing up leaves the database as it found it.
- `tests/e2e/abuse-controls.test.ts` — 401 for a wrong password and for an
  unknown account, lockout after repeated failures, `Retry-After`, rate-limit
  headers, cross-origin login, and the two scheduled-route auth paths.
- `tests/e2e/bot-loop.test.ts` — all four loop conditions in `checkLoop`
  (disabled, self-trigger, bot-authored trigger, already-replied-in-thread,
  depth limit, blocked user, corrupt cycle) and the reply sanitiser, without
  calling any provider.

Rate limits are stored in the database keyed on client address, so each run
claims its own address. A fixed address would spend the budget on the first run
and every later run would be answered 429 before reaching the behaviour under
test. The limiter itself is never weakened.

### Bugs the database-backed tests found

- A wrong password returned 500, not 401. `registerFailure` upserts on
  `login_attempts.scope`, but the column had no unique constraint, so the
  `ON CONFLICT` had nothing to match. Fixed in the schema, generated migration
  `0002`, and applied.
- Like and repost responses returned a count read before the toggle, so
  unliking reported the old number. Toggles now return the database's own
  `RETURNING` value.
- The self-mention guard in `sanitizeBotReply` could never fire, because it ran
  after the mention-stripping pass had already removed the mention. The check
  now runs first, so a reply that tries to ping the bot is dropped rather than
  silently edited.
- `/api/posts/:id/thread` collected only direct children, so a reply to a reply
  vanished from the thread despite the comment promising every descendant.
  Replaced with a recursive CTE capped at 50 levels.
- `/api/health/db` and `/api/owner/stats` reported `0` for every count,
  permanently. The Neon HTTP driver resolves `execute` to a wrapper whose rows
  live under `.rows`, and the code indexed the wrapper as an array. Nothing
  threw, so the numbers were simply always zero. All raw statements now go
  through `executeRows` in `server/db/client.ts`, which has one place for that
  mistake to be made.

### SQL review

Every `sql` template in the server was reviewed. All interpolations are bound
parameters or Drizzle schema identifiers. Three sites in `server/routes/admin.ts`
built `IN (...)` lists with `sql.raw` and string-concatenated ids; the values
are validated against real rows at report creation so they were not exploitable,
but they are now `inArray`, which removes the pattern. Search escapes `%` and
`_` in `LIKE` patterns consistently with its `ESCAPE` clause.

### `npm audit` — 4 moderate advisories, deliberately not "fixed"

All four are one advisory (GHSA-67mh-4wv8-2f99) in `esbuild <=0.24.2`, reached
only through `@esbuild-kit/esm-loader` inside `drizzle-kit`. It affects the
migration tool's dev server, which is not deployed: nothing in `dist/` or the
serverless function contains it.

`npm audit fix --force` offers to install `drizzle-kit@0.18.1`, which is both a
downgrade from the installed 0.31.11 and a breaking config change. The
vulnerable range covers every published version up to 1.0.0-beta, so the only
alternative is a release candidate. Leaving 0.31.11 is the safer choice, and the
advisory is not reachable in production.

## Phase 5 — Deployment — done for preview, blocked for production

- Vercel project `xanders-projects-4a9138b4/smoshed` created. `vercel.json`
  rewrites `/api` and `/api/(.*)` to the single `api/index.ts` function, with an
  SPA fallback for everything else. An `api/[...path]` catch-all was tried and
  removed: it deployed but did not match.
- Current preview: `smoshed-lnbcm4huf-xanders-projects-4a9138b4.vercel.app`.
  Each deploy gets a new URL.
- `DATABASE_URL`, `SESSION_SECRET`, `GROQ_API_KEY`, `NVIDIA_API_KEY`,
  `OLLAMA_API_KEY`, and `CRON_SECRET` are set as hidden secrets for both Preview
  and Production. Values were never printed. Note that `vercel env pull` reports
  secret values as the literal `[SENSITIVE]`, which is not a corrupted value.
- Verified live through `vercel curl`: health, database reachability, session
  returning `null` when signed out, the paginated feed, user suggestions, hidden
  bot settings, owner routes refusing a non-owner, and unknown paths returning
  Hono JSON 404s. The bearer path was confirmed end to end: the correct secret
  runs maintenance, a wrong or missing one is refused.
- Deployment protection is on, so an unauthenticated browser request gets a Vercel
  HTML wall rather than the app. `vercel curl` or an authenticated session is
  required to test anything.
- Production deployment is deliberately not done: it needs explicit approval and
  `OWNER_EMAIL`.

## Phase 6 — Legal, design, and launch — todo

- `OWNER_EMAIL` is empty, so owner-only screens are unreachable. There is no
  database role for it and no way for a user to grant themselves access.
- Still needed from the owner: contact email, operator/legal name, minimum
  signup age, production domain, and a decision on the mail provider. The legal
  pages say a detail is pending rather than inventing one.
- Image uploads omitted: no Vercel Blob store. Avatars are generated from
  `avatarSeed`.
- Automated contrast checking is in place. A real browser pass with axe and a
  responsive check still need an authenticated session, and a Lighthouse run
  wants a production build rather than a protected preview.

## Open questions for the owner

1. What is `OWNER_EMAIL`? Owner-only bot settings cannot be tested without it.
2. Which transactional email provider should handle password resets? Resend is
   the shape already built against; any other needs `server/lib/mailer.ts`.
3. Provider model IDs in `server/lib/bot/config.ts` still need checking against
   current Groq, NVIDIA NIM, and Ollama Cloud documentation.
4. Should `@smosh` be an ordinary followable account, or unfollowable?
5. ~~The `DATABASE_URL` in use is the Neon owner role.~~ **Done.** Created
   `smoshed_runtime` role with `SELECT, INSERT, UPDATE, DELETE` on all 17
   tables, no DDL. `DATABASE_URL` in Vercel now points at the runtime role.
   Local `.env.local` keeps the owner role for migrations.
6. Should a scheduler call `/api/owner/bot/run` on a fixed interval, and if so
   how often? The rate limits in bot settings bound the damage, but nothing
   currently invokes the queue.
