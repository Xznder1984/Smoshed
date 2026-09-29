import { Hono } from 'hono'
import { readJson } from '../lib/respond.js'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { executeRows, getDb, schema } from '../db/client.js'
import { HttpError, assertCsrf, assertOwnerOrMachine, isAdmin, isMachineRequest, isOwner, requireUser } from '../lib/auth.js'
import { env } from '../lib/env.js'
import { newId, verifyPassword } from '../lib/crypto.js'
import {
  DEFAULT_BOT_CONFIG,
  DEFAULT_PROVIDER_ORDER,
  DEFAULT_SYSTEM_PROMPT,
  PROVIDERS,
  botSettingsSchema,
  diffSettings,
  getBotConfig,
} from '../lib/bot/config.js'
import { complete } from '../lib/bot/providers.js'
import { sanitizeBotReply } from '../lib/bot/queue.js'
import { authorCounts, authorCountsFor, toAuthorBase } from '../lib/views.js'

/** How recent a re-authentication must be, in milliseconds. */
const REAUTH_WINDOW_MS = 10 * 60 * 1000

export function botSettingsRoutes() {
  const app = new Hono()

  /**
   * Owner-only gate. Runs on every request and returns 404 rather than 403, so
   * a non-owner cannot even confirm the endpoint exists.
   */
  app.use('*', async (c, next) => {
    const user = c.get('user')
    if (!isOwner(user)) {
      return c.json({ error: { message: 'Not found' } }, 404)
    }
    await next()
  })

  app.get('/', async (c) => {
    const config = await getBotConfig()
    // The settings object is returned flat alongside the reference data the
    // form needs, so the client can seed its draft from one object.
    return c.json({
      ...config,
      providers: PROVIDERS,
      defaults: {
        providerOrder: DEFAULT_PROVIDER_ORDER,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
      },
      limits: {
        maxPostLength: 280,
      },
    })
  })

  app.put('/', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)

    // Saving settings requires a password confirmation within the last 10
    // minutes. The timestamp lives on the server-side session row.
    const reauthenticatedAt = c.get('reauthenticatedAt') ?? 0
    if (Date.now() - reauthenticatedAt > REAUTH_WINDOW_MS) {
      return c.json(
        { error: { message: 'Confirm your password before saving bot settings.', code: 'reauth_required' } },
        428,
      )
    }

    const parsed = botSettingsSchema.safeParse(await readJson(c))
    if (!parsed.success) {
      return c.json(
        {
          error: {
            message: parsed.error.issues[0]?.message ?? 'Check the settings.',
            fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          },
        },
        422,
      )
    }

    const before = await getBotConfig()
    const after = parsed.data
    const changes = diffSettings(before, after)

    if (Object.keys(changes).length === 0) {
      return c.json({ settings: before, changed: false })
    }

    const db = getDb()
    await db
      .update(schema.botSettings)
      .set({
        enabled: after.enabled,
        providerOrder: after.providerOrder,
        models: after.models,
        systemPrompt: after.systemPrompt,
        temperature: after.temperature,
        maxTokens: after.maxTokens,
        perUserHourlyLimit: after.perUserHourlyLimit,
        globalHourlyLimit: after.globalHourlyLimit,
        globalDailyLimit: after.globalDailyLimit,
        maxDepth: after.maxDepth,
        blockedWords: after.blockedWords,
        updatedAt: new Date(),
        updatedBy: user.id,
      })
      .where(eq(schema.botSettings.id, 1))

    // Audit row records what changed and when. Provider keys are never part of
    // the settings object, so they cannot leak into this table.
    await db.insert(schema.botSettingsAudit).values({
      id: newId(),
      actorUserId: user.id,
      changes,
    })

    return c.json({ settings: await getBotConfig(), changed: true })
  })

  /**
   * Runs the model without posting anything. Used by the test box in settings.
   * Consumes no rate budget and creates no post.
   */
  app.post('/test', async (c) => {
    await assertCsrf(c)
    const parsed = z
      .object({
        prompt: z.string().trim().min(1).max(1000),
        overrideSystemPrompt: z.string().trim().max(4000).optional(),
      })
      .safeParse(await readJson(c))
    if (!parsed.success) {
      return c.json({ error: { message: 'Write something to test with.' } }, 422)
    }

    const config = await getBotConfig()
    try {
      const result = await complete(
        config,
        parsed.data.prompt,
        parsed.data.overrideSystemPrompt,
      )
      const reply = sanitizeBotReply(result.text, config, new Set())
      return c.json({
        reply: reply ?? '(the model produced nothing usable)',
        provider: result.provider,
        model: result.model,
        sanitized: reply !== result.text.trim(),
      })
    } catch (err) {
      // Provider errors are logged without keys and reported generically.
      const message = err instanceof Error ? err.message : 'provider error'
      console.error('[bot:test]', message)
      return c.json({ error: { message: 'The model provider did not respond. Check the keys and try again.' } }, 502)
    }
  })

  app.get('/audit', async (c) => {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.botSettingsAudit)
      .orderBy(desc(schema.botSettingsAudit.createdAt))
      .limit(50)
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((id): id is string => Boolean(id)))]
    const actors = await authorCountsFor(db, actorIds)
    const actorRows = actorIds.length
      ? await db
          .select({
            id: schema.users.id,
            handle: schema.users.handle,
            displayName: schema.users.displayName,
            bio: schema.users.bio,
            avatarSeed: schema.users.avatarSeed,
            isBot: schema.users.isBot,
            isAdmin: schema.users.isAdmin,
            createdAt: schema.users.createdAt,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, actorIds))
      : []
    const actorById = new Map(actorRows.map((a) => [a.id, a]))

    return c.json({
      entries: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        changes: row.changes,
        actor: row.actorUserId
          ? {
              ...toAuthorBase(actorById.get(row.actorUserId)!),
              counts: actors.get(row.actorUserId) ?? { followers: 0, following: 0, posts: 0 },
            }
          : null,
      })),
    })
  })

  app.get('/jobs', async (c) => {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.botJobs)
      .orderBy(desc(schema.botJobs.createdAt))
      .limit(50)
    return c.json({
      jobs: rows.map((row) => ({
        id: row.id,
        postId: row.postId,
        status: row.status,
        attempts: row.attempts,
        error: row.error,
        provider: row.provider,
        resultPostId: row.resultPostId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    })
  })

  return app
}

export function moderationRoutes() {
  const app = new Hono()

  app.use('*', async (c, next) => {
    const user = c.get('user')
    if (!isAdmin(user)) {
      return c.json({ error: { message: 'Not found' } }, 404)
    }
    await next()
  })

  app.get('/reports', async (c) => {
    const db = getDb()
    const status = c.req.query('status')
    const parsed = z
      .enum(['open', 'reviewing', 'resolved', 'dismissed', 'all'])
      .catch('open')
      .parse(status)

    const rows = await db
      .select({
        report: schema.reports,
        reporter: {
          id: schema.users.id,
          handle: schema.users.handle,
          displayName: schema.users.displayName,
        },
      })
      .from(schema.reports)
      .innerJoin(schema.users, eq(schema.users.id, schema.reports.reporterId))
      .where(parsed === 'all' ? undefined : eq(schema.reports.status, parsed))
      .orderBy(desc(schema.reports.createdAt))
      .limit(100)

    const targetIds = [
      ...new Set(rows.map((r) => r.report.targetUserId).filter((id): id is string => Boolean(id))),
    ]
    const targets = targetIds.length
      ? await db
          .select({
            id: schema.users.id,
            handle: schema.users.handle,
            displayName: schema.users.displayName,
            isBot: schema.users.isBot,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, targetIds))
      : []
    const targetById = new Map(targets.map((t) => [t.id, t]))

    const postIds = rows.map((r) => r.report.targetPostId).filter((id): id is string => Boolean(id))
    const posts = postIds.length
      ? await db
          .select({ id: schema.posts.id, body: schema.posts.body, authorId: schema.posts.authorId })
          .from(schema.posts)
          .where(inArray(schema.posts.id, postIds))
      : []
    const postById = new Map(posts.map((p) => [p.id, p]))

    return c.json({
      reports: rows.map((row) => ({
        id: row.report.id,
        reason: row.report.reason,
        details: row.report.details,
        status: row.report.status,
        createdAt: row.report.createdAt.toISOString(),
        resolvedAt: row.report.resolvedAt?.toISOString() ?? null,
        resolutionNote: row.report.resolutionNote,
        reporter: row.reporter,
        targetUser: row.report.targetUserId
          ? (targetById.get(row.report.targetUserId) ?? null)
          : null,
        targetPost: row.report.targetPostId ? (postById.get(row.report.targetPostId) ?? null) : null,
      })),
    })
  })

  app.post('/reports/:id', async (c) => {
    const db = getDb()
    const id = c.req.param('id')
    const parsed = z
      .object({
        status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']),
        note: z.string().trim().max(500).optional(),
      })
      .safeParse(await readJson(c))
    if (!parsed.success) return c.json({ error: { message: 'Check the request.' } }, 422)

    const exists = await db
      .select({ id: schema.reports.id })
      .from(schema.reports)
      .where(eq(schema.reports.id, id))
      .limit(1)
    if (!exists[0]) return c.json({ error: { message: 'That report does not exist.' } }, 404)

    await db
      .update(schema.reports)
      .set({
        status: parsed.data.status,
        resolutionNote: parsed.data.note ?? null,
        resolvedAt: parsed.data.status === 'resolved' || parsed.data.status === 'dismissed' ? new Date() : null,
      })
      .where(eq(schema.reports.id, id))
    return c.json({ ok: true })
  })

  app.get('/stats', async (c) => {
    const db = getDb()
    const [users, posts, reports, jobs] = await Promise.all([
      executeRows<{ n: number }>(sql`select count(*)::int as n from ${schema.users}`, db),
      executeRows<{ n: number }>(sql`select count(*)::int as n from ${schema.posts}`, db),
      executeRows<{ n: number }>(sql`select count(*)::int as n from ${schema.reports} where status = 'open'`, db),
      executeRows<{ n: number }>(sql`select count(*)::int as n from ${schema.botJobs} where status = 'failed'`, db),
    ])
    return c.json({
      users: Number(users[0]?.n ?? 0),
      posts: Number(posts[0]?.n ?? 0),
      openReports: Number(reports[0]?.n ?? 0),
      failedBotJobs: Number(jobs[0]?.n ?? 0),
    })
  })

  return app
}

/**
 * Owner-only operational endpoints. `bot/run` spends provider quota and
 * `maintenance` deletes rows, so both sit behind an owner check that is
 * applied to the whole router rather than per route.
 */
export function ownerRoutes() {
  const app = new Hono()

  /**
   * Admit either an owner session or the scheduler secret.
   *
   * The machine check has to happen here, before anything asks for a session:
   * a timer has no session to present, so a `requireUser` in this layer would
   * turn every scheduled call into a 401 and leave the routes unreachable. A
   * bearer header that is present but wrong is refused outright rather than
   * falling through, so a mistyped secret does not look like "anonymous".
   */
  app.use('*', async (c, next) => {
    const secret = env.cronSecret
    if (secret && c.req.header('authorization')) {
      if (isMachineRequest(c)) return next()
      return c.json({ error: { message: 'This area is for the site owner.' } }, 403)
    }

    const user = c.get('user')
    if (!isOwner(user)) {
      return c.json({ error: { message: 'This area is for the site owner.' } }, 403)
    }
    await next()
  })

  /** Processes queued bot jobs. Called on a timer by the platform. */
  app.post('/bot/run', async (c) => {
    await assertOwnerOrMachine(c)
    const db = getDb()
    const { runJob } = await import('../lib/bot/queue.js')
    const jobs = await db
      .select({ id: schema.botJobs.id })
      .from(schema.botJobs)
      .where(eq(schema.botJobs.status, 'queued'))
      .orderBy(schema.botJobs.createdAt)
      .limit(3)

    const results = []
    for (const job of jobs) {
      results.push(await runJob(job.id))
    }
    return c.json({ processed: results.length, results })
  })

  /** Cron target: purges expired sessions and rate counters. */
  app.post('/maintenance', async (c) => {
    await assertOwnerOrMachine(c)
    const { purgeExpiredSessions } = await import('../lib/auth.js')
    const { purgeExpiredCounters } = await import('../lib/rate-limit.js')
    await purgeExpiredSessions()
    await purgeExpiredCounters()
    return c.json({ ok: true })
  })

  app.get('/me', async (c) => {
    const user = requireUser(c)
    const db = getDb()
    return c.json({
      user: {
        ...toAuthorBase(user),
        email: user.email,
        isOwner: isOwner(user),
        counts: await authorCounts(db, user.id),
      },
    })
  })

  return app
}

export { HttpError, isNull, and, verifyPassword, DEFAULT_BOT_CONFIG }
