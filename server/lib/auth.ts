import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context } from 'hono'
import { and, eq, lt, sql } from 'drizzle-orm'
import { getDb, schema } from '../db/client.js'
import { CSRF_COOKIE, SESSION_COOKIE, SESSION_TTL_DAYS, env } from './env.js'
import { hmac, keyedTokenHash, newId, randomToken, safeEqual } from './crypto.js'

export type SessionUser = {
  id: string
  email: string
  handle: string
  displayName: string
  bio: string
  avatarSeed: string
  isBot: boolean
  isAdmin: boolean
  createdAt: Date
}

declare module 'hono' {
  interface ContextVariableMap {
    user: SessionUser | null
    sessionId: string | null
    /** When this session's password was last confirmed. */
    reauthenticatedAt: number
  }
}

/** Cookie value is `sessionId.signature`; the DB only ever holds sessionId. */
function signSessionId(sessionId: string): string {
  return `${sessionId}.${hmac(sessionId, env.sessionSecret)}`
}

function readSessionId(raw: string | undefined): string | null {
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return null
  const sessionId = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)
  // The signature check is what stops a stolen database row from being enough:
  // a read of `sessions` yields ids, but only the cookie carries the signature.
  if (!safeEqual(signature, hmac(sessionId, env.sessionSecret))) return null
  return sessionId
}

export async function createSession(
  c: Context,
  userId: string,
  opts: { userAgent?: string } = {},
): Promise<{ sessionId: string; csrfToken: string }> {
  const db = getDb()
  const sessionId = newId()
  const csrfToken = randomToken(24)
  const csrfHash = keyedTokenHash(csrfToken, env.sessionSecret)
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000)

  await db.insert(schema.sessions).values({
    id: sessionId,
    userId,
    csrfHash,
    expiresAt,
    userAgent: (opts.userAgent ?? '').slice(0, 300),
  })

  setSessionCookies(c, sessionId, csrfToken, expiresAt)
  return { sessionId, csrfToken }
}

function setSessionCookies(
  c: Context,
  sessionId: string,
  csrfToken: string,
  expiresAt: Date,
): void {
  setCookie(c, SESSION_COOKIE, signSessionId(sessionId), {
    httpOnly: true,
    secure: env.useSecureCookies,
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  })
  // Readable by JS on purpose: this is the double-submit half of CSRF defence.
  setCookie(c, CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: env.useSecureCookies,
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  })
}

export async function destroySession(c: Context): Promise<void> {
  const db = getDb()
  const sessionId = readSessionId(getCookie(c, SESSION_COOKIE))
  if (sessionId) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId))
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  deleteCookie(c, CSRF_COOKIE, { path: '/' })
}

/** Rotates the session id while keeping the user signed in. Called on login. */
export async function rotateSession(c: Context, userId: string): Promise<string> {
  const db = getDb()
  const old = readSessionId(getCookie(c, SESSION_COOKIE))
  if (old) await db.delete(schema.sessions).where(eq(schema.sessions.id, old))
  const { csrfToken } = await createSession(c, userId, {
    userAgent: c.req.header('user-agent') ?? '',
  })
  return csrfToken
}

/**
 * Records that the account password was just confirmed. Sensitive changes
 * (saving bot settings, deleting the account) require a recent value here.
 */
export async function markReauthenticated(c: Context): Promise<void> {
  const db = getDb()
  const sessionId = c.get('sessionId')
  if (!sessionId) throw new HttpError(401, 'Sign in to continue')
  await db
    .update(schema.sessions)
    .set({ reauthenticatedAt: new Date() })
    .where(eq(schema.sessions.id, sessionId))
  c.set('reauthenticatedAt', Date.now())
}

export async function loadSession(c: Context): Promise<SessionUser | null> {
  const db = getDb()
  const sessionId = readSessionId(getCookie(c, SESSION_COOKIE))
  if (!sessionId) return null

  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
      reauthenticatedAt: schema.sessions.reauthenticatedAt,
      user: {
        id: schema.users.id,
        email: schema.users.email,
        handle: schema.users.handle,
        displayName: schema.users.displayName,
        bio: schema.users.bio,
        avatarSeed: schema.users.avatarSeed,
        isBot: schema.users.isBot,
        isAdmin: schema.users.isAdmin,
        createdAt: schema.users.createdAt,
      },
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, sessionId))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId))
    return null
  }

  // Refresh at most once a day to avoid a write on every single request.
  await db
    .update(schema.sessions)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        lt(sql`now() - interval '1 day'`, schema.sessions.lastSeenAt),
      ),
    )

  c.set('sessionId', sessionId)
  c.set('user', row.user)
  c.set('reauthenticatedAt', row.reauthenticatedAt?.getTime() ?? 0)
  return row.user
}

