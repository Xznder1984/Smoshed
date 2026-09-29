import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { logger } from 'hono/logger'
import { sql } from 'drizzle-orm'
import { executeRows, getDb, schema } from './db/client.js'
import { HttpError, loadSession } from './lib/auth.js'
import { env } from './lib/env.js'
import { authRoutes } from './routes/auth.js'
import { postRoutes } from './routes/posts.js'
import { userRoutes } from './routes/users.js'
import { notificationRoutes, reportRoutes, searchRoutes } from './routes/social.js'
import { botSettingsRoutes, moderationRoutes, ownerRoutes } from './routes/admin.js'

const app = new Hono()

/**
 * Credentialed requests are limited to this deployment's own origin. The Vite
 * dev server runs on a different port during local development, so loopback is
 * allowed as well. Credentials are never combined with a wildcard origin.
 */
app.use(
  '/api/*',
  cors({
    origin: env.allowedOrigins,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-CSRF-Token'],
    maxAge: 600,
  }),
)

app.use('/api/*', secureHeaders())

app.use('/api/*', logger())

/** Resolves the session for every API request, including anonymous ones. */
app.use('/api/*', async (c, next) => {
  try {
    await loadSession(c)
  } catch {
    c.set('user', null)
    c.set('sessionId', null)
    c.set('reauthenticatedAt', 0)
  }
  await next()
})

app.route('/api/auth', authRoutes())
app.route('/api/posts', postRoutes())
app.route('/api/users', userRoutes())
app.route('/api/notifications', notificationRoutes())
app.route('/api/reports', reportRoutes())
app.route('/api/search', searchRoutes())
app.route('/api/bot/settings', botSettingsRoutes())
app.route('/api/moderation', moderationRoutes())
app.route('/api/owner', ownerRoutes())

app.get('/api/health', (c) => c.json({ ok: true, name: 'Smoshed' }))

/** Confirms the database is reachable. Used by the deploy smoke test. */
app.get('/api/health/db', async (c) => {
  try {
    const db = getDb()
    const rows = await executeRows<{ n: number }>(
      sql`select count(*)::int as n from ${schema.posts}`,
      db,
    )
    return c.json({ ok: true, posts: Number(rows[0]?.n ?? 0) })
  } catch {
    return c.json({ ok: false }, 503)
  }
})

app.notFound((c) => c.json({ error: { message: 'Not found' } }, 404))

/**
 * Error handler. Clients get a message and nothing else: no stack traces, no
 * SQL, no provider keys. The detail goes to the server log only.
 */
app.onError((err, c) => {
  if (err instanceof HttpError) {
    const status = (err.status >= 400 && err.status < 600 ? err.status : 500) as never
    return c.json({ error: { message: err.message } }, status)
  }
  console.error('[api] unhandled error:', err instanceof Error ? err.message : err)
  return c.json({ error: { message: 'Something went wrong on our side. Please try again.' } }, 500)
})

export default app
