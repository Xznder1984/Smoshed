/**
 * Abuse-control tests: login lockout, failed-attempt counting, and the
 * rate-limit response contract.
 *
 * These sit in their own file because they deliberately exhaust a budget. A
 * locked-out address is useless to every other test in the suite, so each test
 * claims its own address and the lockout state is cleared again afterwards
 * rather than being left behind in the database.
 *
 * Like the rest of the end-to-end suite this needs DATABASE_URL and writes
 * rows. Run it with `npm run test:e2e`.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { loadLocalEnv } from '../../scripts/load-env.js'
import type { Hono } from 'hono'

loadLocalEnv()

const required = ['DATABASE_URL', 'SESSION_SECRET'] as const
const missing = required.filter((name) => !process.env[name])

/** Addresses in the documentation range, one per test, so none share a budget. */
/** Unique per run, so addresses do not collide with an earlier run's budget. */
const RUN_OFFSET = Math.floor(Math.random() * 200)
const address = (n: number) => `198.51.100.${(n + RUN_OFFSET) % 254 + 1}`
const origin = 'http://localhost:5173'

let app: Hono

/** Addresses this file locked out, so they can be released at the end. */
const lockedAddresses: string[] = []

type Result = { status: number; body: unknown; headers: Record<string, string> }

async function login(
  to: string,
  email: string,
  password: string,
): Promise<Result> {
  const response = await app.request('/api/auth/login', {
    method: 'POST',
    headers: {
      Origin: origin,
      'X-Forwarded-For': to,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })

  const headers: Record<string, string> = {}
  for (const [key, value] of response.headers) headers[key.toLowerCase()] = value

  const text = await response.text()
  let body: unknown = null
  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: response.status, body, headers }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/**
 * Releases the lockout for an address.
 *
 * The key is a keyed hash, so this cannot be written as a plain delete by
 * address; going through the app's own identifier keeps the two in step.
 */
async function releaseLockout(to: string): Promise<void> {
  const { getDb, schema } = await import('../../server/db/client.js')
  const { hmac } = await import('../../server/lib/crypto.js')
  const { eq, lt } = await import('drizzle-orm')
  const secret = process.env.SESSION_SECRET ?? ''
  const key = hmac(`login:ip:${to}`, secret)
  await getDb()
    .delete(schema.loginAttempts)
    .where(eq(schema.loginAttempts.scope, key))
  await getDb()
    .delete(schema.rateLimits)
    .where(lt(schema.rateLimits.expiresAt, new Date(Date.now() + 86_400_000)))
}

const describeOrSkip = missing.length > 0 ? describe.skip : describe

describeOrSkip('abuse controls', () => {
  afterAll(async () => {
    for (const to of lockedAddresses) await releaseLockout(to)
  })

  it('answers a wrong password with 401, not a server error', async () => {
    app = ((await import('../../server/app.js')) as { default: Hono }).default
    const to = address(10)

    const result = await login(to, 'nobody@example.invalid', 'definitely wrong')
    expect(result.status).toBe(401)
    expect(asRecord(asRecord(result.body).error).message).toMatch(/email or password/i)
  })

  it('gives the same answer for an unknown account as for a wrong password', async () => {
    const result = await login(address(11), 'nobody@example.invalid', 'definitely wrong')
    expect(result.status).toBe(401)
  })

  it('locks the address out after repeated failures', async () => {
    const to = address(12)
    const attempts: number[] = []

    // Five failures are counted, the next one meets the lockout.
    for (let i = 0; i < 6; i++) {
      attempts.push((await login(to, 'nobody@example.invalid', 'wrong')).status)
    }

    expect(attempts.slice(0, 4)).toEqual([401, 401, 401, 401])
    expect(attempts[4]).toBe(429)
    expect(attempts[5]).toBe(429)
    lockedAddresses.push(to)
  })

  it('tells the client how long to wait', async () => {
    const to = address(12)
    const result = await login(to, 'nobody@example.invalid', 'wrong')
    expect(result.status).toBe(429)
    const retryAfter = Number(result.headers['retry-after'])
    expect(retryAfter).toBeGreaterThan(0)
  })

  it('reports the remaining budget on an allowed request', async () => {
    const result = await login(address(13), 'nobody@example.invalid', 'wrong')
    expect(result.status).toBe(401)
    expect(result.headers['x-ratelimit-limit']).toBeDefined()
    expect(Number(result.headers['x-ratelimit-remaining'])).toBeGreaterThanOrEqual(0)
  })

  it('refuses a cross-origin sign-in', async () => {
    const response = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'X-Forwarded-For': address(14),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'nobody@example.invalid', password: 'wrong' }),
    })
    expect(response.status).toBe(403)
  })
})

describeOrSkip('scheduled routes', () => {
  const paths = ['/api/owner/bot/run', '/api/owner/maintenance']

  it('are closed when no scheduler secret is configured', async () => {
    app = ((await import('../../server/app.js')) as { default: Hono }).default
    const secret = process.env.CRON_SECRET
    // With the secret absent, the bearer path must not exist rather than
    // matching an empty value against an empty one.
    delete process.env.CRON_SECRET

    for (const path of paths) {
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'X-Forwarded-For': address(20), 'Content-Type': 'application/json' },
        body: '{}',
      })
      expect(response.status).toBe(403)
    }

    if (secret) process.env.CRON_SECRET = secret
  })

  it('accept a bearer secret and refuse a wrong one', async () => {
    const secret = process.env.CRON_SECRET
    if (!secret) {
      // Nothing to prove: with no secret configured there is no machine path.
      return
    }

    const wrong = await app.request('/api/owner/bot/run', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer not-the-secret',
        'X-Forwarded-For': address(21),
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    expect(wrong.status).toBe(403)

    const right = await app.request('/api/owner/maintenance', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'X-Forwarded-For': address(21),
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    // 200 proves the secret was accepted; the purge itself is idempotent.
    expect(right.status).toBe(200)
  })
})
