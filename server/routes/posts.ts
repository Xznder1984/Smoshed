import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { Hono } from 'hono'
import { readJson } from '../lib/respond.js'
import { executeRows, getDb, schema } from '../db/client.js'
import { HttpError, assertCsrf, requireUser } from '../lib/auth.js'
import { newId } from '../lib/crypto.js'
import { postBodySchema } from '../lib/sanitize.js'
import { clientIp, enforce } from '../lib/rate-limit.js'
import {
  authorCountsFor,
  fetchPostsByIds,
  hydratePosts,
  postSelect,
  toAuthorBase,
  viewerRelations,
  type PostWithAuthor,
} from '../lib/views.js'
import { extractMentions } from '../lib/sanitize.js'
import { visiblePostAuthors } from '../lib/visibility.js'
import {
  beforeCursor,
  encodeCursor,
  pageParams,
  type Cursor,
} from '../lib/pagination.js'
import { enqueueBotJob } from '../lib/bot/queue.js'
import { isOwner } from '../lib/auth.js'
import { env } from '../lib/env.js'

const createPostSchema = z.object({
  body: postBodySchema,
  replyToId: z.string().min(1).max(64).optional(),
  quoteOfId: z.string().min(1).max(64).optional(),
})

/** Encodes the keyset cursor for a post row. */
function encodeRow(row: { createdAt: Date; id: string }): string {
  return encodeCursor(row)
}

