import { hash, verify } from '@node-rs/argon2'
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto'

/**
 * Argon2id parameters. 19 MiB / 2 passes / 1 lane is the OWASP-recommended
 * baseline (m=19456, t=2, p=1) and stays comfortably inside a serverless
 * memory limit.
 */
const ARGON2_OPTS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTS)
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, ARGON2_OPTS)
  } catch {
    return false
  }
}

/** URL-safe random token: session ids, CSRF tokens, reset tokens, row ids. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function newId(): string {
  return randomBytes(16).toString('base64url')
}

/**
 * Deterministic keyed hash for high-entropy lookup tokens.
 *
 * Reset tokens carry 256 bits of entropy, so a keyed hash is the right tool: it
 * is queryable by value, which lets the reset flow look a token up with a
 * single indexed query instead of scanning rows. Passwords use Argon2id above
 * because they are low-entropy and must be slow to attack.
 */
export function keyedTokenHash(token: string, secret: string): string {
  return createHmac('sha256', secret).update(`token:${token}`).digest('base64url')
}

export function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Argon2id hash of a value nobody knows, so a sign-in attempt for an unknown
 * email still pays the full hashing cost and cannot be timed apart.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$9NVrSFvmvBKv/7jDmO9Uyg$AAYJk5D8MCRO+Gwb9rFlMMnYJ6ojBuJIQ1WD6VBkb/k'
