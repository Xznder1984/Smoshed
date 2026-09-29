import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import type { Database } from '../db/client.js'
import { schema } from '../db/client.js'
import { hiddenAuthors } from './visibility.js'
import { postSelect, hydratePosts, type PostWithAuthor } from './views.js'
import type { PostView } from '../../shared/types.js'

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

/**
 * Builds a Postgres full-text query against the generated `search` vector.
 *
 * `websearch_to_tsquery` accepts the quoted-phrase and OR syntax people expect
 * from a search box, and `plainto_tsquery` handles a bare list of words safely
 * without any quoting rules to get wrong.
 */
function toTsQuery(term: string): SQL {
  const trimmed = term.trim()
  if (!trimmed) return sql`plainto_tsquery('simple', ${''})`
  // A bare word or several words: safe default parser.
  if (!/[&|!():*]/.test(trimmed)) return sql`plainto_tsquery('simple', ${trimmed})`
  return sql`websearch_to_tsquery('simple', ${trimmed})`
}

/** Ranks posts by relevance, with recency as the tie-breaker. */
function rankExpression(term: string): SQL {
  return sql`ts_rank(${schema.posts.search}, ${toTsQuery(term)})`
}

export type SearchResult = {
  posts: PostView[]
  users: AuthorResult[]
}

export type AuthorResult = {
  id: string
  handle: string
  displayName: string
  bio: string
  avatarSeed: string
  isBot: boolean
  isAdmin: boolean
  createdAt: string
}

export async function search(
  db: Database,
  viewerId: string | null,
  term: string,
  limit: number,
): Promise<SearchResult> {
  const trimmed = term.trim()
  if (trimmed.length === 0) return { posts: [], users: [] }

  const handleOnly = /^@?[a-z0-9_]+$/i.test(trimmed)
  const like = `%${escapeLike(trimmed.replace(/^@/, '').toLowerCase())}%`

  const postRows = await db
    .select({ ...postSelect, author: authorSelect })
    .from(schema.posts)
    .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
    .where(
      and(
        sql`${schema.posts.search} @@ ${toTsQuery(trimmed)}`,
        sql`${schema.posts.authorId} not in (${hiddenAuthors(viewerId) ?? sql`select null::text`})`,
      ),
    )
    .orderBy(desc(rankExpression(trimmed)), desc(schema.posts.createdAt))
    .limit(limit)

  const userRows = await db
    .select(authorSelect)
    .from(schema.users)
    .where(
      and(
        // Prefix match on the handle, plus a text match on the name and bio.
        handleOnly
          ? sql`lower(${schema.users.handle}) like ${like} escape '\\'`
          : sql`(
              ${schema.users.handle} || ' ' || ${schema.users.displayName} || ' ' || ${schema.users.bio}
            ) @@ ${toTsQuery(trimmed)}`,
        sql`${schema.users.id} not in (${hiddenAuthors(viewerId) ?? sql`select null::text`})`,
      ),
    )
    .orderBy(handleOnly ? schema.users.handle : sql`lower(${schema.users.displayName})`)
    .limit(limit)

  const users: AuthorResult[] = userRows.map((row) => ({
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    bio: row.bio,
    avatarSeed: row.avatarSeed,
    isBot: row.isBot,
    isAdmin: row.isAdmin,
    createdAt: row.createdAt.toISOString(),
  }))

  const posts = await hydratePosts(db, viewerId, postRows as PostWithAuthor[], {
    includeQuoted: true,
  })

  return { posts, users }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}
