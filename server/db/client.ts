import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import type { SQL } from 'drizzle-orm'
import * as schema from './schema.js'

/**
 * The Neon HTTP driver is the right choice for Vercel serverless functions:
 * it opens no TCP connection, so a cold start does not pay for a TLS
 * handshake, and there is nothing to keep warm between invocations.
 */
function createDb() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return drizzle(neon(url), { schema, casing: 'snake_case' })
}

export type Database = ReturnType<typeof createDb>

let cached: Database | undefined

export function getDb(): Database {
  cached ??= createDb()
  return cached
}

/**
 * Runs a raw statement and returns its rows as a plain array.
 *
 * The driver resolves `execute` to a result wrapper whose rows sit under
 * `.rows`, not to an array itself. Reading the wrapper as an array finds no
 * `length` and no indices, so `rows[0]?.value` quietly yields `undefined`
 * instead of throwing: a count query then reports zero forever and nothing else
 * looks wrong. Every raw statement goes through here so that mistake has one
 * place to be made.
 */
export async function executeRows<T>(query: SQL<unknown>, db?: Database): Promise<T[]> {
  const client = db ?? getDb()
  const result = (await client.execute(query)) as { rows?: T[] } | undefined
  return result?.rows ?? []
}

export { schema }
