import { and, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '../db/client.js'
import { schema } from '../db/client.js'
import type { AuthorView, PostView } from '../../shared/types.js'

/** Minimal account shape shared by every view that renders an author. */
export type AuthorRow = {
  id: string
  handle: string
  displayName: string
  bio: string
  avatarSeed: string
  isBot: boolean
  isAdmin: boolean
  createdAt: Date
}

export type Counts = { followers: number; following: number; posts: number }

export type ViewerRelation = {
  following: boolean
  followedBy: boolean
  blocking: boolean
  muting: boolean
  blockedBy: boolean
}

const EMPTY_RELATION: ViewerRelation = {
  following: false,
  followedBy: false,
  blocking: false,
  muting: false,
  blockedBy: false,
}

export function toAuthorBase(user: AuthorRow): Omit<AuthorView, 'counts' | 'viewer'> {
  return {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    bio: user.bio,
    avatarSeed: user.avatarSeed,
    isBot: user.isBot,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt.toISOString(),
  }
}

/**
 * Per-author counters. One grouped query for any number of accounts, so a
 * timeline of 20 posts does not become 20 round trips.
 */
export async function authorCountsFor(db: Database, userIds: string[]): Promise<Map<string, Counts>> {
  const unique = [...new Set(userIds)].filter(Boolean)
  const result = new Map<string, Counts>()
  if (unique.length === 0) return result

  const following = await db
    .select({ id: schema.follows.followingId, total: count() })
    .from(schema.follows)
    .where(inArray(schema.follows.followingId, unique))
    .groupBy(schema.follows.followingId)

  const followers = await db
    .select({ id: schema.follows.followerId, total: count() })
    .from(schema.follows)
    .where(inArray(schema.follows.followerId, unique))
    .groupBy(schema.follows.followerId)

  const postTotals = await db
    .select({ id: schema.posts.authorId, total: count() })
    .from(schema.posts)
    .where(inArray(schema.posts.authorId, unique))
    .groupBy(schema.posts.authorId)

  for (const id of unique) {
    result.set(id, { followers: 0, following: 0, posts: 0 })
  }
  for (const row of following) {
    const entry = result.get(row.id)
    if (entry) entry.following = row.total
  }
  for (const row of followers) {
    const entry = result.get(row.id)
    if (entry) entry.followers = row.total
  }
  for (const row of postTotals) {
    const entry = result.get(row.id)
    if (entry) entry.posts = row.total
  }
  return result
}

export async function authorCounts(db: Database, userId: string): Promise<Counts> {
  const map = await authorCountsFor(db, [userId])
  return map.get(userId) ?? { followers: 0, following: 0, posts: 0 }
}

/** Where the viewer stands relative to a set of accounts. */
export async function viewerRelations(
  db: Database,
  viewerId: string | null,
  targetIds: string[],
): Promise<Map<string, ViewerRelation>> {
  const unique = [...new Set(targetIds)].filter(Boolean)
  const result = new Map<string, ViewerRelation>(unique.map((id) => [id, { ...EMPTY_RELATION }]))
  if (!viewerId || unique.length === 0) return result

  const followRows = await db
    .select({ followerId: schema.follows.followerId, followingId: schema.follows.followingId })
    .from(schema.follows)
    .where(
      or(
        and(
          eq(schema.follows.followerId, viewerId),
          inArray(schema.follows.followingId, unique),
        ),
        and(
          eq(schema.follows.followingId, viewerId),
          inArray(schema.follows.followerId, unique),
        ),
      ),
    )
  for (const row of followRows) {
    if (row.followerId === viewerId) {
      const entry = result.get(row.followingId)
      if (entry) entry.following = true
    } else {
      const entry = result.get(row.followerId)
      if (entry) entry.followedBy = true
    }
  }

  const blockRows = await db
    .select({ blockerId: schema.blocks.blockerId, blockedId: schema.blocks.blockedId })
    .from(schema.blocks)
    .where(
      or(
        and(eq(schema.blocks.blockerId, viewerId), inArray(schema.blocks.blockedId, unique)),
        and(eq(schema.blocks.blockedId, viewerId), inArray(schema.blocks.blockerId, unique)),
      ),
    )
  for (const row of blockRows) {
    if (row.blockerId === viewerId) {
      const entry = result.get(row.blockedId)
      if (entry) entry.blocking = true
    } else {
      const entry = result.get(row.blockerId)
      if (entry) entry.blockedBy = true
    }
  }

  const muteRows = await db
    .select({ mutedId: schema.mutes.mutedId })
    .from(schema.mutes)
    .where(and(eq(schema.mutes.muterId, viewerId), inArray(schema.mutes.mutedId, unique)))
  for (const row of muteRows) {
    const entry = result.get(row.mutedId)
    if (entry) entry.muting = true
  }

  return result
}

/** A post row as selected by `postSelect`, plus its author. */
export type PostWithAuthor = {
  id: string
  body: string
  authorId: string
  replyToId: string | null
  quoteOfId: string | null
  depth: number
  isBotReply: boolean
  replyCount: number
  repostCount: number
  likeCount: number
  quoteCount: number
  createdAt: Date
  author: AuthorRow
}

export type ViewerPostState = {
  liked: boolean
  reposted: boolean
  bookmarked: boolean
  followingAuthor: boolean
}

export function toPostView(
  post: PostWithAuthor,
  viewer: ViewerPostState,
  extras: { counts: Counts; replyTo?: PostView | null; quoteOf?: PostView | null },
): PostView {
  return {
    id: post.id,
    body: post.body,
    createdAt: post.createdAt.toISOString(),
    author: { ...toAuthorBase(post.author), counts: extras.counts },
    replyToId: post.replyToId,
    quoteOfId: post.quoteOfId,
    depth: post.depth,
    isBotReply: post.isBotReply,
    counts: {
      replies: post.replyCount,
      reposts: post.repostCount,
      likes: post.likeCount,
      quotes: post.quoteCount,
    },
    viewer,
    ...(extras.replyTo ? { replyTo: extras.replyTo } : {}),
    ...(extras.quoteOf ? { quoteOf: extras.quoteOf } : {}),
  }
}

/**
 * Attaches author counters, viewer state and any quoted post to a batch of
 * posts, using a fixed number of queries regardless of batch size.
 */
export async function hydratePosts(
  db: Database,
  viewerId: string | null,
  posts: PostWithAuthor[],
  options: { includeQuoted?: boolean } = {},
): Promise<PostView[]> {
  if (posts.length === 0) return []

  const authorIds = posts.map((p) => p.authorId)
  const counts = await authorCountsFor(db, authorIds)
  const relations = await viewerRelations(db, viewerId, authorIds)

  const postIds = posts.map((p) => p.id)
  const liked = new Set<string>()
  const reposted = new Set<string>()
  const bookmarked = new Set<string>()
  if (viewerId) {
    const [l, r, b] = await Promise.all([
      db
        .select({ postId: schema.likes.postId })
        .from(schema.likes)
        .where(and(eq(schema.likes.userId, viewerId), inArray(schema.likes.postId, postIds))),
      db
        .select({ postId: schema.reposts.postId })
        .from(schema.reposts)
        .where(and(eq(schema.reposts.userId, viewerId), inArray(schema.reposts.postId, postIds))),
      db
        .select({ postId: schema.bookmarks.postId })
        .from(schema.bookmarks)
        .where(and(eq(schema.bookmarks.userId, viewerId), inArray(schema.bookmarks.postId, postIds))),
    ])
    for (const row of l) liked.add(row.postId)
    for (const row of r) reposted.add(row.postId)
    for (const row of b) bookmarked.add(row.postId)
  }

  // Quoted posts are fetched in one extra query and reused across the batch.
  const quotedIds = [
    ...new Set(posts.map((p) => p.quoteOfId).filter((id): id is string => Boolean(id))),
  ]
  const quotedMap = new Map<string, PostWithAuthor>()
  if (options.includeQuoted && quotedIds.length > 0) {
    const quoted = await fetchPostsByIds(db, quotedIds)
    for (const post of quoted) quotedMap.set(post.id, post)
  }

  const views: PostView[] = []
  for (const post of posts) {
    const relation = relations.get(post.authorId)
    let quoteOf: PostView | undefined
    if (options.includeQuoted && post.quoteOfId) {
      const quoted = quotedMap.get(post.quoteOfId)
      if (quoted) {
        quoteOf = toPostView(quoted, {
          liked: liked.has(quoted.id),
          reposted: reposted.has(quoted.id),
          bookmarked: bookmarked.has(quoted.id),
          followingAuthor: relations.get(quoted.authorId)?.following ?? false,
        }, { counts: counts.get(quoted.authorId) ?? { followers: 0, following: 0, posts: 0 } })
      }
    }
    views.push(
      toPostView(
        post,
        {
          liked: liked.has(post.id),
          reposted: reposted.has(post.id),
          bookmarked: bookmarked.has(post.id),
          followingAuthor: relation?.following ?? false,
        },
        { counts: counts.get(post.authorId) ?? { followers: 0, following: 0, posts: 0 }, quoteOf },
      ),
    )
  }
  return views
}

export const postSelect = {
  id: schema.posts.id,
  body: schema.posts.body,
  authorId: schema.posts.authorId,
  replyToId: schema.posts.replyToId,
  quoteOfId: schema.posts.quoteOfId,
  depth: schema.posts.depth,
  isBotReply: schema.posts.isBotReply,
  replyCount: schema.posts.replyCount,
  repostCount: schema.posts.repostCount,
  likeCount: schema.posts.likeCount,
  quoteCount: schema.posts.quoteCount,
  createdAt: schema.posts.createdAt,
} as const

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

/** Fetch posts with their authors by id, preserving nothing about order. */
export async function fetchPostsByIds(db: Database, ids: string[]): Promise<PostWithAuthor[]> {
  if (ids.length === 0) return []
  return db
    .select({ ...postSelect, author: authorSelect })
    .from(schema.posts)
    .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
    .where(inArray(schema.posts.id, ids))
}

export { and, eq, inArray, desc, sql }
export type { SQL }
