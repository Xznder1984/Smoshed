import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * End-to-end suite configuration.
 *
 * Separate from the unit configuration because these tests talk to the real
 * Neon database and create an account, so they must never run as part of the
 * default `npm test`. Run them with `npm run test:e2e`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    globals: false,
    // The account is created once and the suite drives a single cookie jar, so
    // running files in parallel would only add confusion here.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 60_000,
  },
})