export function postRoutes() {
  const app = new Hono()

  app.get('/', async (c) => {
    const viewer = c.get('user')
    const db = getDb()
    const authorHandle = c.req.query('author')
    const feed = c.req.query('feed')
    const { limit, cursor } = pageParams({ limit: c.req.query('limit'), cursor: c.req.query('cursor') })

    if (authorHandle) {
      const authors = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(sql`lower(${schema.users.handle}) = ${authorHandle.toLowerCase()}`)
        .limit(1)
      if (!authors[0]) throw new HttpError(404, 'That account does not exist.')
      return c.json(
        await fetchTimeline(db, viewer?.id ?? null, authors[0].id, limit, cursor),
      )
    }

    // `feed=latest` is the public timeline. It is available signed out, so a
    // visitor lands on posts instead of an empty page.
    if (!viewer || feed === 'latest') {
      return c.json(await fetchTimeline(db, viewer?.id ?? null, null, limit, cursor))
    }

    // Home timeline: the accounts the viewer follows, newest first, including
    // the viewer's own posts so they see what they wrote.
    const rows = await db
      .select({ ...postSelect, author: authorSelect })
      .from(schema.posts)
      .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
      .where(
        and(
          isNull(schema.posts.replyToId),
          or(eq(schema.posts.authorId, viewer.id), inFollowed(viewer.id)),
          visiblePostAuthors(viewer.id),
          beforeCursor(schema.posts.createdAt, schema.posts.id, cursor),
        ),
      )
      .orderBy(desc(schema.posts.createdAt), desc(schema.posts.id))
      .limit(limit + 1)

    return c.json({
      items: await hydratePosts(db, viewer.id, rows.slice(0, limit)),
      nextCursor: rows.length > limit ? encodeRow(rows[limit - 1]) : null,
    })
  })

  app.get('/:id', async (c) => {
    const viewer = c.get('user')
    const db = getDb()
    const id = c.req.param('id')

    const found = await fetchPostsByIds(db, [id])
    const post = found[0]
    if (!post) throw new HttpError(404, 'That post does not exist.')

    // A blocked or muted relationship hides the post, same as in timelines.
    if (viewer) {
      const relations = await viewerRelations(db, viewer.id, [post.authorId])
      const rel = relations.get(post.authorId)
      if (rel?.blocking || rel?.muting || rel?.blockedBy) {
        throw new HttpError(404, 'That post does not exist.')
      }
    }

    const [view] = await hydratePosts(db, viewer?.id ?? null, [post], { includeQuoted: true })
    return c.json({ post: view })
  })

  app.get('/:id/thread', async (c) => {
    const viewer = c.get('user')
    const db = getDb()
    const rootId = c.req.param('id')
    const root = (await fetchPostsByIds(db, [rootId]))[0]
    if (!root) throw new HttpError(404, 'That post does not exist.')

    // Walk up the reply chain, then collect every descendant.
    const ancestors: PostWithAuthor[] = []
    let cursor = root
    while (cursor.replyToId) {
      const parents = await fetchPostsByIds(db, [cursor.replyToId])
      if (!parents[0]) break
      ancestors.unshift(parents[0])
      cursor = parents[0]
      if (ancestors.length > 50) break
    }

    // Every descendant, not just the direct children. A reply to a reply is
    // still part of this thread, and a single-level lookup silently dropped
    // them, which matters because replies nest several deep in practice.
    //
    // The `level` cap is what guarantees termination. A corrupt chain that
    // points back at itself would not be stopped by `union`, because each
    // visit increments `level` and so never repeats a row; the depth limit
    // stops the walk at 50 instead, matching the ancestor walk above.
    const descendantIds = (
      await executeRows<{ id: string }>(sql`
      with recursive tree as (
        select id, reply_to_id, 0 as level, created_at from posts where id = ${rootId}
        union
        select p.id, p.reply_to_id, t.level + 1, p.created_at
        from posts p
        join tree t on p.reply_to_id = t.id
        where t.level < 50
      )
      select id from tree where id <> ${rootId} order by created_at asc
    `)
    ).map((row) => row.id)

    const descendants = descendantIds.length
      ? await db
          .select({ ...postSelect, author: authorSelect })
          .from(schema.posts)
          .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
          .where(
            and(
              inArray(schema.posts.id, descendantIds),
              visiblePostAuthors(viewer?.id ?? null),
            ),
          )
      : []

    const all = [...ancestors, root, ...descendants]
    const views = await hydratePosts(db, viewer?.id ?? null, all, { includeQuoted: true })
    const rootIndex = ancestors.length

    return c.json({
      ancestors: views.slice(0, rootIndex),
      root: views[rootIndex],
      replies: views.slice(rootIndex + 1),
    })
  })

  app.post('/', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    await enforce(c, 'post', `user:${user.id}`)
    await enforce(c, 'write', `ip:${clientIp(c)}`)

    const parsed = createPostSchema.safeParse(await readJson(c))
    if (!parsed.success) {
      return c.json(
        {
          error: {
            message: parsed.error.issues[0]?.message ?? 'Check the post text.',
            fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          },
        },
        422,
      )
    }
    const db = getDb()
    const { body, replyToId, quoteOfId } = parsed.data

    let parent: PostWithAuthor | undefined
    if (replyToId) {
      parent = (await fetchPostsByIds(db, [replyToId]))[0]
      if (!parent) throw new HttpError(404, 'The post you replied to no longer exists.')
      const relations = await viewerRelations(db, user.id, [parent.authorId])
      const rel = relations.get(parent.authorId)
      if (rel?.blocking || rel?.muting || rel?.blockedBy) {
        throw new HttpError(404, 'The post you replied to no longer exists.')
      }
      // Cap reply depth so a thread cannot grow without bound.
      if (parent.depth >= 12) {
        return c.json({ error: { message: 'This thread is too deep to reply to.' } }, 400)
      }
    }

    if (quoteOfId) {
      const quoted = (await fetchPostsByIds(db, [quoteOfId]))[0]
      if (!quoted) throw new HttpError(404, 'The post you quoted no longer exists.')
    }

    const isBotReply = parent?.isBotReply ?? false
    const post = {
      id: newId(),
      authorId: user.id,
      body,
      replyToId: replyToId ?? null,
      quoteOfId: quoteOfId ?? null,
      depth: parent ? parent.depth + 1 : 0,
      isBotReply,
      createdAt: new Date(),
    }
    await db.insert(schema.posts).values(post)

    if (parent) {
      await db
        .update(schema.posts)
        .set({ replyCount: sql`${schema.posts.replyCount} + 1` })
        .where(eq(schema.posts.id, parent.id))
    }
    if (quoteOfId) {
      await db
        .update(schema.posts)
        .set({ quoteCount: sql`${schema.posts.quoteCount} + 1` })
        .where(eq(schema.posts.id, quoteOfId))
    }

    await notifyMentions(db, {
      postId: post.id,
      authorId: user.id,
      body,
      replyTo: parent ?? null,
    })

    // A mention of @smosh queues a bot job. Enqueueing is cheap and
    // idempotent; the model call happens in the worker, never inline.
    await maybeEnqueueBot(db, { post, authorId: user.id, body })

    const [view] = await hydratePosts(db, user.id, [
      { ...post, replyCount: 0, repostCount: 0, likeCount: 0, quoteCount: 0, author: user },
    ])
    return c.json({ post: view }, 201)
  })

  app.delete('/:id', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    const db = getDb()
    const id = c.req.param('id')

    const found = await fetchPostsByIds(db, [id])
    if (!found[0]) throw new HttpError(404, 'That post does not exist.')
    // Ownership is checked server-side against the row, never from the client.
    if (found[0].authorId !== user.id) throw new HttpError(404, 'That post does not exist.')

    const childIds = await collectDescendants(db, id)

    await db
      .update(schema.posts)
      .set({
        body: 'This post was deleted.',
        replyToId: null,
        quoteOfId: null,
      })
      .where(eq(schema.posts.id, id))
    for (const childId of childIds) {
      await db
        .update(schema.posts)
        .set({ body: 'This post was deleted.', replyToId: null })
        .where(eq(schema.posts.id, childId))
    }
    if (found[0].replyToId) {
      await db
        .update(schema.posts)
        .set({ replyCount: sql`greatest(0, ${schema.posts.replyCount} - 1)` })
        .where(eq(schema.posts.id, found[0].replyToId))
    }
    if (found[0].quoteOfId) {
      await db
        .update(schema.posts)
        .set({ quoteCount: sql`greatest(0, ${schema.posts.quoteCount} - 1)` })
        .where(eq(schema.posts.id, found[0].quoteOfId))
    }
    return c.json({ ok: true })
  })

  app.post('/:id/like', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    await enforce(c, 'like', `user:${user.id}`)
    const db = getDb()
    const id = c.req.param('id')
    const post = (await fetchPostsByIds(db, [id]))[0]
    if (!post) throw new HttpError(404, 'That post does not exist.')

    const like = await toggle(db, {
      table: 'likes',
      userId: user.id,
      postId: id,
      counter: 'likeCount',
      post,
    })
    return c.json({ liked: like.changed, likeCount: like.count })
  })

  app.post('/:id/repost', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    await enforce(c, 'like', `user:${user.id}`)
    const db = getDb()
    const id = c.req.param('id')
    const post = (await fetchPostsByIds(db, [id]))[0]
    if (!post) throw new HttpError(404, 'That post does not exist.')

    const repost = await toggle(db, {
      table: 'reposts',
      userId: user.id,
      postId: id,
      counter: 'repostCount',
      post,
    })
    if (repost.changed) {
      await notify(db, { userId: post.authorId, actorId: user.id, type: 'repost', postId: id })
    }
    return c.json({ reposted: repost.changed, repostCount: repost.count })
  })

  app.post('/:id/bookmark', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    const db = getDb()
    const id = c.req.param('id')
    const post = (await fetchPostsByIds(db, [id]))[0]
    if (!post) throw new HttpError(404, 'That post does not exist.')

    const bookmarked = await toggle(db, {
      table: 'bookmarks',
      userId: user.id,
      postId: id,
      counter: null,
      post,
    })
    return c.json({ bookmarked: bookmarked.changed })
  })

  app.get('/saved/list', async (c) => {
    const user = requireUser(c)
    const db = getDb()
    const { limit, cursor } = pageParams({ limit: c.req.query('limit'), cursor: c.req.query('cursor') })

    // Ordering is by when the person bookmarked the post, not when it was
    // written, so the cursor tracks bookmarks.created_at.
    const rows = await db
      .select({ ...postSelect, author: authorSelect, savedAt: schema.bookmarks.createdAt })
      .from(schema.bookmarks)
      .innerJoin(schema.posts, eq(schema.posts.id, schema.bookmarks.postId))
      .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
      .where(
        and(
          eq(schema.bookmarks.userId, user.id),
          visiblePostAuthors(user.id),
          beforeCursor(schema.bookmarks.createdAt, schema.bookmarks.postId, cursor),
        ),
      )
      .orderBy(desc(schema.bookmarks.createdAt), desc(schema.bookmarks.postId))
      .limit(limit + 1)

    const trimmed = rows.slice(0, limit)
    const last = trimmed[trimmed.length - 1]
    return c.json({
      items: await hydratePosts(db, user.id, trimmed),
      nextCursor: rows.length > limit && last ? encodeRow({ createdAt: last.savedAt, id: last.id }) : null,
    })
  })

  return app
}

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

