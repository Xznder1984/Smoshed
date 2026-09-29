/**
 * Avatar rendering.
 *
 * There is no image upload, so an avatar is generated deterministically from
 * `avatarSeed`: a hue and a pair of initials. The same seed always produces the
 * same colours, so an account looks identical on every device and every reload
 * without storing or serving an image.
 *
 * The colour pairs are drawn from a fixed list and each foreground was chosen
 * to clear 4.5:1 against its own background.
 */
const PALETTE: { bg: string; fg: string }[] = [
  { bg: '#89dceb', fg: '#032f44' },
  { bg: '#a6e3a1', fg: '#1c3a1e' },
  { bg: '#fab387', fg: '#40230d' },
  { bg: '#cba6f7', fg: '#2e1c47' },
  { bg: '#f9e2af', fg: '#3a2f11' },
  { bg: '#b4befe', fg: '#1a2247' },
  { bg: '#94e2d5', fg: '#0d3330' },
  { bg: '#f38ba8', fg: '#431624' },
]

function hash(seed: string): number {
  let value = 0
  for (let i = 0; i < seed.length; i += 1) {
    value = (value * 31 + seed.charCodeAt(i)) >>> 0
  }
  return value
}

/** Up to two initials from a display name, falling back to the handle. */
import { initialsFor } from '../lib/format'

type AvatarProps = {
  seed: string
  name: string
  handle?: string
  size?: 'sm' | 'md' | 'lg'
  ring?: boolean
}

const SIZE_CLASS = { sm: 'avatar avatar-sm', md: 'avatar', lg: 'avatar avatar-lg' }

export function Avatar({ seed, name, handle, size = 'md', ring = false }: AvatarProps) {
  const color = PALETTE[hash(seed) % PALETTE.length]
  const initials = initialsFor(name, handle ?? name)

  return (
    <div
      className={`${SIZE_CLASS[size]}${ring ? ' avatar-ring' : ''}`}
      style={{ background: color.bg, color: color.fg }}
      // The name is already given as text next to the avatar in most layouts,
      // so the initials themselves stay decorative.
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}
