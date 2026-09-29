import { useCallback, useState } from 'react'
import type { PostView } from '../lib/types'

/** The post a reply or quote points at, reduced to what the composer shows. */
type Context = { id: string; handle: string; body: string }

function toContext(post: PostView): Context {
  return { id: post.id, handle: post.author.handle, body: post.body }
}

/**
 * Holds which post the composer is replying to or quoting.
 *
 * Reply and quote share one slot on purpose: the composer is a single box, and
 * letting a reply and a quote be active at once would make the outgoing post
 * ambiguous about what it points at.
 */
export function useComposerContext() {
  const [replyTo, setReplyTo] = useState<PostView | null>(null)
  const [quoteOf, setQuoteOf] = useState<PostView | null>(null)

  const startReply = useCallback((post: PostView) => {
    setQuoteOf(null)
    setReplyTo(post)
  }, [])

  const startQuote = useCallback((post: PostView) => {
    setReplyTo(null)
    setQuoteOf(post)
  }, [])

  const clear = useCallback(() => {
    setReplyTo(null)
    setQuoteOf(null)
  }, [])

  return {
    /** Spread onto `Composer`. */
    composerProps: {
      inReplyTo: replyTo ? toContext(replyTo) : null,
      quoteOf: quoteOf ? toContext(quoteOf) : null,
      onCancelContext: clear,
    },
    /** Spread onto `PostCard`. */
    cardProps: {
      onReply: startReply,
      onQuote: startQuote,
    },
    /** True once the composer is targeting something, so pages can scroll to it. */
    active: replyTo !== null || quoteOf !== null,
  }
}