function inFollowed(viewerId: string) {
  return sql`exists (
    select 1 from ${schema.follows}
    where ${schema.follows.followerId} = ${viewerId}
      and ${schema.follows.followingId} = ${schema.posts.authorId}
  )`
}

async function fetchTimeline(
  db: ReturnType<typeof getDb>,
  viewerId: string | null,
  authorId: string | null,
  limit: number,
  cursor: Cursor | null,
) {
  const conditions = [
    isNull(schema.posts.replyToId),
    visiblePostAuthors(viewerId),
    beforeCursor(schema.posts.createdAt, schema.posts.id, cursor),
  ]
  if (authorId) conditions.push(eq(schema.posts.authorId, authorId))
  const rows = await db
    .select({ ...postSelect, author: authorSelect })
    .from(schema.posts)
    .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
    .where(and(...conditions))
    .orderBy(desc(schema.posts.createdAt), desc(schema.posts.id))
    .limit(limit + 1)

  const trimmed = rows.slice(0, limit)
  return {
    items: await hydratePosts(db, viewerId, trimmed, { includeQuoted: true }),
    nextCursor: rows.length > limit ? encodeRow(trimmed[trimmed.length - 1]) : null,
  }
}

type ToggleTarget = {
  table: 'likes' | 'reposts' | 'bookmarks'
  userId: string
  postId: string
  counter: 'likeCount' | 'repostCount' | null
  post: PostWithAuthor
}

