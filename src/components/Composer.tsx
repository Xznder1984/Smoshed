import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/useAuth'
import { api, ApiError } from '../lib/api'
import { Avatar } from './Avatar'
import { PostBody } from './PostBody'
import { MAX_POST_LENGTH } from '@shared/constants'

/** The post a reply or quote points at. */
type Context = { id: string; handle: string; body: string }

type ComposerProps = {
  /** Set when composing a reply. */
  inReplyTo?: Context | null
  /** Set when quoting a post. The server stores the link and the quoted copy. */
  quoteOf?: Context | null
  onCancelContext?: () => void
  onPosted?: () => void
  placeholder?: string
}

/**
 * Post composer.
 *
 * The 280-character limit is enforced in the browser for immediate feedback
 * and again on the server, which is the only authority that counts. The
 * remaining count is announced politely so a screen reader user hears the
 * limit approaching rather than only seeing a colour change.
 *
 * A reply and a quote are mutually exclusive: a post that answers someone and
 * a post that comments on someone are different intents, and the server models
 * them as separate links.
 */
export function Composer({
  inReplyTo,
  quoteOf,
  onCancelContext,
  onPosted,
  placeholder,
}: ComposerProps) {
  const { user } = useAuth()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCounter, setShowCounter] = useState(false)

  const remaining = MAX_POST_LENGTH - body.length
  const overLimit = remaining < 0
  const nearLimit = remaining <= 40

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || overLimit) return

    setBusy(true)
    setError(null)
    try {
      await api('/api/posts', {
        method: 'POST',
        body: {
          body,
          ...(inReplyTo ? { replyToId: inReplyTo.id } : {}),
          ...(quoteOf ? { quoteOfId: quoteOf.id } : {}),
        },
      })
      setBody('')
      setShowCounter(false)
      onPosted?.()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <div className="panel">
        <p className="muted">Sign in to post.</p>
      </div>
    )
  }

  const context = inReplyTo ?? quoteOf ?? null

  return (
    <form className="panel stack" onSubmit={submit}>
      {context ? (
        <div className="alert">
          {inReplyTo ? 'Replying to ' : 'Quoting '}
          <strong>@{context.handle}</strong>
          {onCancelContext ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 'auto' }}
              onClick={onCancelContext}
            >
              Cancel
            </button>
          ) : null}
          {quoteOf ? (
            <div className="quote-preview">
              <PostBody body={quoteOf.body} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Avatar seed={user.avatarSeed} name={user.displayName} handle={user.handle} />
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="composer-body" className="sr-only">
            What is happening?
          </label>
          <textarea
            id="composer-body"
            className="textarea"
            value={body}
            onChange={(event) => {
              setBody(event.target.value)
              if (event.target.value.length > MAX_POST_LENGTH - 60) setShowCounter(true)
            }}
            onBlur={() => setShowCounter(true)}
            placeholder={placeholder ?? "What's happening?"}
            rows={3}
            aria-invalid={overLimit}
            aria-describedby="composer-count composer-error"
            maxLength={MAX_POST_LENGTH * 2}
          />
          <div className="row-between">
            <span id="composer-error" className="field-error" role={error ? 'alert' : undefined}>
              {error}
            </span>
            <span
              id="composer-count"
              className="char-count"
              data-near-limit={showCounter && nearLimit && !overLimit}
              data-over-limit={overLimit}
              aria-live="polite"
            >
              {showCounter ? remaining : 0}
            </span>
          </div>
        </div>
      </div>

      <div className="row-between">
        <span className="field-hint">
          Mention <strong>@smosh</strong> to get a reply.
        </span>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || overLimit || body.trim().length === 0}
        >
          {busy ? <span className="spinner" aria-hidden /> : null}
          {busy ? 'Posting' : 'Post'}
        </button>
      </div>
    </form>
  )
}
