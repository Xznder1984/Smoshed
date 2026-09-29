import { Hono } from 'hono'
import { and, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { getDb, schema } from '../db/client.js'
import { HttpError, assertCsrf, requireUser } from '../lib/auth.js'
import { newId } from '../lib/crypto.js'
import { enforce } from '../lib/rate-limit.js'
import { beforeCursor, encodeCursor, pageParams } from '../lib/pagination.js'
import {
  type AuthorRow,
  authorCounts,
  authorCountsFor,
  hydratePosts,
  postSelect,
  toAuthorBase,
  viewerRelations,
} from '../lib/views.js'
import { isBlockedEitherWay, visiblePostAuthors } from '../lib/visibility.js'

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

export function userRoutes() {
  const app = new Hono()

  /** "Who to follow": real accounts the viewer does not follow yet. */
  app.get('/suggestions', async (c) => {
    const viewer = c.get('user')
    const db = getDb()
    const rows = await db
      .select(authorSelect)
      .from(schema.users)
      .where(
        viewer
          ? and(
              sql`not exists (select 1 from ${schema.follows} where follower_id = ${viewer.id} and following_id = ${schema.users.id})`,
              visiblePostAuthors(viewer.id),
            )
          : undefined,
      )
      .orderBy(desc(schema.users.createdAt))
      .limit(6)

    const counts = await authorCountsFor(
      db,
      rows.map((r) => r.id),
    )
    const relations = await viewerRelations(db, viewer?.id ?? null, rows.map((r) => r.id))
    return c.json({
      users: rows.map((row) => ({
        ...toAuthorBase(row),
        counts: counts.get(row.id) ?? { followers: 0, following: 0, posts: 0 },
        viewer: relations.get(row.id),
      })),
    })
  })

  app.get('/:handle', async (c) => {
    const viewer = c.get('user')
    const db = getDb()
    const handle = c.req.param('handle').toLowerCase()

    const rows = await db
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
      .where(sql`lower(${schema.users.handle}) = ${handle}`)
      .limit(1)
    const user = rows[0]
    if (!user) throw new HttpError(404, 'That account does not exist.')

    if (viewer && viewer.id !== user.id) {
      const relations = await viewerRelations(db, viewer.id, [user.id])
      const rel = relations.get(user.id)
      // A blocked account looks absent rather than forbidden.
      if (rel?.blocking || rel?.blockedBy) throw new HttpError(404, 'That account does not exist.')
    }

    const relations = await viewerRelations(db, viewer?.id ?? null, [user.id])
    return c.json({
      user: {
        ...toAuthorBase(user),
        counts: await authorCounts(db, user.id),
        viewer: relations.get(user.id),
      },
    })
  })

  app.get('/:handle/posts', async (c) => {
    const viewer = c.get('user')
    const db = getDb()
    const handle = c.req.param('handle').toLowerCase()
    const { limit, cursor } = pageParams({ limit: c.req.query('limit'), cursor: c.req.query('cursor') })

    const authors = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.handle}) = ${handle}`)
      .limit(1)
    if (!authors[0]) throw new HttpError(404, 'That account does not exist.')

    const rows = await db
      .select({ ...postSelect, author: authorSelect })
      .from(schema.posts)
      .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
      .where(
        and(
          eq(schema.posts.authorId, authors[0].id),
          isNull(schema.posts.replyToId),
          visiblePostAuthors(viewer?.id ?? null),
          beforeCursor(schema.posts.createdAt, schema.posts.id, cursor),
        ),
      )
      .orderBy(desc(schema.posts.createdAt), desc(schema.posts.id))
      .limit(limit + 1)

    const trimmed = rows.slice(0, limit)
    const last = trimmed[trimmed.length - 1]
    return c.json({
      items: await hydratePosts(db, viewer?.id ?? null, trimmed, { includeQuoted: true }),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    })
  })

  app.get('/:handle/replies', async (c) => {
    const viewer = c.get('user')
    const db = getDb()
    const handle = c.req.param('handle').toLowerCase()
    const { limit, cursor } = pageParams({ limit: c.req.query('limit'), cursor: c.req.query('cursor') })

    const authors = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.handle}) = ${handle}`)
      .limit(1)
    if (!authors[0]) throw new HttpError(404, 'That account does not exist.')

    const rows = await db
      .select({ ...postSelect, author: authorSelect })
      .from(schema.posts)
      .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
      .where(
        and(
          eq(schema.posts.authorId, authors[0].id),
          isNotNull(schema.posts.replyToId),
          visiblePostAuthors(viewer?.id ?? null),
          beforeCursor(schema.posts.createdAt, schema.posts.id, cursor),
        ),
      )
      .orderBy(desc(schema.posts.createdAt), desc(schema.posts.id))
      .limit(limit + 1)

    const trimmed = rows.slice(0, limit)
    const last = trimmed[trimmed.length - 1]
    return c.json({
      items: await hydratePosts(db, viewer?.id ?? null, trimmed),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    })
  })

  app.get('/:handle/followers', async (c) => {
    const viewer = c.get('user')
    const db = getDb()
    const handle = c.req.param('handle').toLowerCase()
    const { limit, cursor } = pageParams({ limit: c.req.query('limit'), cursor: c.req.query('cursor') })
    const authors = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.handle}) = ${handle}`)
      .limit(1)
    if (!authors[0]) throw new HttpError(404, 'That account does not exist.')

    // Newest follow first, keyed on the follow row so the cursor stays stable
    // when someone unfollows and follows again.
    const rows = await db
      .select({ ...authorSelect, followedAt: schema.follows.createdAt })
      .from(schema.follows)
      .innerJoin(schema.users, eq(schema.users.id, schema.follows.followerId))
      .where(
        and(
          eq(schema.follows.followingId, authors[0].id),
          beforeCursor(schema.follows.createdAt, schema.follows.followerId, cursor),
        ),
      )
      .orderBy(desc(schema.follows.createdAt), desc(schema.follows.followerId))
      .limit(limit + 1)

    const trimmed = rows.slice(0, limit)
    const last = trimmed[trimmed.length - 1]
    return c.json({
      items: await withCounts(db, viewer?.id ?? null, trimmed),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ createdAt: last.followedAt, id: last.id }) : null,
    })
  })

  app.get('/:handle/following', async (c) => {
    const viewer = c.get('user')
    const db = getDb()
    const handle = c.req.param('handle').toLowerCase()
    const { limit, cursor } = pageParams({ limit: c.req.query('limit'), cursor: c.req.query('cursor') })
    const authors = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.handle}) = ${handle}`)
      .limit(1)
    if (!authors[0]) throw new HttpError(404, 'That account does not exist.')

    const rows = await db
      .select({ ...authorSelect, followedAt: schema.follows.createdAt })
      .from(schema.follows)
      .innerJoin(schema.users, eq(schema.users.id, schema.follows.followingId))
      .where(
        and(
          eq(schema.follows.followerId, authors[0].id),
          beforeCursor(schema.follows.createdAt, schema.follows.followingId, cursor),
        ),
      )
      .orderBy(desc(schema.follows.createdAt), desc(schema.follows.followingId))
      .limit(limit + 1)

    const trimmed = rows.slice(0, limit)
    const last = trimmed[trimmed.length - 1]
    return c.json({
      items: await withCounts(db, viewer?.id ?? null, trimmed),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ createdAt: last.followedAt, id: last.id }) : null,
    })
  })

  app.post('/:handle/follow', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    await enforce(c, 'follow', `user:${user.id}`)
    const db = getDb()
    const target = await db
      .select({ id: schema.users.id, isBot: schema.users.isBot })
      .from(schema.users)
      .where(sql`lower(${schema.users.handle}) = ${c.req.param('handle').toLowerCase()}`)
      .limit(1)
    const other = target[0]
    if (!other) throw new HttpError(404, 'That account does not exist.')
    if (other.id === user.id) {
      return c.json({ error: { message: 'You cannot follow yourself.' } }, 400)
    }
    if (await isBlockedEitherWay(db, user.id, other.id)) {
      return c.json({ error: { message: 'You cannot follow this account.' } }, 400)
    }

    const existing = await db
      .select({ followingId: schema.follows.followingId })
      .from(schema.follows)
      .where(and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, other.id)))
      .limit(1)

    if (existing.length > 0) {
      await db
        .delete(schema.follows)
        .where(and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, other.id)))
      return c.json({ following: false })
    }

    await db
      .insert(schema.follows)
      .values({ followerId: user.id, followingId: other.id })
      .onConflictDoNothing()

    await db.insert(schema.notifications).values({
      id: newId(),
      userId: other.id,
      actorId: user.id,
      type: 'follow',
    })
    return c.json({ following: true })
  })

  app.post('/:handle/mute', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    const db = getDb()
    const other = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.handle}) = ${c.req.param('handle').toLowerCase()}`)
      .limit(1)
    if (!other[0]) throw new HttpError(404, 'That account does not exist.')
    if (other[0].id === user.id) {
      return c.json({ error: { message: 'You cannot mute yourself.' } }, 400)
    }

    const existing = await db
      .select({ mutedId: schema.mutes.mutedId })
      .from(schema.mutes)
      .where(and(eq(schema.mutes.muterId, user.id), eq(schema.mutes.mutedId, other[0].id)))
      .limit(1)
    if (existing.length > 0) {
      await db
        .delete(schema.mutes)
        .where(and(eq(schema.mutes.muterId, user.id), eq(schema.mutes.mutedId, other[0].id)))
      return c.json({ muting: false })
    }
    await db.insert(schema.mutes).values({ muterId: user.id, mutedId: other[0].id })
    return c.json({ muting: true })
  })

  app.post('/:handle/block', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    const db = getDb()
    const other = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.handle}) = ${c.req.param('handle').toLowerCase()}`)
      .limit(1)
    if (!other[0]) throw new HttpError(404, 'That account does not exist.')
    if (other[0].id === user.id) {
      return c.json({ error: { message: 'You cannot block yourself.' } }, 400)
    }


    const existing = await db
      .select({ blockedId: schema.blocks.blockedId })
      .from(schema.blocks)
      .where(and(eq(schema.blocks.blockerId, user.id), eq(schema.blocks.blockedId, other[0].id)))
      .limit(1)

    if (existing.length > 0) {
      await db
        .delete(schema.blocks)
        .where(and(eq(schema.blocks.blockerId, user.id), eq(schema.blocks.blockedId, other[0].id)))
      return c.json({ blocking: false })
    }

    // Blocking also drops the follow edges in both directions, so the timeline
    // cannot still show the blocked account's posts through a follow.
    await db
      .delete(schema.follows)
      .where(
        or(
          and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, other[0].id)),
          and(eq(schema.follows.followerId, other[0].id), eq(schema.follows.followingId, user.id)),
        ),
      )
    await db.insert(schema.blocks).values({ blockerId: user.id, blockedId: other[0].id })
    return c.json({ blocking: true })
  })

  app.get('/settings/blocked', async (c) => {
    const user = requireUser(c)
    const db = getDb()
    const rows = await db
      .select(authorSelect)
      .from(schema.blocks)
      .innerJoin(schema.users, eq(schema.users.id, schema.blocks.blockedId))
      .where(eq(schema.blocks.blockerId, user.id))
      .limit(200)
    return c.json({ users: await withCounts(db, user.id, rows) })
  })

  app.get('/settings/muted', async (c) => {
    const user = requireUser(c)
    const db = getDb()
    const rows = await db
      .select(authorSelect)
      .from(schema.mutes)
      .innerJoin(schema.users, eq(schema.users.id, schema.mutes.mutedId))
      .where(eq(schema.mutes.muterId, user.id))
      .limit(200)
    return c.json({ users: await withCounts(db, user.id, rows) })
  })

  return app
}

async function withCounts(
  db: ReturnType<typeof getDb>,
  viewerId: string | null,
  rows: AuthorRow[],
) {
  const counts = await authorCountsFor(
    db,
    rows.map((r) => r.id),
  )
  const relations = await viewerRelations(
    db,
    viewerId,
    rows.map((r) => r.id),
  )
  return rows.map((row) => ({
    ...toAuthorBase(row),
    counts: counts.get(row.id) ?? { followers: 0, following: 0, posts: 0 },
    viewer: relations.get(row.id),
  }))
}

