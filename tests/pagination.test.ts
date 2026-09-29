import { describe, expect, it } from 'vitest'
import { decodeCursorForTest, encodeCursor, pageParams, toPage } from '../server/lib/pagination.js'

/**
 * The cursor is the one piece of client-visible state that decides whether a
 * feed repeats or drops a post, so it is tested directly rather than through the
 * database. `decodeCursorForTest` exposes the private decoder.
 */

const at = (iso: string) => new Date(iso)

describe('pageParams', () => {
  it('defaults to a first page when nothing is supplied', () => {
    expect(pageParams({})).toEqual({ limit: 20, cursor: null })
  })

  it('honours a requested limit', () => {
    expect(pageParams({ limit: '5' }).limit).toBe(5)
  })

  it('clamps the limit so one request cannot ask for the whole table', () => {
    expect(pageParams({ limit: '10000' }).limit).toBe(50)
    expect(pageParams({ limit: '0' }).limit).toBe(1)
    expect(pageParams({ limit: '-3' }).limit).toBe(1)
  })

  it('falls back to the default for a limit that is not a number', () => {
    for (const bad of ['abc', '', 'NaN', '1e999']) {
      expect(pageParams({ limit: bad }).limit).toBe(20)
    }
  })

  it('round-trips a cursor', () => {
    const row = { createdAt: at('2026-01-02T03:04:05.678Z'), id: 'abc123' }
    const { cursor } = pageParams({ cursor: encodeCursor(row) })
    expect(cursor).toEqual(row)
  })
})

describe('decodeCursorForTest', () => {
  const bad = (value: string) => {
    // A tampered cursor must degrade to the first page, never throw.
    expect(decodeCursorForTest(value)).toBeNull()
  }

  it('rejects values that are not cursors', () => {
    bad('')
    bad('not-base64url-!!!')
    bad(Buffer.from('not json', 'utf8').toString('base64url'))
    bad(Buffer.from('null', 'utf8').toString('base64url'))
    bad(Buffer.from('42', 'utf8').toString('base64url'))
    bad(Buffer.from('"a string"', 'utf8').toString('base64url'))
  })

  it('rejects a cursor with the wrong field types', () => {
    bad(Buffer.from(JSON.stringify({ t: 1, i: 'x' }), 'utf8').toString('base64url'))
    bad(Buffer.from(JSON.stringify({ t: '2026-01-01T00:00:00Z' }), 'utf8').toString('base64url'))
    bad(Buffer.from(JSON.stringify({ t: 'x', i: 'y' }), 'utf8').toString('base64url'))
  })

  it('rejects a cursor whose timestamp is not a real date', () => {
    bad(Buffer.from(JSON.stringify({ t: 'not-a-date', i: 'x' }), 'utf8').toString('base64url'))
  })
})

describe('toPage', () => {
  const row = (n: number) => ({
    id: `id${n}`,
    createdAt: at(`2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`),
  })
  const rows = [row(3), row(2), row(1)]

  it('returns no cursor on a short page', () => {
    const page = toPage(rows.slice(0, 2), 20, (r) => r.id)
    expect(page.items).toEqual(['id3', 'id2'])
    expect(page.nextCursor).toBeNull()
  })

  it('trims the over-fetched row and hands back its cursor', () => {
    const page = toPage(rows, 2, (r) => r.id)
    expect(page.items).toEqual(['id3', 'id2'])
    // The cursor points at the last item shown, not the extra row.
    expect(decodeCursorForTest(page.nextCursor)).toEqual(rows[1])
  })

  it('returns an empty page for no rows', () => {
    const empty: { id: string; createdAt: Date }[] = []
    expect(toPage(empty, 20, (r) => r.id)).toEqual({ items: [], nextCursor: null })
  })
})
