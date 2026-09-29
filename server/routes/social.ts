import { Hono } from 'hono'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db/client.js'
import { HttpError, assertCsrf, requireUser } from '../lib/auth.js'
import { newId } from '../lib/crypto.js'
import { clientIp, enforce } from '../lib/rate-limit.js'
import { authorCounts, hydratePosts, postSelect, toAuthorBase, viewerRelations } from '../lib/views.js'
import { search } from '../lib/search.js'
import { visiblePostAuthors } from '../lib/visibility.js'
import { beforeCursor, encodeCursor, pageParams } from '../lib/pagination.js'
import type { AuthorView, PostView } from '../../shared/types.js'

const authorSelect = {
  id: schema.users.id,
  handle: schema.users.handle,
  displayName: schema.users.displayName,
  bio: schema.users.bio,
  avatarSeed: schema.users.avatarSeed,
  isBot: schema.users.isBot,
  isAdmin: schema.users.isAdmin,
  createdAt: schema.users.createdAt,
} as const

async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return {}
  }
}

export function searchRoutes() {
  const app = new Hono()

  app.get('/', async (c) => {
    const viewer = c.get('user')
    const parsed = z
      .object({ q: z.string().trim().min(1).max(120) })
      .safeParse({ q: c.req.query('q') ?? '' })
    if (!parsed.success) {
      return c.json({ error: { message: 'Enter something to search for.' } }, 422)
    }
    // Search is the most expensive read path, so it gets its own budget.
    await enforce(c, 'search', `ip:${clientIp(c)}`)
    if (viewer) await enforce(c, 'search', `user:${viewer.id}`)

    const db = getDb()
    const result = await search(db, viewer?.id ?? null, parsed.data.q, 20)

    // Attach follower counts without an extra query per row.
    const followerCounts = await followerCountsByUser(db, result.users.map((u) => u.id))
    const relations = await viewerRelations(
      db,
      viewer?.id ?? null,
      result.users.map((u) => u.id),
    )

    const users: AuthorView[] = result.users.map((user) => ({
      ...user,
      counts: {
        followers: followerCounts.get(user.id) ?? 0,
        following: 0,
        posts: 0,
      },
      viewer: relations.get(user.id),
    }))

    return c.json({ posts: result.posts, users })
  })

  return app
}

export function notificationRoutes() {
  const app = new Hono()

  app.get('/', async (c) => {
    const user = requireUser(c)
    const db = getDb()
    const { limit, cursor } = pageParams({ limit: c.req.query('limit'), cursor: c.req.query('cursor') })
    const rows = await db
      .select({
        id: schema.notifications.id,
        type: schema.notifications.type,
        createdAt: schema.notifications.createdAt,
        readAt: schema.notifications.readAt,
        postId: schema.notifications.postId,
        actor: authorSelect,
      })
      .from(schema.notifications)
      .innerJoin(schema.users, eq(schema.users.id, schema.notifications.actorId))
      .where(
        and(
          eq(schema.notifications.userId, user.id),
          beforeCursor(schema.notifications.createdAt, schema.notifications.id, cursor),
        ),
      )
      .orderBy(desc(schema.notifications.createdAt), desc(schema.notifications.id))
      .limit(limit + 1)

    // A deleted post leaves a null reference, which renders as a
    // "no longer available" line rather than breaking the list.
    const postIds = rows.map((r) => r.postId).filter((id): id is string => Boolean(id))
    const posts: PostView[] =
      postIds.length > 0
        ? await hydratePosts(
            db,
            user.id,
            await db
              .select({ ...postSelect, author: authorSelect })
              .from(schema.posts)
              .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
              .where(inArray(schema.posts.id, postIds)),
          )
        : []
    const postsById = new Map(posts.map((p) => [p.id, p]))
    const trimmed = rows.slice(0, limit)
    const last = trimmed[trimmed.length - 1]

    return c.json({
      items: trimmed.map((row) => ({
        id: row.id,
        type: row.type,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt ? row.readAt.toISOString() : null,
        actor: toAuthorBase(row.actor),
        post: row.postId ? (postsById.get(row.postId) ?? null) : null,
      })),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    })
  })

  app.get('/unread-count', async (c) => {
    const user = requireUser(c)
    const db = getDb()
    const rows = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)))
      .limit(500)
    return c.json({ count: rows.length })
  })

  app.post('/read', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    const db = getDb()
    const parsed = z
      .object({ ids: z.array(z.string().max(64)).max(200).optional() })
      .safeParse(await readJson(c))
    if (!parsed.success) return c.json({ error: { message: 'Check the request.' } }, 422)

    if (parsed.data.ids && parsed.data.ids.length > 0) {
      // Scoped to the signed-in account: one user cannot mark another's read.
      await db
        .update(schema.notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(schema.notifications.userId, user.id),
            inArray(schema.notifications.id, parsed.data.ids),
          ),
        )
    } else {
      await db
        .update(schema.notifications)
        .set({ readAt: new Date() })
        .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)))
    }
    return c.json({ ok: true })
  })

  return app
}

export function reportRoutes() {
  const app = new Hono()

  app.post('/', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    await enforce(c, 'write', `user:${user.id}`)
    const parsed = z
      .object({
        targetUserId: z.string().min(1).max(64).optional(),
        targetPostId: z.string().min(1).max(64).optional(),
        reason: z.enum([
          'spam',
          'harassment',
          'hate',
          'violence',
          'self_harm',
          'sexual',
          'misinformation',
          'other',
        ]),
        details: z.string().trim().max(1000).default(''),
      })
      .refine((v) => Boolean(v.targetUserId ?? v.targetPostId), {
        message: 'Choose what you are reporting.',
      })
      .safeParse(await readJson(c))

    if (!parsed.success) {
      return c.json({ error: { message: parsed.error.issues[0]?.message ?? 'Check the report.' } }, 422)
    }
    const db = getDb()
    const { targetUserId, targetPostId, reason, details } = parsed.data

    if (targetUserId === user.id) {
      return c.json({ error: { message: 'You cannot report yourself.' } }, 400)
    }
    if (targetUserId) {
      const exists = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, targetUserId))
        .limit(1)
      if (!exists[0]) return c.json({ error: { message: 'That account no longer exists.' } }, 404)
    }
    if (targetPostId) {
      const exists = await db
        .select({ id: schema.posts.id })
        .from(schema.posts)
        .where(eq(schema.posts.id, targetPostId))
        .limit(1)
      if (!exists[0]) return c.json({ error: { message: 'That post no longer exists.' } }, 404)
    }

    await db.insert(schema.reports).values({
      id: newId(),
      reporterId: user.id,
      targetUserId: targetUserId ?? null,
      targetPostId: targetPostId ?? null,
      reason,
      details,
    })
    return c.json({ ok: true, message: 'Thanks. Your report was sent for review.' }, 201)
  })

  return app
}

async function followerCountsByUser(
  db: ReturnType<typeof getDb>,
  ids: string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: schema.follows.followingId })
    .from(schema.follows)
    .where(inArray(schema.follows.followingId, ids))
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, 0)
  for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1)
  return counts
}

export { HttpError, sql, authorCounts, visiblePostAuthors }
