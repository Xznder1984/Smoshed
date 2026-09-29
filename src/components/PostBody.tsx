import { hostOf, segment } from '../lib/segment'

/** Renders post text as plain text, with @mentions and links made clickable. */
export function PostBody({ body, linkify = true }: { body: string; linkify?: boolean }) {
  if (!linkify) {
    return <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{body}</p>
  }

  return (
    <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {segment(body).map((part, index) => {
        if (part.kind === 'mention') {
          return (
            // Handles are matched case-insensitively on the server, so the href
            // is lowercased to keep every link to one account canonical.
            <a key={index} href={`/${part.handle.toLowerCase()}`}>
              {part.value}
            </a>
          )
        }
        if (part.kind === 'link') {
          const host = hostOf(part.value)
          return (
            <a
              key={index}
              href={part.value}
              target="_blank"
              // noopener and noreferrer so a linked page cannot reach back
              // into this window.
              rel="noopener noreferrer nofollow"
            >
              {part.value}
              <span className="sr-only"> (opens in a new tab, {host})</span>
            </a>
          )
        }
        return <span key={index}>{part.value}</span>
      })}
    </p>
  )
}
