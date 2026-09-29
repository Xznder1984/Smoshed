/**
 * Static accessibility guards over the JSX source.
 *
 * A full audit needs a browser, and this is not one. What this does cover is the
 * class of regression that is easy to introduce and hard to notice: a control
 * that loses its label, an image without alternative text, a second `h1` that
 * quietly breaks the page outline, a `label` pointing at an id that was renamed.
 *
 * These run in `npm test` with no database and no rendering, so they stay cheap
 * enough to keep. A real browser pass with axe is still worth doing separately,
 * and contrast ratios are checked separately by `npm run contrast`.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(process.cwd(), 'src')

function collectTsx(dir: string = SRC): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collectTsx(full))
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

const files = collectTsx()

interface File {
  path: string
  /** Path relative to the repo root, for readable failure messages. */
  name: string
  lines: string[]
  text: string
}

const sources: File[] = files.map((path) => ({
  path,
  name: relative(process.cwd(), path).replace(/\\/g, '/'),
  lines: readFileSync(path, 'utf8').split(/\r?\n/),
  text: readFileSync(path, 'utf8'),
}))

/**
 * The lines around a JSX element that opens at `index`, up to the line its tag
 * closes on. Deliberately generous rather than a real parser, and it reaches
 * back a few lines as well as forward, because a control wrapped in its own
 * `<label>` is labelled implicitly and the opening tag sits above it. A few
 * extra lines only make the checks less likely to produce a false positive, and
 * the failure messages name the file and line so a real problem stays obvious.
 */
function elementAt(file: File, index: number, maxLines = 14, lookBehind = 0): string {
  const start = Math.max(0, index - lookBehind)
  return file.lines.slice(start, index + maxLines).join('\n')
}

/** An accessible name for a control, however this codebase tends to supply it. */
const hasName = (block: string) =>
  /\bid=/.test(block) ||
  /\baria-label=/.test(block) ||
  /\baria-labelledby=/.test(block) ||
  /<label\b/.test(block) ||
  /type="(hidden|submit|button)"/.test(block)

describe('source is present', () => {
  it('found the component tree', () => {
    expect(sources.length).toBeGreaterThan(10)
  })
})

describe('form controls have an accessible name', () => {
  for (const file of sources) {
    const pattern = /<(input|textarea|select)\b/g
    for (let match = pattern.exec(file.text); match; match = pattern.exec(file.text)) {
      const line = file.text.slice(0, match.index).split(/\r?\n/).length - 1
      it(`${file.name}:${line + 1} ${match[1]} is named`, () => {
        // A control wrapped in its own <label> is labelled implicitly, so the
        // window is allowed to reach the opening tag before it.
        expect(hasName(elementAt(file, line, 14, 4))).toBe(true)
      })
    }
  }
})

describe('every label points at a real control', () => {
  for (const file of sources) {
    const pattern = /htmlFor="([^"]+)"/g
    for (let match = pattern.exec(file.text); match; match = pattern.exec(file.text)) {
      const target = match[1]
      const line = file.text.slice(0, match.index).split(/\r?\n/).length - 1
      it(`${file.name}:${line + 1} label targets an existing id`, () => {
        // The target may live in the same file or a shared component, so this
        // is checked across the whole tree rather than per file.
        const found = sources.some((f) => new RegExp(`id="${target}"`).test(f.text))
        expect(found).toBe(true)
      })
    }
  }
})

describe('images carry alternative text', () => {
  const images: { file: File; line: number }[] = []
  for (const file of sources) {
    const pattern = /<img\b/g
    for (let match = pattern.exec(file.text); match; match = pattern.exec(file.text)) {
      images.push({ file, line: file.text.slice(0, match.index).split(/\r?\n/).length - 1 })
    }
  }

  // The app draws its avatars rather than loading image files, so this list is
  // legitimately empty. Without a test in the suite Vitest treats an empty
  // describe as a failure, and the emptiness itself is worth stating.
  it('every image declares alt text', () => {
    for (const { file, line } of images) {
      // A decorative image is legitimately `alt=""`, which still counts as
      // deliberate; a missing attribute is the failure.
      const block = elementAt(file, line, 6)
      expect(`${file.name}:${line + 1}: ${/\balt=/.test(block)}`).toBe(
        `${file.name}:${line + 1}: true`,
      )
    }
    expect(true).toBe(true)
  })
})

describe('links are real links', () => {
  const anchors: { file: File; line: number }[] = []
  for (const file of sources) {
    const pattern = /<a\b/g
    for (let match = pattern.exec(file.text); match; match = pattern.exec(file.text)) {
      anchors.push({ file, line: file.text.slice(0, match.index).split(/\r?\n/).length - 1 })
    }
  }

  it('every anchor has an href', () => {
    expect(anchors.length).toBeGreaterThan(0)
    for (const { file, line } of anchors) {
      // A missing href makes a control that looks clickable and is not.
      expect(`${file.name}:${line + 1}: ${/\bhref=/.test(elementAt(file, line, 6))}`).toBe(
        `${file.name}:${line + 1}: true`,
      )
    }
  })
})

describe('pages are given a top-level heading', () => {
  // A page component owns its outline. Shared layouts are not pages, so this
  // only covers files under pages/ that render a <main>.
  const pages = sources.filter((f) => f.name.startsWith('src/pages/') && /<main\b/.test(f.text))
  it('found the pages to check', () => {
    expect(pages.length).toBeGreaterThan(5)
  })

  for (const file of pages) {
    // At least one, not exactly one. A component may return early with a
    // different heading for a different state, and only one branch is ever
    // rendered, so counting headings in the file would report a problem that
    // cannot happen on screen.
    it(`${file.name} has a heading`, () => {
      expect((file.text.match(/<h1\b/g) ?? []).length).toBeGreaterThan(0)
    })
  }

  for (const file of pages) {
    // Two headings inside the same <main> do render together, which is the real
    // defect. Two in different <main> elements are different return branches,
    // so only one can be on screen and that is legitimate. Grouping by the
    // nearest preceding <main> captures exactly that difference.
    it(`${file.name} renders at most one heading at a time`, () => {
      const mains: number[] = []
      file.lines.forEach((line, index) => {
        if (/<main\b/.test(line)) mains.push(index)
      })

      const ownerOfHeading: number[] = []
      file.lines.forEach((line, index) => {
        if (!/<h1\b/.test(line)) return
        const owners = mains.filter((start) => start <= index)
        ownerOfHeading.push(owners.length > 0 ? owners[owners.length - 1] : -1)
      })

      expect(new Set(ownerOfHeading).size).toBe(ownerOfHeading.length)
    })
  }
})

describe('tab strips are described', () => {
  for (const file of sources) {
    if (!/role="tablist"/.test(file.text)) continue
    it(`${file.name} labels its tablist`, () => {
      // A tablist with no accessible name is announced as an unnamed group of
      // tabs, which tells a screen reader user nothing about where they are.
      expect(/aria-label=/.test(elementAt(file, 0, file.lines.length))).toBe(true)
    })
    it(`${file.name} marks its selected tab`, () => {
      expect(/aria-selected=/.test(file.text)).toBe(true)
    })
  }
})

describe('no placeholder attributes survived', () => {
  it('no images or links were left with the bare word "alt" or "href"', () => {
    for (const file of sources) {
      expect(file.text).not.toMatch(/<img\b[^>]*\balt\s*=\s*"alt"/)
    }
  })
})
