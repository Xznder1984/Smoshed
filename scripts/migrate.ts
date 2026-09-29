/**
 * Applies any part of the generated migrations that is not yet present, using
 * idempotent statements only, then records completed migrations.
 *
 * The neon-http migrator runs each statement in its own request with no
 * surrounding transaction, so a slow index build or a transient error can stop
 * it part-way and leave the bookkeeping table empty. Re-running would then fail
 * on "already exists". This script closes that gap without dropping anything:
 * existing objects are detected and skipped, so it is safe to run repeatedly.
 */
import { loadLocalEnv } from './load-env.js'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

loadLocalEnv()

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = resolve(root, 'drizzle')

/**
 * Rewrites a DDL statement to be idempotent so re-runs are safe.
 *
 * Postgres has no `CREATE TYPE IF NOT EXISTS`, and `CREATE INDEX IF NOT EXISTS`
 * does not exist either, so those are handled by the caller's "already exists"
 * tolerance instead. Only the forms Postgres actually supports are rewritten.
 */
function makeIdempotent(statement: string): string {
  return statement
    .replace(/^CREATE TABLE (?!IF NOT EXISTS)/i, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/^ALTER TABLE (\S+) ADD CONSTRAINT (\S+) (PRIMARY KEY|UNIQUE)/i, (_m, table, name) =>
      `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}, ADD CONSTRAINT ${name}`,
    )
}

/**
 * Splits a generated migration into individual statements.
 *
 * Leading full-line comments are stripped from each segment so a commented
 * statement is still executed, and segments that contain only comments are
 * dropped. Only whole lines that start with `--` are removed, so a `--` inside
 * a string literal is never touched.
 */
function splitStatements(sqlText: string): string[] {
  return sqlText
    .split('--> statement-breakpoint')
    .map((segment) =>
      segment
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((segment) => segment.length > 0)
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(url)

  const journal = JSON.parse(
    readFileSync(resolve(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
  ) as { entries: { idx: number; tag: string; when: number }[] }

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  const applied = await sql.query(`select hash, created_at from drizzle.__drizzle_migrations`)

  let total = 0

  for (const file of files) {
    const text = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')
    const hash = createHash('sha256').update(text).digest('hex')
    // The journal key is the `when` timestamp, not the tag.
    const entry = journal.entries.find((e) => file.startsWith(String(e.idx).padStart(4, '0')))
    const folderMillis = entry?.when ?? 0

    if (applied.some((m) => m.hash === hash || Number(m.created_at) === folderMillis)) {
      console.warn(`${file}: already applied`)
      continue
    }

    const statements = splitStatements(text)
    let created = 0

    for (const [index, statement] of statements.entries()) {
      try {
        await sql.query(makeIdempotent(statement))
        created += 1
      } catch (err) {
        // A duplicate-object error means a previous run already did this one.
        const message = err instanceof Error ? err.message : String(err)
        if (/already exists|duplicate key value violates unique constraint "pg_/i.test(message)) {
          continue
        }
        console.error(
          `${file}: statement ${index + 1}/${statements.length} failed and is NOT ignorable:`,
        )
        console.error(`  ${statement.split('\n')[0]?.slice(0, 120)}`)
        console.error(`  ${message}`)
        process.exit(1)
      }
    }

    await sql.query(
      `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)
       on conflict do nothing`,
      [hash, folderMillis],
    )
    total += created
    console.warn(`${file}: applied ${created}/${statements.length} statements, recorded`)
  }

  console.warn(total === 0 ? 'Schema already up to date.' : `Applied ${total} statements.`)
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
