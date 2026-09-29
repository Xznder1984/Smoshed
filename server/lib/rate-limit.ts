import type { Context } from 'hono'
import { and, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../db/client.js'
import { HttpError } from './auth.js'
import { hmac } from './crypto.js'
import { env } from './env.js'

type Window = { limit: number; seconds: number }

/** Named budgets so limits live in one readable place. */
export const LIMITS = {
  login: { limit: 8, seconds: 900 },
  signup: { limit: 5, seconds: 3600 },
  passwordReset: { limit: 4, seconds: 3600 },
  post: { limit: 40, seconds: 3600 },
  like: { limit: 180, seconds: 3600 },
  follow: { limit: 60, seconds: 3600 },
  search: { limit: 120, seconds: 3600 },
  bot: { limit: 12, seconds: 3600 },
  write: { limit: 300, seconds: 60 },
  magicLink: { limit: 5, seconds: 3600 },
} as const satisfies Record<string, Window>

export type LimitName = keyof typeof LIMITS

export function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return c.req.header('x-real-ip') ?? 'unknown'
}

/**
 * Rate keys are hashed so a raw IP or email never lands in the table, and so a
 * key is safe to log for debugging.
 */
function makeKey(scope: string, identity: string): string {
  return hmac(`${scope}:${identity}`, env.sessionSecret)
}

export type RateResult = {
  allowed: boolean
  remaining: number
  /** Seconds until the current window resets. */
  retryAfter: number
}

/**
 * Fixed-window counter in Postgres. Stateless functions need shared state, and
 * Neon is already the dependency, so no extra service is added.
 *
 * The upsert increments only when the row is still inside its window; an
 * expired row is reset to 1 with a fresh window.
 */
export async function consume(
  scope: string,
  identity: string,
  window: Window,
  cost = 1,
): Promise<RateResult> {
  const db = getDb()
  const key = makeKey(scope, identity)
  const now = new Date()
  const windowStart = new Date(Math.floor(now.getTime() / (window.seconds * 1000)) * window.seconds * 1000)
  const expiresAt = new Date(windowStart.getTime() + window.seconds * 1000)

  const rows = await db
    .insert(schema.rateLimits)
    .values({ scope: key, bucket: scope, windowStart, count: cost, expiresAt })
    .onConflictDoUpdate({
      target: [schema.rateLimits.scope, schema.rateLimits.bucket],
      set: {
        count: sql`case when ${schema.rateLimits.windowStart} < ${windowStart}
                    then ${cost}
                    else ${schema.rateLimits.count} + ${cost} end`,
        windowStart: sql`case when ${schema.rateLimits.windowStart} < ${windowStart}
                          then ${windowStart}
                          else ${schema.rateLimits.windowStart} end`,
        expiresAt: sql`greatest(${schema.rateLimits.expiresAt}, ${expiresAt})`,
      },
    })
    .returning({ count: schema.rateLimits.count, windowStart: schema.rateLimits.windowStart })

  const count = rows[0]?.count ?? cost
  const reset = rows[0]?.windowStart ?? windowStart
  const retryAfter = Math.max(1, Math.ceil((reset.getTime() + window.seconds * 1000 - now.getTime()) / 1000))

  return {
    allowed: count <= window.limit,
    remaining: Math.max(0, window.limit - count),
    retryAfter,
  }
}

/** Throws a 429 with Retry-After when the budget is spent. */
export async function enforce(
  c: Context,
  name: LimitName,
  identity: string,
  cost = 1,
): Promise<void> {
  const result = await consume(name, identity, LIMITS[name], cost)
  c.header('X-RateLimit-Limit', String(LIMITS[name].limit))
  c.header('X-RateLimit-Remaining', String(result.remaining))
  if (!result.allowed) {
    c.header('Retry-After', String(result.retryAfter))
    throw new HttpError(429, 'Too many requests. Please slow down and try again shortly.')
  }
}

/** Per-IP and per-account budgets applied together. */
export async function enforceIpAndUser(
  c: Context,
  name: LimitName,
  userId: string | null,
  cost = 1,
): Promise<void> {
  await enforce(c, name, `ip:${clientIp(c)}`, cost)
  if (userId) await enforce(c, name, `user:${userId}`, cost)
}

/**
 * Increments a failure counter and returns whether the caller is locked out.
 * Backoff is exponential on the failure count and decays after 15 minutes.
 */
export async function registerFailure(scope: string, identity: string): Promise<{ locked: boolean; retryAfter: number }> {
  const db = getDb()
  const key = makeKey(`login:${scope}`, identity)
  const now = new Date()
  const decay = new Date(now.getTime() - 15 * 60_000)

  const rows = await db
    .insert(schema.loginAttempts)
    .values({ id: key, scope: key, failedCount: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.loginAttempts.scope,
      set: {
        failedCount: sql`case when ${schema.loginAttempts.updatedAt} < ${decay}
                          then 1
                          else ${schema.loginAttempts.failedCount} + 1 end`,
        updatedAt: now,
      },
    })
    .returning({ failedCount: schema.loginAttempts.failedCount })

  const failures = rows[0]?.failedCount ?? 1
  if (failures < 5) return { locked: false, retryAfter: 0 }

  // 5 -> 30s, 6 -> 60s, 7 -> 120s ... capped at 15 minutes.
  const seconds = Math.min(900, 30 * 2 ** (failures - 5))
  await db
    .update(schema.loginAttempts)
    .set({ lockedUntil: new Date(now.getTime() + seconds * 1000) })
    .where(eq(schema.loginAttempts.scope, key))
  return { locked: true, retryAfter: seconds }
}

/** Clears the counter after a successful sign-in. */
export async function clearFailures(scope: string, identity: string): Promise<void> {
  const db = getDb()
  await db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.scope, makeKey(`login:${scope}`, identity)))
}

export async function lockoutRemaining(scope: string, identity: string): Promise<number> {
  const db = getDb()
  const rows = await db
    .select({ lockedUntil: schema.loginAttempts.lockedUntil })
    .from(schema.loginAttempts)
    .where(eq(schema.loginAttempts.scope, makeKey(`login:${scope}`, identity)))
    .limit(1)

  const until = rows[0]?.lockedUntil
  if (!until) return 0
  const remaining = Math.ceil((until.getTime() - Date.now()) / 1000)
  return remaining > 0 ? remaining : 0
}

/** Housekeeping for expired counters. Called opportunistically. */
export async function purgeExpiredCounters(): Promise<void> {
  const db = getDb()
  const now = new Date()
  await db.delete(schema.rateLimits).where(sql`${schema.rateLimits.expiresAt} < ${now}`)
  await db
    .delete(schema.loginAttempts)
    .where(and(eq(sql`1`, sql`1`), sql`${schema.loginAttempts.updatedAt} < ${new Date(now.getTime() - 86_400_000)}`))
}
