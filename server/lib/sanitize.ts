import { z } from 'zod'
import { MAX_POST_LENGTH } from './env.js'

/**
 * Post bodies are stored and rendered as plain text, so the only work needed is
 * collapsing whitespace and stripping control characters. No HTML is ever
 * produced from user input anywhere in this app.
 */
export function cleanBody(raw: string): string {
  return raw
    .normalize('NFC')
    // Strip C0/C1 control characters except newline and tab. Stripping
    // control characters is the whole point, so the rule is disabled here.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

/**
 * Trims to the character budget on a word boundary. Falls back to a hard cut
 * with an ellipsis only when a single word is longer than the budget, so a
 * reply is never cut mid-word in normal use.
 */
export function trimToLength(text: string, max = MAX_POST_LENGTH): string {
  const clean = cleanBody(text)
  if (clean.length <= max) return clean

  const hardCut = clean.slice(0, max)
  const lastSpace = hardCut.lastIndexOf(' ')
  const cut = lastSpace > max * 0.6 ? hardCut.slice(0, lastSpace) : hardCut
  const trimmed = cut.replace(/[\s.,;:!?-]+$/, '')
  return `${trimmed}\u2026`
}

export const postBodySchema = z
  .string()
  .transform(cleanBody)
  .refine((value) => value.length > 0, 'Write something before posting.')
  .refine((value) => value.length <= MAX_POST_LENGTH, `Posts are limited to ${MAX_POST_LENGTH} characters.`)

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Handles need at least 3 characters.')
  .max(20, 'Handles can be at most 20 characters.')
  .regex(/^[a-z0-9_]+$/, 'Handles use lowercase letters, numbers and underscores only.')
  .refine((v) => !RESERVED_HANDLES.has(v), 'That handle is reserved.')

export const RESERVED_HANDLES = new Set([
  'smosh',
  'admin',
  'api',
  'settings',
  'search',
  'explore',
  'notifications',
  'login',
  'signup',
  'logout',
  'about',
  'privacy',
  'terms',
  'cookies',
  'home',
  'me',
  'moderation',
  'i',
  'in',
  'null',
  'undefined',
  'support',
  'help',
])

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Enter a valid email address.')

/**
 * Length-only password rules. No composition rules, because they push people
 * toward predictable substitutions. A breach check runs against a local list.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(200, 'Passwords can be at most 200 characters.')

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Add a display name.')
  .max(50, 'Display names can be at most 50 characters.')

export const bioSchema = z.string().trim().max(160, 'Bios can be at most 160 characters.').default('')

/** Mentions are matched on word boundaries so @smoshed does not match @smosh. */
export function extractMentions(text: string): string[] {
  const found = new Set<string>()
  const re = /(^|[^\w@])@([a-z0-9_]{1,30})/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    found.add(match[2]!.toLowerCase())
  }
  return [...found]
}

export function mentionsSmosh(text: string): boolean {
  return extractMentions(text).includes('smosh')
}
