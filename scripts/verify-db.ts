/**
 * Read-only verification of the schema state that the app depends on. Prints
 * booleans and counts only, never secrets or row contents.
 */
import { loadLocalEnv } from './load-env.js'

loadLocalEnv()

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const { neon } = await import('@neondatabase/serverless')
const sql = neon(url)

const bot = await sql.query(
  `select id, handle, is_bot, is_admin from users where id = 'smosh-bot'`,
)
console.error('bot user:', JSON.stringify(bot))

const reauth = await sql.query(
  `select count(*)::int as n from information_schema.columns
   where table_name = 'sessions' and column_name = 'reauthenticated_at'`,
)
console.error('reauthenticated_at present:', JSON.stringify(reauth))

const posts = await sql.query(`select count(*)::int as n from posts`)
console.error('posts:', JSON.stringify(posts))

const applied = await sql.query(
  `select count(*)::int as n from drizzle.__drizzle_migrations`,
)
console.error('migrations recorded:', JSON.stringify(applied))
