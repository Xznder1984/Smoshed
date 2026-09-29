import { and, eq, lt, or, type SQL } from 'drizzle-orm'
import type { Column } from 'drizzle-orm'

/**
 * Cursor pagination for the list endpoints.
 *
 * Keyset (seek) pagination is used rather than offsets because a timeline
 * paginated by offset silently skips or repeats posts when something new
 * arrives, which is exactly what happens on a feed that polls.
 *
 * Rows are ordered newest first, so the cursor means "everything strictly
 * older than this (createdAt, id) pair". The id is part of the key because
 * several rows can share a timestamp and a timestamp alone would either drop
 * or duplicate them.
 */
export type Cursor = { createdAt: Date; id: string }

export type Page<T> = { items: T[]; nextCursor: string | null }

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

/** Reads and bounds the `limit`/`cursor` query parameters. */
export function pageParams(query: {
  limit?: string
  cursor?: string
}): { limit: number; cursor: Cursor | null } {
  // An empty `?limit=` is as good as absent. `Number('')` is 0, which would
  // otherwise clamp to a limit of 1 and silently truncate the feed.
  const requested = query.limit?.trim()
  const raw = requested ? Number(requested) : Number.NaN
  const limit = Number.isFinite(raw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(raw)))
    : DEFAULT_LIMIT
  return { limit, cursor: decodeCursor(query.cursor) }
}

function decodeCursor(raw: string | undefined | null): Cursor | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const { t, i } = parsed as { t?: unknown; i?: unknown }
    if (typeof t !== 'string' || typeof i !== 'string') return null
    const createdAt = new Date(t)
    if (Number.isNaN(createdAt.getTime())) return null
    return { createdAt, id: i }
  } catch {
    // A tampered or stale cursor is treated as "start from the top" rather than
    // a 400: the client can recover by refetching the first page.
    return null
  }
}

/** Exposed for tests. A bad cursor must never throw, only fall back to page one. */
export function decodeCursorForTest(raw: string | undefined | null): Cursor | null {
  return decodeCursor(raw)
}

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), i: row.id }), 'utf8').toString(
    'base64url',
  )
}

/**
 * The `where` fragment for "strictly older than the cursor", or undefined on the
 * first page. Pair it with `orderBy(desc(createdAt), desc(id))`.
 */
export function beforeCursor(
  createdAt: Column,
  id: Column,
  cursor: Cursor | null,
): SQL | undefined {
  if (!cursor) return undefined
  return or(lt(createdAt, cursor.createdAt), and(eq(createdAt, cursor.createdAt), lt(id, cursor.id)))
}

/**
 * Trims an over-fetched page to the requested size and reports the cursor for
 * the next page. Query with `limit(limit + 1)` so the presence of one extra row
 * is the only signal that another page exists.
 */
export function toPage<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number,
  toItem: (row: T) => unknown,
): Page<unknown> {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  return {
    items: items.map(toItem),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  }
}
