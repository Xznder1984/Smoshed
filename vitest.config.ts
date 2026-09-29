import { defineConfig, configDefaults } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The end-to-end suite needs a real database and writes rows, so it only
    // runs when asked for explicitly with `npm run test:e2e`.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    globals: false,
  },
})
