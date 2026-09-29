/**
 * Contrast audit for the colour tokens.
 *
 * The pairs are read out of `src/styles/tokens.css` rather than hardcoded here,
 * so the check follows the palette instead of drifting away from it. Thresholds
 * are the WCAG 2.2 success criteria: 4.5:1 for body text, 3:1 for large text
 * (18.66px bold or 24px regular) and for the boundaries of user-interface
 * components such as input borders and focus rings.
 *
 * Run with `npm run contrast`. Exits non-zero when a pair fails, so it can sit
 * in a check chain.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const tokensPath = resolve(process.cwd(), 'src/styles/tokens.css')
const css = readFileSync(tokensPath, 'utf8')

const tokens = new Map<string, string>()
for (const line of css.split(/\r?\n/)) {
  const match = /^\s*(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(line)
  if (match) tokens.set(match[1]!, match[2]!)
}

type Channel = number

/** Expands #abc and #aabbcc to a full 24-bit triple. */
function parse(hex: string): [Channel, Channel, Channel] {
  let value = hex.slice(1)
  if (value.length === 3) value = [...value].map((c) => c + c).join('')
  const int = Number.parseInt(value, 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

/**
 * Relative luminance per WCAG 2.2. The sRGB channel is linearised first, which
 * is what makes the weights correct; skipping this step makes mid-tones look far
 * better than they are and hides real failures.
 */
function luminance(hex: string): number {
  const [r, g, b] = parse(hex).map((channel) => {
    const srgb = channel / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }) as [Channel, Channel, Channel]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

type Pair = { foreground: string; background: string; use: string; minimum: number }

const pairs: Pair[] = [
  { foreground: '--text', background: '--base', use: 'body text on the page', minimum: 4.5 },
  { foreground: '--text', background: '--crust', use: 'text on the deepest panel', minimum: 4.5 },
  { foreground: '--text', background: '--mantle', use: 'text on a recessed panel', minimum: 4.5 },
  { foreground: '--text', background: '--surface', use: 'text on a panel', minimum: 4.5 },
  { foreground: '--muted', background: '--base', use: 'secondary text', minimum: 4.5 },
  { foreground: '--muted', background: '--mantle', use: 'secondary text on a panel', minimum: 4.5 },
  { foreground: '--muted', background: '--surface', use: 'secondary text on a panel', minimum: 4.5 },
  { foreground: '--subtle', background: '--base', use: 'timestamps and hints', minimum: 4.5 },
  { foreground: '--subtle', background: '--surface', use: 'timestamps on a panel', minimum: 4.5 },
  { foreground: '--accent', background: '--base', use: 'links', minimum: 4.5 },
  { foreground: '--accent', background: '--surface', use: 'links on a panel', minimum: 4.5 },
  { foreground: '--on-accent', background: '--accent', use: 'text on a filled accent button', minimum: 4.5 },
  { foreground: '--green', background: '--base', use: 'success text', minimum: 4.5 },
  { foreground: '--red', background: '--base', use: 'error text', minimum: 4.5 },
  { foreground: '--red', background: '--surface', use: 'error text on a panel', minimum: 4.5 },
  { foreground: '--yellow', background: '--base', use: 'warning text', minimum: 4.5 },
  { foreground: '--peach', background: '--base', use: 'destructive button text', minimum: 4.5 },
  { foreground: '--lavender', background: '--base', use: 'handle text', minimum: 4.5 },
  { foreground: '--mauve', background: '--base', use: 'accent decoration text', minimum: 4.5 },
  // Non-text contrast, WCAG 1.4.11. Only boundaries that identify a control are
  // held to 3:1; a decorative divider is exempt, so it is not listed.
  { foreground: '--border-control', background: '--mantle', use: 'input border, on its own background', minimum: 3 },
  { foreground: '--border-control', background: '--base', use: 'input border, against the page', minimum: 3 },
  { foreground: '--border-strong', background: '--base', use: 'outline button and hovered input', minimum: 3 },
  { foreground: '--focus', background: '--base', use: 'focus ring', minimum: 3 },
  { foreground: '--focus', background: '--surface', use: 'focus ring on a panel', minimum: 3 },
]

let failures = 0
const width = 60

console.warn(`\nContrast ratios from ${tokensPath}\n`)
for (const pair of pairs) {
  const fg = tokens.get(pair.foreground)
  const bg = tokens.get(pair.background)
  if (!fg || !bg) {
    console.warn(`  SKIP  ${pair.use}: ${!fg ? pair.foreground : pair.background} is not defined`)
    failures++
    continue
  }
  const ratio = contrast(fg, bg)
  const pass = ratio >= pair.minimum
  if (!pass) failures++
  const label = `${pair.foreground} on ${pair.background}`.padEnd(width - 12)
  const mark = pass ? 'PASS' : 'FAIL'
  const detail = `needs ${pair.minimum}:1`
  console.warn(
    `  ${mark}  ${label} ${ratio.toFixed(2)}:1  (${detail})  ${pair.use}`,
  )
}

console.warn('')
if (failures > 0) {
  console.warn(`${failures} pair(s) did not meet their threshold.`)
} else {
  console.warn(`All ${pairs.length} pairs met their threshold.`)
}

process.exit(failures > 0 ? 1 : 0)
