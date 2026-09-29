/**
 * Hand-drawn SVG icons.
 *
 * Each icon is a plain 24x24 stroke path with `aria-hidden` set, because the
 * surrounding button or link always carries its own accessible name. No icon
 * font and no third-party sprite.
 */
type IconProps = {
  size?: number
  className?: string
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  }
}

export function IconHome({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  )
}

export function IconSearch({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

export function IconBell({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
      <path d="M10.5 20a2 2 0 0 0 3 0" />
    </svg>
  )
}

export function IconBookmark({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1" />
    </svg>
  )
}

export function IconUser({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  )
}

export function IconSettings({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  )
}

export function IconHeart({ size = 20, className, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(size)} className={className} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9" />
    </svg>
  )
}

export function IconRepost({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M17 2.5 21 6l-4 3.5" />
      <path d="M21 6H7a4 4 0 0 0-4 4v1" />
      <path d="M7 21.5 3 18l4-3.5" />
      <path d="M3 18h14a4 4 0 0 0 4-4v-1" />
    </svg>
  )
}

export function IconReply({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M21 11.5a8 8 0 0 1-11.6 7.1L3 21l2.4-6.4A8 8 0 1 1 21 11.5" />
    </svg>
  )
}

export function IconQuote({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 5v14M20 5v14" />
      <path d="M4 12h6l4 4M20 12h-6l-4 4" />
    </svg>
  )
}

export function IconMore({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </svg>
  )
}

export function IconClose({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function IconFlag({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 21V4" />
      <path d="M5 4h11l-1.5 4L16 12H5" />
    </svg>
  )
}

export function IconTrash({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  )
}

export function IconBlock({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </svg>
  )
}

export function IconMute({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </svg>
  )
}

export function IconLogo({ size = 28, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path
        d="M10 20.5c1.6 1.2 3.4 1.8 5.4 1.8 3 0 5-1.3 5-3.4 0-1.8-1.2-2.8-4.2-3.6l-1.4-.4c-1.9-.5-2.7-.9-2.7-1.9 0-1.1 1.1-1.9 2.7-1.9 1.5 0 3 .5 4.2 1.4l1.6-2.3C19.1 9 17.3 8.4 15.3 8.4c-2.8 0-4.8 1.4-4.8 3.6 0 1.8 1.2 2.9 4 3.6l1.4.4c2 .5 2.8.9 2.8 1.9 0 1.2-1.1 2-2.9 2-1.6 0-3.2-.6-4.5-1.7z"
        fill="var(--on-accent)"
      />
    </svg>
  )
}
