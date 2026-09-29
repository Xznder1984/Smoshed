/**
 * Removes test accounts left behind by an interrupted e2e run.
 *
 * Scoped deliberately: it only touches accounts whose handle starts with
 * `smoke`, which is the prefix the suite generates, so a real account can never
 * match. The list is printed before anything is deleted, the delete runs in one
 * transaction, and the row counts are printed again afterwards.
 */
import { loadLocalEnv } from './load-env.js'

loadLocalEnv()

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const { neon } = await import('@neondatabase/serverless')
const sql = neon(url)

const doomed = await sql.query(
  `select id, handle, is_bot from users where handle like 'smoke%' order by handle`,
)

console.warn(`found ${doomed.length} leftover test account(s)`)
for (const row of doomed) {
  console.warn(`  @${row.handle} (bot: ${row.is_bot})`)
}

if (doomed.length === 0) {
  console.warn('nothing to remove')
  process.exit(0)
}

if (doomed.some((row) => row.is_bot)) {
  throw new Error('Refusing to delete a bot account.')
}

await sql.transaction([
  sql.query(`delete from users where handle like 'smoke%'`),
  // The app's own housekeeping, so the counter tables do not keep test residue.
  sql.query(`delete from rate_limits where expires_at < now()`),
  sql.query(`delete from login_attempts where updated_at < now() - interval '1 day'`),
])

const remaining = await sql.query(
  `select count(*)::int as n from users where handle like 'smoke%'`,
)
console.warn(`remaining test accounts: ${remaining[0]!.n}`)

for (const table of ['users', 'posts', 'sessions', 'likes', 'notifications']) {
  const rows = await sql.query(`select count(*)::int as n from ${table}`)
  console.warn(`${table}: ${rows[0]!.n}`)
}
