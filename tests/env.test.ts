import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `env` reads `process.env` through getters rather than at module load, so each
 * test can set the environment and read the result back. The properties that
 * matter for security are the cookie `Secure` flag and the CORS allowlist: a
 * wrong value either weakens cookies or breaks every API call in the browser.
 */

const ORIGINAL = { ...process.env }

async function loadEnv() {
  // `vi.resetModules()` gives a fresh module instance, so the getters see the
  // environment as it is now rather than as it was at import time.
  vi.resetModules()
  const mod = await import('../server/lib/env.js')
  return mod.env
}

beforeEach(() => {
  for (const key of ['APP_URL', 'VERCEL', 'NODE_ENV']) delete process.env[key]
})

afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe('appUrls', () => {
  it('defaults to the local dev server', async () => {
    const env = await loadEnv()
    expect(env.appUrls).toEqual(['http://localhost:5173'])
    expect(env.appUrl).toBe('http://localhost:5173')
  })

  it('strips a trailing slash', async () => {
    process.env.APP_URL = 'https://smoshed.example/'
    const env = await loadEnv()
    expect(env.appUrl).toBe('https://smoshed.example')
  })

  it('accepts several addresses, taking the first as canonical', async () => {
    process.env.APP_URL = 'https://smoshed.example, https://smoshed-git-main.vercel.app'
    const env = await loadEnv()
    expect(env.appUrl).toBe('https://smoshed.example')
    expect(env.appUrls).toHaveLength(2)
  })

  it('ignores empty entries from a trailing comma', async () => {
    process.env.APP_URL = 'https://a.example,'
    const env = await loadEnv()
    expect(env.appUrls).toEqual(['https://a.example'])
  })
})

describe('useSecureCookies', () => {
  it('is on for an https address', async () => {
    process.env.APP_URL = 'https://smoshed.example'
    expect((await loadEnv()).useSecureCookies).toBe(true)
  })

  it('is on for a Vercel deployment even if APP_URL is unset or stale', async () => {
    // A preview URL is not known until the build runs, so a deployment with no
    // APP_URL must not silently drop the Secure flag on session cookies.
    process.env.VERCEL = '1'
    expect((await loadEnv()).useSecureCookies).toBe(true)

    process.env.VERCEL = '1'
    process.env.APP_URL = 'http://localhost:5173'
    expect((await loadEnv()).useSecureCookies).toBe(true)
  })

  it('is on in production', async () => {
    process.env.NODE_ENV = 'production'
    expect((await loadEnv()).useSecureCookies).toBe(true)
  })

  it('is off only for plain local development', async () => {
    expect((await loadEnv()).useSecureCookies).toBe(false)
  })

  it('is on when https is among several addresses', async () => {
    process.env.APP_URL = 'http://localhost:5173,https://smoshed.example'
    expect((await loadEnv()).useSecureCookies).toBe(true)
  })
})

describe('allowedOrigins', () => {
  it('always includes the local dev origins', async () => {
    const env = await loadEnv()
    expect(env.allowedOrigins).toContain('http://localhost:5173')
    expect(env.allowedOrigins).toContain('http://127.0.0.1:5173')
  })

  it('lists a configured origin and does not duplicate it', async () => {
    process.env.APP_URL = 'https://smoshed.example'
    const env = await loadEnv()
    expect(env.allowedOrigins.filter((o) => o === 'https://smoshed.example')).toHaveLength(1)
  })

  it('never contains a wildcard, because credentials are allowed', async () => {
    process.env.APP_URL = 'https://smoshed.example'
    const env = await loadEnv()
    expect(env.allowedOrigins).not.toContain('*')
  })
})
