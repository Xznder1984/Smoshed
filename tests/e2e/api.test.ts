/**
 * End-to-end API test against the real database.
 *
 * This is the only test that exercises the whole stack together: the Hono app,
 * Neon, Argon2id, session cookies, CSRF double-submit, and the response shapes
 * the frontend parses. Unit tests cannot catch a contract the client and the
 * server disagree about, and a Vercel preview cannot be reached from an
 * unauthenticated request because the deployment is behind the auth wall. The
 * app is therefore driven in-process through `server/app.ts`, which is the exact
 * module the serverless function serves.
 *
 * It signs up a real account and deletes it at the end through the
 * account-deletion endpoint, so a run that gets as far as signing up leaves the
 * database as it found it.
 *
 * Excluded from `npm test` because it needs DATABASE_URL and writes rows. Run it
 * with `npm run test:e2e`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadLocalEnv } from '../../scripts/load-env.js'
import type { Hono } from 'hono'

loadLocalEnv()

const required = ['DATABASE_URL', 'SESSION_SECRET'] as const
const missing = required.filter((name) => !process.env[name])

/** Unique per run so repeated runs never collide on a handle or an address. */
const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)
  .toString(36)
  .padStart(3, '0')}`
const handle = `smoke${stamp}`.slice(0, 20)
const email = `smoke-${stamp}@example.invalid`
const password = `Smoke test ${stamp}!Aa1`
const nextPassword = `Rotated ${stamp}!Bb2`

/** Tracks the password in force, so the cleanup path can still sign in. */
let currentPassword = password

/**
 * Requests claim a loopback origin that the app really allows, so the origin
 * guard is exercised rather than bypassed.
 */
const origin = 'http://localhost:5173'

/**
 * Rate limits are counted in the database, keyed on the client address, so a
 * second run would otherwise be rejected by the limits this suite is proving
 * work. Each run claims its own address to get a fresh budget; the limiter
 * itself is not weakened or disabled.
 */
const clientAddress = `203.0.113.${1 + (Number.parseInt(stamp, 36) % 250)}`

let app: Hono
/** A real cookie jar: the double-submit check needs both cookies sent back. */
const jar = new Map<string, string>()
let csrf = ''
let accountCreated = false

type Result = { status: number; body: unknown; setCookie: string }

async function call(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Result> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {
    Origin: origin,
    'X-Forwarded-For': clientAddress,
  }

  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (jar.size > 0) {
    headers.Cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
  }
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf
  // Per-call headers come last so a test can deliberately break one of them.
  Object.assign(headers, options.headers)

  const response = await app.request(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  // Track cookies the way a browser would, so the session survives between calls.
  const raw = response.headers.getSetCookie?.() ?? []
  for (const entry of raw) {
    const [pair] = entry.split(';')
    const [name, ...rest] = pair.split('=')
    if (rest.length === 0) continue
    const value = rest.join('=')
    if (/expires=thu, 01 jan 1970/i.test(entry) || /max-age=0/i.test(entry)) {
      jar.delete(name)
      continue
    }
    jar.set(name, value)
    if (name === 'smosh_csrf') csrf = decodeURIComponent(value)
  }

  const text = await response.text()
  let body: unknown = null
  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: response.status, body, setCookie: raw.join(' | ') }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/** Finds the attributes of one Set-Cookie entry, ignoring the other cookies. */
function cookieAttributes(setCookie: string, name: string): string {
  const entry = setCookie.split(' | ').find((part) => part.startsWith(`${name}=`))
  return entry ?? ''
}

const describeOrSkip = missing.length > 0 ? describe.skip : describe

describeOrSkip('api end to end', () => {
  beforeAll(async () => {
    if (missing.length > 0) return
    app = ((await import('../../server/app.js')) as { default: Hono }).default
  })

  afterAll(async () => {
    if (!accountCreated) return
    const cleanup = await call('/api/auth/account', {
      method: 'DELETE',
      body: { password: currentPassword },
    })
    if (cleanup.status !== 200) {
      console.error(`Could not remove the test account @${handle} (${email}).`)
    }
  })

  it('reports itself healthy', async () => {
    const result = await call('/api/health')
    expect(result.status).toBe(200)
    expect(asRecord(result.body).ok).toBe(true)
  })

  it('reaches the database', async () => {
    const result = await call('/api/health/db')
    expect(result.status).toBe(200)
    expect(asRecord(result.body).ok).toBe(true)
  })

  it('refuses a cross-origin sign-up', async () => {
    const result = await call('/api/auth/signup', {
      method: 'POST',
      body: { email, handle, password },
      headers: { Origin: 'https://attacker.example' },
    })
    expect(result.status).toBe(403)
  })

  it('signs up and sets session and CSRF cookies', async () => {
    const result = await call('/api/auth/signup', {
      method: 'POST',
      body: { email, handle, password, displayName: 'Smoke Test' },
    })
    expect(result.status).toBe(201)
    accountCreated = true
    expect(jar.get('smosh_session')).toBeTruthy()
    expect(csrf).not.toBe('')
    expect(cookieAttributes(result.setCookie, 'smosh_session')).toMatch(/HttpOnly/i)
    expect(cookieAttributes(result.setCookie, 'smosh_session')).toMatch(/SameSite=Lax/i)
    // The double-submit half must stay readable by the browser's JavaScript.
    expect(cookieAttributes(result.setCookie, 'smosh_csrf')).not.toMatch(/HttpOnly/i)
  })

  it('refuses a signed-in mutation that omits the CSRF token', async () => {
    const result = await call('/api/posts', {
      method: 'POST',
      body: { body: 'This must not be created.' },
      headers: { 'X-CSRF-Token': 'not-the-real-token' },
    })
    expect(result.status).toBe(403)
  })

  it('recognises the new session', async () => {
    const result = await call('/api/auth/session')
    expect(asRecord(asRecord(result.body).user).handle).toBe(handle)
  })

  it('rejects a short password and a taken handle', async () => {
    const weak = await call('/api/auth/signup', {
      method: 'POST',
      body: { email: `w-${email}`, handle: `w${handle}`.slice(0, 20), password: 'short' },
    })
    expect(weak.status).toBe(422)

    const taken = await call('/api/auth/signup', {
      method: 'POST',
      body: { email: `t-${email}`, handle, password },
    })
    expect(taken.status).toBeGreaterThanOrEqual(400)
  })

  let postId = ''

  it('creates a post that mentions the bot', async () => {
    const result = await call('/api/posts', {
      method: 'POST',
      body: { body: 'Smoke test post. Hello @smosh' },
    })
    expect(result.status).toBe(201)
    // The server answers with the created post wrapped in `post`, and the
    // client refetches rather than reading the id, but the shape is pinned here
    // so a change to it is a deliberate one.
    postId = String(asRecord(asRecord(result.body).post).id)
    expect(postId).not.toBe('')
    expect(postId).not.toBe('undefined')
  })

  it('refuses a post over the character limit', async () => {
    const result = await call('/api/posts', { method: 'POST', body: { body: 'x'.repeat(281) } })
    expect(result.status).toBe(422)
  })

  it('returns a paginated timeline containing the new post', async () => {
    const result = await call('/api/posts?feed=latest')
    const body = asRecord(result.body)
    expect(Array.isArray(body.items)).toBe(true)
    expect(body).toHaveProperty('nextCursor')
    const items = body.items as Record<string, unknown>[]
    expect(items.some((post) => post.id === postId)).toBe(true)
  })

  it('serves the thread with its context', async () => {
    const result = await call(`/api/posts/${postId}/thread`)
    const body = asRecord(result.body)
    expect(asRecord(body.root).id).toBe(postId)
    expect(Array.isArray(body.ancestors)).toBe(true)
    expect(Array.isArray(body.replies)).toBe(true)
  })

  it('toggles a like rather than accumulating it', async () => {
    const liked = await call(`/api/posts/${postId}/like`, { method: 'POST' })
    expect(liked.status).toBe(200)
    expect(asRecord(liked.body).liked).toBe(true)

    const unliked = await call(`/api/posts/${postId}/like`, { method: 'POST' })
    expect(asRecord(unliked.body).liked).toBe(false)

    // And the counter has to come back to where it started.
    expect(asRecord(unliked.body).likeCount).toBe(0)
  })

  it('accepts a quote and a reply', async () => {
    const quote = await call('/api/posts', {
      method: 'POST',
      body: { body: 'Smoke test quote', quoteOfId: postId },
    })
    expect(quote.status).toBe(201)
    const quoted = asRecord(asRecord(quote.body).post)
    expect(quoted.quoteOfId).toBe(postId)
    // The quoted post itself is only embedded when the caller asks for it, so
    // the create response carries the reference rather than a copy.
    expect(quoted.quoteOf).toBeUndefined()

    const reply = await call('/api/posts', {
      method: 'POST',
      body: { body: 'Smoke test reply', replyToId: postId },
    })
    expect(reply.status).toBe(201)
    expect(asRecord(asRecord(reply.body).post).replyToId).toBe(postId)
  })

  it('includes replies to replies in a thread', async () => {
    // root -> child -> grandchild. A thread view that only looks one level down
    // loses the grandchild, which is a normal shape once anyone replies to a
    // reply.
    const child = await call('/api/posts', {
      method: 'POST',
      body: { body: 'Smoke test child reply', replyToId: postId },
    })
    expect(child.status).toBe(201)
    const childId = asRecord(asRecord(child.body).post).id as string

    const grandchild = await call('/api/posts', {
      method: 'POST',
      body: { body: 'Smoke test grandchild reply', replyToId: childId },
    })
    expect(grandchild.status).toBe(201)
    const grandchildId = asRecord(asRecord(grandchild.body).post).id as string

    const thread = await call(`/api/posts/${postId}/thread`)
    expect(thread.status).toBe(200)
    const replies = asRecord(thread.body).replies as unknown[]
    const replyIds = replies.map((r) => asRecord(r).id)

    expect(replyIds).toContain(childId)
    expect(replyIds).toContain(grandchildId)

    // Opening the child directly has to show the grandchild as an ancestor,
    // which is the same tree walked the other way.
    const fromChild = await call(`/api/posts/${childId}/thread`)
    const ancestors = asRecord(fromChild.body).ancestors as unknown[]
    expect(ancestors.map((a) => asRecord(a).id)).toContain(postId)
  })

  it('returns a profile with viewer relationships', async () => {
    const result = await call(`/api/users/${handle}`)
    const user = asRecord(result.body).user ?? result.body
    expect(asRecord(user).handle).toBe(handle)
    expect(asRecord(user)).toHaveProperty('viewer')
  })

  it('updates the profile', async () => {
    const result = await call('/api/auth/profile', {
      method: 'PATCH',
      body: { displayName: 'Smoke Test Renamed', bio: 'Testing bio.' },
    })
    expect(result.status).toBe(200)
  })

  it('returns paginated bookmarks and notifications', async () => {
    const bookmarks = asRecord((await call('/api/posts/saved/list')).body)
    expect(Array.isArray(bookmarks.items)).toBe(true)
    expect(bookmarks).toHaveProperty('nextCursor')

    const notifications = asRecord((await call('/api/notifications')).body)
    expect(Array.isArray(notifications.items)).toBe(true)
    expect(notifications).toHaveProperty('nextCursor')
  })

  it('exports account data', async () => {
    const result = await call('/api/auth/export')
    expect(result.status).toBe(200)
  })

  it('refuses a password change with the wrong current password', async () => {
    const result = await call('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword: 'not the current password', newPassword: nextPassword },
    })
    expect(result.status).toBe(401)
  })

  it('changes the password when the current one is right', async () => {
    const result = await call('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword: password, newPassword: nextPassword },
    })
    expect(result.status).toBe(200)
    currentPassword = nextPassword
  })

  it('rejects a wrong password on re-authentication', async () => {
    const result = await call('/api/auth/reauth', {
      method: 'POST',
      body: { password: 'definitely not the password' },
    })
    expect(result.status).toBe(401)
  })

  it('closes owner-only routes to an ordinary account', async () => {
    // Owner routes name themselves in the refusal.
    const me = await call('/api/owner/me')
    expect(me.status).toBe(403)

    const run = await call('/api/owner/bot/run', { method: 'POST', body: {} })
    expect(run.status).toBe(403)

    // Bot settings and moderation answer 404 so their shape cannot be mapped.
    const settings = await call('/api/bot/settings')
    expect(settings.status).toBe(404)

    const save = await call('/api/bot/settings', { method: 'PUT', body: { enabled: false } })
    expect(save.status).toBe(404)

    const reports = await call('/api/moderation/reports')
    expect(reports.status).toBe(404)

    const stats = await call('/api/moderation/stats')
    expect(stats.status).toBe(404)
  })

  it('does not accept a forged session cookie', async () => {
    const real = jar.get('smosh_session')
    jar.set('smosh_session', 'forged-value.signature')

    const result = await call('/api/auth/session')
    expect(asRecord(result.body).user).toBeNull()

    // Restore, or every later request and the cleanup would run signed out.
    if (real) jar.set('smosh_session', real)
  })

  it('deletes the account and invalidates the session', async () => {
    const deleted = await call('/api/auth/account', {
      method: 'DELETE',
      body: { password: currentPassword },
    })
    expect(deleted.status).toBe(200)
    accountCreated = false

    const afterDelete = await call('/api/auth/session')
    expect(asRecord(afterDelete.body).user).toBeNull()

    const signIn = await call('/api/auth/login', {
      method: 'POST',
      body: { email, password: currentPassword },
    })
    expect(signIn.status).toBe(401)
  })
})
