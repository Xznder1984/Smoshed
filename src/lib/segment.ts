import { MAX_HANDLE_LENGTH } from '@shared/constants'

/**
 * Splits post text into plain text, mentions and links.
 *
 * This lives apart from `PostBody` because it is pure and worth testing on its
 * own, and because a module that exports a component and a helper cannot be
 * fast-refreshed. Nothing here produces markup: every part is a string that the
 * caller renders through React, which escapes it.
 */

/**
 * A mention is a `@` at the start of the text or after a character that cannot
 * be part of a handle or an email address, followed by a handle that is not
 * followed by another handle character.
 *
 * The leading `[^\w/@]` is what stops an email address from reading as a
 * mention, and the trailing `(?![\w])` stops a 40-character token from matching
 * its first 20 characters and linking to a different, shorter account.
 */
const MENTION_SOURCE = `(^|[^\\w/@])@([a-z0-9_]{1,${MAX_HANDLE_LENGTH}})(?![\\w])`

/** Stops before a closing paren or quote so surrounding punctuation is not swallowed. */
const URL_SOURCE = 'https?:\\/\\/[^\\s<>"\'\\)]+'

export type BodySegment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; value: string; handle: string }
  | { kind: 'link'; value: string }

type Match = { index: number; length: number; text: string; handle?: string }

/** Finds the first URL or mention, whichever comes first in the text. */
function findNext(text: string): Match | null {
  // Fresh regexes each call: a module-level /g regex would carry `lastIndex`
  // between calls and miss the first match on alternate calls.
  const url = new RegExp(URL_SOURCE, 'g').exec(text)
  const mention = new RegExp(MENTION_SOURCE, 'gi').exec(text)

  const urlAt = url ? url.index : Number.POSITIVE_INFINITY
  const mentionAt = mention ? mention.index : Number.POSITIVE_INFINITY

  if (urlAt === Number.POSITIVE_INFINITY && mentionAt === Number.POSITIVE_INFINITY) {
    return null
  }

  if (urlAt <= mentionAt && url) {
    return { index: url.index, length: url[0].length, text: url[0] }
  }

  const hit = mention as RegExpExecArray
  // The match includes the character before the @, which belongs to the
  // surrounding text rather than to the mention. Skipping past it here matters:
  // consuming the whole match would delete it and run the words together, so
  // "hey @alice" would render as "hey@alice".
  return {
    index: hit.index + hit[1].length,
    length: hit[0].length - hit[1].length,
    text: hit[0].slice(hit[1].length),
    handle: hit[2],
  }
}

export function segment(body: string): BodySegment[] {
  const segments: BodySegment[] = []
  let rest = body

  while (rest.length > 0) {
    const match = findNext(rest)
    if (!match) {
      segments.push({ kind: 'text', value: rest })
      break
    }

    if (match.index > 0) {
      segments.push({ kind: 'text', value: rest.slice(0, match.index) })
    }

    if (match.handle) {
      segments.push({ kind: 'mention', value: match.text, handle: match.handle })
    } else {
      segments.push({ kind: 'link', value: match.text })
    }

    rest = rest.slice(match.index + match.length)
  }

  return segments
}

/** Host shown next to a link, so a reader knows where it goes. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
