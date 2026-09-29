import { describe, expect, it } from 'vitest'
import {
  DUMMY_PASSWORD_HASH,
  hmac,
  keyedTokenHash,
  newId,
  randomToken,
  safeEqual,
  verifyPassword,
} from '../server/lib/crypto.js'

/**
 * These are the primitives the rest of the auth flow trusts. A regression in
 * token comparison or token hashing is a security bug rather than a bug, so
 * they are covered directly.
 */

describe('password verification', () => {
  // The real stored hash, from hashing a throwaway value in this same run below.
  let stored = ''

  it('accepts the correct password', async () => {
    const { hashPassword } = await import('../server/lib/crypto.js')
    stored = await hashPassword('correct horse battery staple')
    expect(stored.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true)
  })

  it('rejects a wrong password', async () => {
    expect(await verifyPassword(stored, 'Correct horse battery staple')).toBe(false)
  })

  it('returns false instead of throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false)
    expect(await verifyPassword('', 'anything')).toBe(false)
  })

  it('has a usable dummy hash so unknown logins still cost the same', async () => {
    expect(DUMMY_PASSWORD_HASH.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword(DUMMY_PASSWORD_HASH, 'anything')).toBe(false)
  })
})

describe('randomToken', () => {
  it('is url-safe and long enough to be unguessable', () => {
    const token = randomToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    // 32 bytes base64url is 43 characters.
    expect(token.length).toBe(43)
  })

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => randomToken()))
    expect(tokens.size).toBe(500)
  })
})

describe('newId', () => {
  it('is url-safe and unique', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('keyedTokenHash', () => {
  it('is stable for the same token and secret', () => {
    expect(keyedTokenHash('abc', 'secret')).toBe(keyedTokenHash('abc', 'secret'))
  })

  it('differs per token and per secret', () => {
    const base = keyedTokenHash('abc', 'secret')
    expect(keyedTokenHash('abd', 'secret')).not.toBe(base)
    expect(keyedTokenHash('abc', 'other')).not.toBe(base)
  })

  it('cannot be confused between a token and a same-named other purpose', () => {
    // The `token:` prefix keeps a reset token from colliding with a value that
    // is hashed for a different reason under the same secret.
    expect(keyedTokenHash('abc', 'secret')).not.toBe(hmac('abc', 'secret'))
  })
})

describe('safeEqual', () => {
  it('matches identical strings', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true)
  })

  it('rejects different strings of the same length', () => {
    expect(safeEqual('abc123', 'abc124')).toBe(false)
  })

  it('rejects different lengths without throwing', () => {
    // timingSafeEqual throws on a length mismatch, so this guard is the part
    // that keeps a wrong-length token from becoming a 500.
    expect(safeEqual('short', 'much longer value')).toBe(false)
    expect(safeEqual('', 'x')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })
})
