import { describe, expect, it } from 'vitest'
import { segment, type BodySegment } from '../src/lib/segment.js'

/**
 * Segmentation decides what a reader sees as a link. The rules that matter:
 * a mention is only a mention at the start of the text or after a character
 * that cannot be part of a handle or an email address, and nothing in a post
 * may ever become markup.
 */

const kinds = (parts: BodySegment[]) => parts.map((p) => p.kind)
const text = (parts: BodySegment[]) =>
  parts.map((p) => p.value).join('')

describe('segment', () => {
  it('returns nothing for an empty body', () => {
    expect(segment('')).toEqual([])
  })

  it('leaves plain text alone', () => {
    expect(segment('hello there')).toEqual([{ kind: 'text', value: 'hello there' }])
  })

  it('finds a mention at the start of a post', () => {
    expect(segment('@smosh hi')).toEqual([
      { kind: 'mention', value: '@smosh', handle: 'smosh' },
      { kind: 'text', value: ' hi' },
    ])
  })

  it('finds a mention after a space or punctuation', () => {
    const parts = segment('hey @alice, look')
    expect(parts[1]).toEqual({ kind: 'mention', value: '@alice', handle: 'alice' })
    // The character before the @ stays in the preceding text segment.
    expect(text(parts)).toBe('hey @alice, look')
  })

  it('does not treat an email address as a mention', () => {
    // `me@site` is an address, not a mention of `@site`. The @ is preceded by a
    // word character, which is the guard for this.
    const parts = segment('mail me@site about it')
    expect(kinds(parts)).toEqual(['text'])
  })

  it('does not treat a mid-handle @ as a mention', () => {
    expect(kinds(segment('foo/@bar'))).toEqual(['text'])
  })

  it('caps the handle length and ignores an over-long one', () => {
    // Handles cannot exceed MAX_HANDLE_LENGTH, so a longer token is not a
    // mention and must not be truncated into a link to a shorter account.
    const long = 'a'.repeat(40)
    const parts = segment(`@${long} x`)
    expect(kinds(parts)).toEqual(['text'])
    expect(text(parts)).toBe(`@${long} x`)
  })

  it('links a handle of exactly the maximum length', () => {
    const handle = 'b'.repeat(20)
    const parts = segment(`@${handle} hi`)
    expect(parts[0]).toEqual({ kind: 'mention', value: `@${handle}`, handle })
  })

  it('stops a handle at punctuation', () => {
    const parts = segment('@alice-bob')
    expect(parts[0]).toEqual({ kind: 'mention', value: '@alice', handle: 'alice' })
    expect(parts[1]).toEqual({ kind: 'text', value: '-bob' })
  })

  it('matches a mention case-insensitively but preserves the typed text', () => {
    const parts = segment('@Smosh')
    expect(parts[0]).toEqual({ kind: 'mention', value: '@Smosh', handle: 'Smosh' })
  })

  it('finds a link', () => {
    expect(segment('see https://example.com now')).toEqual([
      { kind: 'text', value: 'see ' },
      { kind: 'link', value: 'https://example.com' },
      { kind: 'text', value: ' now' },
    ])
  })

  it('stops a link before a closing paren so markdown-ish text is not swallowed', () => {
    const parts = segment('(https://example.com)')
    expect(parts[1]).toEqual({ kind: 'link', value: 'https://example.com' })
    expect(text(parts)).toBe('(https://example.com)')
  })

  it('finds several links and mentions in one post', () => {
    const parts = segment('@a https://x.test @b')
    expect(kinds(parts)).toEqual(['mention', 'text', 'link', 'text', 'mention'])
    expect(text(parts)).toBe('@a https://x.test @b')
  })

  it('is stable across repeated calls on the same input', () => {
    // A module-level /g regex would carry `lastIndex` between calls and skip the
    // first match on the second one. This is the regression test for that.
    const body = '@smosh and https://example.com and @other'
    const first = segment(body)
    expect(segment(body)).toEqual(first)
    expect(segment(body)).toEqual(first)
  })

  it('loses no characters for adversarial input', () => {
    // Nothing is ever interpreted, so round-tripping must be exact. The point is
    // that a post cannot smuggle markup: the caller renders with React, and the
    // segmenter never produces anything but text, mentions and links.
    const bodies = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '"><svg onload=alert(1)>',
      'javascript:alert(1)',
      '```\ncode\n```',
      '@a https://x.test <b>@c</b>',
      'unicode: éèê 😀 中文 @名',
    ]
    for (const body of bodies) {
      expect(text(segment(body))).toBe(body)
    }
  })
})
