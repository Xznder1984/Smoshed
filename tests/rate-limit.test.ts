/**
 * Rate limit and OAuth tests that need no database.
 *
 * The counter and lockout behaviour is covered by `tests/e2e/abuse-controls.test.ts`
 * against the real database. What is checked here is the configuration and the
 * pure helpers, so a bad default or a broken authorize URL is caught without
 * needing Neon.
 */

import { describe, expect, it } from 'vitest'
import { LIMITS } from '../server/lib/rate-limit.js'
import { isOAuthConfigured, authorizeUrl } from '../server/lib/oauth.js'

describe('rate limit defaults', () => {
  it('has a positive limit and window for every budget', () => {
    for (const [name, window] of Object.entries(LIMITS)) {
      expect(window.limit, name).toBeGreaterThan(0)
      expect(window.seconds, name).toBeGreaterThan(0)
    }
  })

  it('keeps signup tighter than posting', () => {
    expect(LIMITS.signup.limit).toBeLessThan(LIMITS.post.limit)
  })

  it('keeps login tighter than posting', () => {
    expect(LIMITS.login.limit).toBeLessThan(LIMITS.post.limit)
  })

  it('has a budget for magic links', () => {
    expect(LIMITS.magicLink.limit).toBeGreaterThan(0)
  })
})

describe('OAuth authorize URLs', () => {
  it('builds a Google authorize URL with the expected parameters', () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'x'
    const url = authorizeUrl('google', 'test-state')
    expect(url).toContain('accounts.google.com/o/oauth2/v2/auth')
    expect(url).toContain('client_id=test-client-id')
    expect(url).toContain('response_type=code')
    expect(url).toContain('scope=openid+email+profile')
    expect(url).toContain('state=test-state')
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
  })

  it('builds a Discord authorize URL with the expected parameters', () => {
    process.env.DISCORD_CLIENT_ID = 'test-discord-id'
    process.env.DISCORD_CLIENT_SECRET = 'x'
    const url = authorizeUrl('discord', 'test-state')
    expect(url).toContain('discord.com/oauth2/authorize')
    expect(url).toContain('client_id=test-discord-id')
    expect(url).toContain('response_type=code')
    expect(url).toContain('scope=identify+email')
    expect(url).toContain('state=test-state')
    delete process.env.DISCORD_CLIENT_ID
    delete process.env.DISCORD_CLIENT_SECRET
  })

  it('reports whether each provider is configured', () => {
    expect(isOAuthConfigured('google')).toBe(false)
    expect(isOAuthConfigured('discord')).toBe(false)

    process.env.GOOGLE_CLIENT_ID = 'test'
    process.env.GOOGLE_CLIENT_SECRET = 'x'
    expect(isOAuthConfigured('google')).toBe(true)
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET

    process.env.DISCORD_CLIENT_ID = 'test'
    process.env.DISCORD_CLIENT_SECRET = 'x'
    expect(isOAuthConfigured('discord')).toBe(true)
    delete process.env.DISCORD_CLIENT_ID
    delete process.env.DISCORD_CLIENT_SECRET
  })

  it('includes the redirect URI in the authorize URL', () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'x'
    process.env.APP_URL = 'https://example.com'
    const url = authorizeUrl('google', 'state')
    expect(url).toContain(encodeURIComponent('https://example.com/api/auth/google/callback'))
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.APP_URL
  })
})
