import { and, eq, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '../db/client.js'
import { schema } from '../db/client.js'

/**
 * Subquery returning every user id the viewer must not see content from:
 * accounts they blocked, accounts that blocked them, and accounts they muted.
 *
 * One subquery keeps the visibility rule in a single place, so a new timeline
 * cannot accidentally forget one of the three cases.
 */
export function hiddenAuthors(viewerId: string | null): SQL | undefined {
  if (!viewerId) return undefined
  return sql`(
    select ${schema.blocks.blockedId} as id from ${schema.blocks}
      where ${schema.blocks.blockerId} = ${viewerId}
    union
    select ${schema.blocks.blockerId} as id from ${schema.blocks}
      where ${schema.blocks.blockedId} = ${viewerId}
    union
    select ${schema.mutes.mutedId} as id from ${schema.mutes}
      where ${schema.mutes.muterId} = ${viewerId}
  )`
}

/** Predicate restricting a posts query to what the viewer may read. */
export function visiblePostAuthors(viewerId: string | null): SQL | undefined {
  const hidden = hiddenAuthors(viewerId)
  if (!hidden) return undefined
  return sql`${schema.posts.authorId} not in (${hidden})`
}

export async function isBlockedEitherWay(db: Database, aId: string, bId: string): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(schema.blocks)
    .where(
      or(
        and(eq(schema.blocks.blockerId, aId), eq(schema.blocks.blockedId, bId)),
        and(eq(schema.blocks.blockerId, bId), eq(schema.blocks.blockedId, aId)),
      ),
    )
    .limit(1)
  return rows.length > 0
}

export async function hasBlocked(
  db: Database,
  blockerId: string,
  blockedId: string,
): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(schema.blocks)
    .where(and(eq(schema.blocks.blockerId, blockerId), eq(schema.blocks.blockedId, blockedId)))
    .limit(1)
  return rows.length > 0
}

export async function hasMuted(db: Database, muterId: string, mutedId: string): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(schema.mutes)
    .where(and(eq(schema.mutes.muterId, muterId), eq(schema.mutes.mutedId, mutedId)))
    .limit(1)
  return rows.length > 0
}

export async function isFollowing(
  db: Database,
  followerId: string,
  followingId: string,
): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(schema.follows)
    .where(
      and(eq(schema.follows.followerId, followerId), eq(schema.follows.followingId, followingId)),
    )
    .limit(1)
  return rows.length > 0
}

export async function hiddenAuthorIds(db: Database, viewerId: string): Promise<string[]> {
  const rows = await db
    .select({ blocker: schema.blocks.blockerId, blocked: schema.blocks.blockedId })
    .from(schema.blocks)
    .where(or(eq(schema.blocks.blockerId, viewerId), eq(schema.blocks.blockedId, viewerId)))
  const set = new Set<string>()
  for (const row of rows) {
    if (row.blocker === viewerId) set.add(row.blocked)
    else set.add(row.blocker)
  }
  const muted = await db
    .select({ id: schema.mutes.mutedId })
    .from(schema.mutes)
    .where(eq(schema.mutes.muterId, viewerId))
  for (const row of muted) set.add(row.id)
  return [...set]
}
