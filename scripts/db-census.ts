/**
 * Read-only housekeeping check.
 *
 * Prints counts only, never addresses or row contents. Useful after a test run
 * that may have been interrupted, so leftover rows can be found and removed by
 * hand with the owner's approval.
 */
import { loadLocalEnv } from './load-env.js'

loadLocalEnv()

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const { neon } = await import('@neondatabase/serverless')
const sql = neon(url)

const tables = [
  'users',
  'posts',
  'sessions',
  'likes',
  'reposts',
  'bookmarks',
  'notifications',
  'reports',
  'follows',
  'blocks',
  'mutes',
  'password_reset_tokens',
  'bot_jobs',
  'rate_limits',
  'login_attempts',
] as const

for (const table of tables) {
  const rows = await sql.query(`select count(*)::int as n from ${table}`)
  console.warn(`${table}: ${rows[0]!.n}`)
}

const leftovers = await sql.query(
  `select count(*)::int as n from users where handle like 'smoke%'`,
)
console.warn(`leftover test accounts: ${leftovers[0]!.n}`)

const expired = await sql.query(
  `select count(*)::int as n from sessions where expires_at < now()`,
)
console.warn(`expired sessions: ${expired[0]!.n}`)