export function requireUser(c: Context): SessionUser {
  const user = c.get('user')
  if (!user) throw new HttpError(401, 'Sign in to continue')
  return user
}

/**
 * The owner is resolved from OWNER_EMAIL against the signed-in account on
 * every request. There is no client flag and no user-editable role.
 */
export function isOwner(user: SessionUser | null): boolean {
  if (!user) return false
  const owner = env.ownerEmail
  if (!owner) return false
  return user.email.trim().toLowerCase() === owner
}

export function isAdmin(user: SessionUser | null): boolean {
  return Boolean(user?.isAdmin) || isOwner(user)
}

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/**
 * Origin guard for requests that have no session yet, so no CSRF token exists.
 *
 * Sign-up, sign-in and the password-reset endpoints cannot use the double-submit
 * check because there is no session to hold a token. Without this they would
 * accept any cross-site POST, which is how a victim gets silently signed into
 * an attacker's account.
 *
 * Browsers always attach `Origin` to a cross-origin POST, and always attach
 * `Sec-Fetch-Site`, so either is enough to reject. A request with neither is a
 * non-browser client (curl, a server-to-server call, a native app) and is
 * allowed through, which keeps the API usable without loosening browser
 * protection. An `Origin` that is present but unlisted is always rejected.
 */
export function assertSameOrigin(c: Context): void {
  const fetchSite = c.req.header('sec-fetch-site')
  if (fetchSite === 'cross-site') {
    throw new HttpError(403, 'Request could not be verified. Reload the page and try again.')
  }

  const origin = c.req.header('origin')
  if (!origin) return

  if (!env.allowedOrigins.includes(origin)) {
    throw new HttpError(403, 'Request could not be verified. Reload the page and try again.')
  }
}

/** Verifies the double-submit CSRF token on state-changing requests. */
/**
 * Whether this request already proved itself with the scheduler secret.
 *
 * Checked at the router gate, so a machine caller is admitted before anything
 * asks for a session. Exposed separately from `assertOwnerOrMachine` so the
 * per-route guard knows whether it still owes a CSRF check.
 */
export function isMachineRequest(c: Context): boolean {
  const secret = env.cronSecret
  if (!secret) return false
  const header = c.req.header('authorization')
  if (!header) return false
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  return presented.length > 0 && safeEqual(presented, secret)
}

/**
 * Gate for routes that a platform scheduler calls as well as an owner.
 *
 * Two ways in, because the two callers are different things. A person signed in
 * as the owner brings a session and a CSRF token, exactly as in the browser. A
 * timer brings a bearer secret, because it has no session and must not be given
 * one: signing in as the owner to run a job would mean leaving the owner's
 * password somewhere a scheduler can read it.
 *
 * When no secret is configured the bearer path does not exist at all, rather
 * than comparing two empty strings, which would let anyone in.
 */
export async function assertOwnerOrMachine(c: Context): Promise<void> {
  const secret = env.cronSecret
  const header = c.req.header('authorization')

  if (secret && header) {
    if (isMachineRequest(c)) return
    throw new HttpError(403, 'This area is for the site owner.')
  }

  if (!isOwner(c.get('user'))) {
    throw new HttpError(403, 'This area is for the site owner.')
  }
  await assertCsrf(c)
}

export async function assertCsrf(c: Context): Promise<void> {
  const db = getDb()
  const sessionId = c.get('sessionId')
  if (!sessionId) throw new HttpError(401, 'Sign in to continue')

  const header = c.req.header('x-csrf-token')
  const cookie = getCookie(c, CSRF_COOKIE)
  if (!header || !cookie || !safeEqual(header, cookie)) {
    throw new HttpError(403, 'Request could not be verified. Reload the page and try again.')
  }

  const rows = await db
    .select({ csrfHash: schema.sessions.csrfHash })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1)

  if (!rows[0] || !safeEqual(keyedTokenHash(header, env.sessionSecret), rows[0].csrfHash)) {
    throw new HttpError(403, 'Request could not be verified. Reload the page and try again.')
  }
}

export async function purgeExpiredSessions(): Promise<void> {
  const db = getDb()
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()))
}
