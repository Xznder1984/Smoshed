import { and, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../../db/client.js'
import { hmac } from '../crypto.js'
import { env } from '../env.js'

function key(scope: string, identity: string): string {
  return hmac(`${scope}:${identity}`, env.sessionSecret)
}

async function currentCount(scope: string, bucket: string, seconds: number): Promise<number> {
  const db = getDb()
  const now = new Date()
  const windowStart = new Date(
    Math.floor(now.getTime() / (seconds * 1000)) * seconds * 1000,
  )
  const expiresAt = new Date(windowStart.getTime() + seconds * 1000)

  const rows = await db
    .insert(schema.rateLimits)
    .values({ scope: key(scope, bucket), bucket, windowStart, count: 0, expiresAt })
    .onConflictDoUpdate({
      target: [schema.rateLimits.scope, schema.rateLimits.bucket],
      set: { expiresAt: sql`greatest(${schema.rateLimits.expiresAt}, ${expiresAt})` },
    })
    .returning({ count: schema.rateLimits.count, windowStart: schema.rateLimits.windowStart })

  const row = rows[0]
  if (!row) return 0
  if (row.windowStart.getTime() < windowStart.getTime()) return 0
  return row.count
}

async function increment(scope: string, bucket: string, seconds: number): Promise<void> {
  const db = getDb()
  const now = new Date()
  const windowStart = new Date(
    Math.floor(now.getTime() / (seconds * 1000)) * seconds * 1000,
  )
  const expiresAt = new Date(windowStart.getTime() + seconds * 1000)

  await db
    .insert(schema.rateLimits)
    .values({ scope: key(scope, bucket), bucket, windowStart, count: 1, expiresAt })
    .onConflictDoUpdate({
      target: [schema.rateLimits.scope, schema.rateLimits.bucket],
      set: {
        count: sql`case when ${schema.rateLimits.windowStart} < ${windowStart}
                    then 1 else ${schema.rateLimits.count} + 1 end`,
        windowStart: sql`case when ${schema.rateLimits.windowStart} < ${windowStart}
                          then ${windowStart} else ${schema.rateLimits.windowStart} end`,
        expiresAt: sql`greatest(${schema.rateLimits.expiresAt}, ${expiresAt})`,
      },
    })
}

export type LimitVerdict = {
  allowed: boolean
  reason?: string
}

/**
 * Checks the three bot budgets without consuming any of them, so a rejected
 * attempt does not count towards the user's own allowance.
 */
export async function rateCheck(input: {
  userId: string
  perUserHourlyLimit: number
  globalHourlyLimit: number
  globalDailyLimit: number
}): Promise<LimitVerdict> {
  const HOUR = 3600
  const DAY = 86_400

  if (input.perUserHourlyLimit > 0) {
    const used = await currentCount('bot', `user:${input.userId}`, HOUR)
    if (used >= input.perUserHourlyLimit) {
      return { allowed: false, reason: 'per-user hourly limit reached' }
    }
  }
  if (input.globalHourlyLimit > 0) {
    const used = await currentCount('bot', 'global:hour', HOUR)
    if (used >= input.globalHourlyLimit) {
      return { allowed: false, reason: 'global hourly limit reached' }
    }
  }
  if (input.globalDailyLimit > 0) {
    const used = await currentCount('bot', 'global:day', DAY)
    if (used >= input.globalDailyLimit) {
      return { allowed: false, reason: 'global daily limit reached' }
    }
  }
  return { allowed: true }
}

/** Consumes one unit from every budget. Called only after a reply is posted. */
export async function rateConsume(userId: string): Promise<void> {
  await increment('bot', `user:${userId}`, 3600)
  await increment('bot', 'global:hour', 3600)
  await increment('bot', 'global:day', 86_400)
}

/** Housekeeping for the shared counter table. */
export async function purgeBotCounters(): Promise<void> {
  const db = getDb()
  await db
    .delete(schema.rateLimits)
    .where(and(eq(sql`1`, sql`1`), sql`${schema.rateLimits.expiresAt} < now()`))
}
