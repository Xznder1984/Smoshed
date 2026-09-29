import { defineConfig } from 'drizzle-kit'
import { loadLocalEnv } from './scripts/load-env.js'

loadLocalEnv()

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is required for drizzle-kit. Copy .env.example to .env.local first.')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
