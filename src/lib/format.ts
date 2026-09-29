/** Date and number formatting shared across the UI. */
import { BOT_HANDLE, MAX_HANDLE_LENGTH, MIN_PASSWORD_LENGTH } from '@shared/constants'

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

/**
 * "3d", "2h", "just now". The result is always short enough to sit inline next
 * to a handle, and `<time>` carries the full date for hover and screen
 * readers.
 */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = then - now
  const magnitude = Math.abs(diff)

  if (magnitude < 45_000) return 'now'

  for (const [unit, ms] of UNITS) {
    if (magnitude >= ms) {
      return RELATIVE.format(Math.round(diff / ms), unit)
    }
  }
  return RELATIVE.format(Math.round(diff / 60_000), 'minute')
}

const FULL_DATE = new Intl.DateTimeFormat('en', {
  dateStyle: 'long',
  timeStyle: 'short',
})

export function fullDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : FULL_DATE.format(date)
}

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** 1.2K, 3.4M. Plain digits stay plain up to 999. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  if (value < 1000) return String(Math.trunc(value))
  return COMPACT.format(value)
}

/**
 * Up to two initials from a display name, falling back to the handle. Used by
 * the generated avatar.
 */
export function initialsFor(displayName: string, handle: string): string {
  const source = displayName.trim() || handle.trim()
  const words = source.split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/**
 * Validates a handle the way the server does, so the form can give immediate
 * feedback. The server is still the authority.
 */
export function handleError(handle: string): string | null {
  if (handle.length < 3) return 'Handles need at least 3 characters.'
  if (handle.length > MAX_HANDLE_LENGTH) {
    return `Handles can be at most ${MAX_HANDLE_LENGTH} characters.`
  }
  if (!/^[a-z0-9_]+$/.test(handle)) return 'Use only lowercase letters, numbers, and underscores.'
  if (handle === BOT_HANDLE) return 'That handle is reserved.'
  return null
}

/**
 * A deliberately modest strength check. A long passphrase scores better than a
 * short password with a symbol, so length is weighted most heavily.
 */
export function passwordStrength(password: string): {
  ok: boolean
  message: string | null
} {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }
  }
  if (password.length > 200) {
    return { ok: false, message: 'Passwords can be at most 200 characters.' }
  }
  return { ok: true, message: null }
}