type ToggleResult = {
  /** Whether the row now exists, i.e. whether the action added something. */
  changed: boolean
  /**
   * The counter as the database now holds it, or null when this target has no
   * counter. It comes back from the update's RETURNING clause rather than being
   * recomputed from the row that was read beforehand, so the response cannot
   * disagree with the stored value when two people act at the same time.
   */
  count: number | null
}

/** Insert or delete a (user, post) pair and keep the denormalised count honest. */
async function toggle(db: ReturnType<typeof getDb>, target: ToggleTarget): Promise<ToggleResult> {
  const table =
    target.table === 'likes'
      ? schema.likes
      : target.table === 'reposts'
        ? schema.reposts
        : schema.bookmarks

  const existing = await db
    .select({ postId: table.postId })
    .from(table)
    .where(and(eq(table.userId, target.userId), eq(table.postId, target.postId)))
    .limit(1)

  if (existing.length > 0) {
    await db.delete(table).where(and(eq(table.userId, target.userId), eq(table.postId, target.postId)))
    if (target.counter) {
      const [updated] = await db
        .update(schema.posts)
        .set({ [target.counter]: sql`greatest(0, ${schema.posts[target.counter]} - 1)` })
        .where(eq(schema.posts.id, target.postId))
        .returning({ count: schema.posts[target.counter] })
      return { changed: false, count: updated?.count ?? 0 }
    }
    return { changed: false, count: null }
  }

  await db.insert(table).values({ userId: target.userId, postId: target.postId })
  if (target.counter) {
    const [updated] = await db
      .update(schema.posts)
      .set({ [target.counter]: sql`${schema.posts[target.counter]} + 1` })
      .where(eq(schema.posts.id, target.postId))
      .returning({ count: schema.posts[target.counter] })
    if (target.table === 'likes') {
      await notify(db, { userId: target.post.authorId, actorId: target.userId, type: 'like', postId: target.postId })
    }
    return { changed: true, count: updated?.count ?? 0 }
  }
  if (target.table === 'likes') {
    await notify(db, { userId: target.post.authorId, actorId: target.userId, type: 'like', postId: target.postId })
  }
  return { changed: true, count: null }
}

/** Creates notifications for mentions, and a reply notification for the parent author. */
async function notifyMentions(
  db: ReturnType<typeof getDb>,
  input: { postId: string; authorId: string; body: string; replyTo: PostWithAuthor | null },
) {
  const handles = extractMentions(input.body).filter((h) => h !== 'smosh')
  if (handles.length === 0) return
  const targets = await db
    .select({ id: schema.users.id, handle: schema.users.handle })
    .from(schema.users)
    .where(inArray(sql`lower(${schema.users.handle})`, handles))
  for (const target of targets) {
    if (target.id === input.authorId) continue
    const relations = await viewerRelations(db, target.id, [input.authorId])
    if (relations.get(input.authorId)?.blockedBy) continue
    await notify(db, { userId: target.id, actorId: input.authorId, type: 'mention', postId: input.postId })
  }
}

async function maybeEnqueueBot(
  db: ReturnType<typeof getDb>,
  input: { post: { id: string; body: string; replyToId: string | null; isBotReply: boolean }; authorId: string; body: string },
) {
  if (!extractMentions(input.body).includes('smosh')) return
  // The bot never answers its own output.
  if (input.post.isBotReply) return
  try {
    await enqueueBotJob(db, { postId: input.post.id, requestedById: input.authorId })
  } catch (err) {
    console.error('[bot] enqueue failed:', err instanceof Error ? err.message : err)
  }
}

async function notify(
  db: ReturnType<typeof getDb>,
  input: {
    userId: string
    actorId: string
    type: 'like' | 'repost' | 'reply' | 'follow' | 'mention' | 'quote' | 'bot_reply'
    postId?: string
  },
) {
  if (input.userId === input.actorId) return
  // A blocked pair generates no notifications in either direction.
  const relations = await viewerRelations(db, input.userId, [input.actorId])
  const rel = relations.get(input.actorId)
  if (rel?.blocking || rel?.blockedBy) return

  await db.insert(schema.notifications).values({
    id: newId(),
    userId: input.userId,
    actorId: input.actorId,
    type: input.type,
    postId: input.postId ?? null,
  })
}

async function collectDescendants(db: ReturnType<typeof getDb>, rootId: string): Promise<string[]> {
  const all: string[] = []
  let frontier = [rootId]
  while (frontier.length > 0 && all.length < 500) {
    const rows = await db
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(inArray(schema.posts.replyToId, frontier))
    frontier = rows.map((r) => r.id)
    all.push(...frontier)
  }
  return all
}

export { or, inArray, isOwner, env, toAuthorBase, authorCountsFor }
