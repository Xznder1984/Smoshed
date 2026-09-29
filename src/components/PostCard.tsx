import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { api, ApiError } from '../lib/api'
import { compactNumber, fullDate, relativeTime } from '../lib/format'
import type { PostView } from '../lib/types'
import { Avatar } from './Avatar'
import { PostBody } from './PostBody'
import {
  IconBookmark,
  IconHeart,
  IconMore,
  IconQuote,
  IconReply,
  IconRepost,
  IconTrash,
} from './icons'

type PostCardProps = {
  post: PostView
  onReply?: (post: PostView) => void
  onQuote?: (post: PostView) => void
  onDelete?: () => void
  /** Threads render a connector line and omit the timestamp link. */
  variant?: 'timeline' | 'thread' | 'detail'
  onChanged?: () => void
}

type Action = 'like' | 'repost' | 'bookmark'

export function PostCard({
  post,
  onReply,
  onQuote,
  onDelete,
  variant = 'timeline',
  onChanged,
}: PostCardProps) {
  const { user } = useAuth()
  const [busy, setBusy] = useState<Action | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOwn = user?.id === post.author.id
  // The server only lets the author delete, so offering it to an admin would be
  // a button that always fails.
  const canDelete = isOwn

  async function toggle(action: Action) {
    if (!user || busy) return
    setBusy(action)
    setError(null)
    try {
      await api(`/api/posts/${post.id}/${action}`, { method: 'POST' })
      // Counters come back from the server, so a refetch keeps this card and
      // any other view of the same post consistent.
      onChanged?.()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!canDelete || busy) return
    if (!confirm('Delete this post? Replies to it are kept but shown as deleted.')) return
    setBusy('like')
    setError(null)
    try {
      await api(`/api/posts/${post.id}`, { method: 'DELETE' })
      onDelete?.()
      onChanged?.()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that post.')
    } finally {
      setBusy(null)
    }
  }

  const timestamp = (
    <time dateTime={post.createdAt} title={fullDate(post.createdAt)}>
      {relativeTime(post.createdAt)}
    </time>
  )

  return (
    <article className="panel" aria-label={`Post by ${post.author.displayName}`}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Link to={`/${post.author.handle}`} tabIndex={-1} aria-hidden="true">
          <Avatar seed={post.author.avatarSeed} name={post.author.displayName} handle={post.author.handle} />
        </Link>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row-between">
            <div className="row" style={{ minWidth: 0 }}>
              <Link to={`/${post.author.handle}`} style={{ fontWeight: 700, color: 'inherit' }}>
                {post.author.displayName}
              </Link>
              <span className="muted">@{post.author.handle}</span>
              {post.author.isBot ? (
                <span className="tag tag-bot" title="Automated account">
                  bot
                </span>
              ) : null}
              <span className="muted" aria-hidden>
                &middot;
              </span>
              <span className="muted">{timestamp}</span>
            </div>

            {canDelete ? (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm icon-btn"
                  aria-label="Post options"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <IconMore />
                </button>
                {menuOpen ? (
                  <div className="menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => {
                        setMenuOpen(false)
                        void remove()
                      }}
                    >
                      <IconTrash size={16} />
                      Delete post
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div style={{ marginTop: 'var(--space-2)' }}>
            <PostBody body={post.body} />
          </div>

          {post.quoteOf ? (
            <Link to={`/post/${post.quoteOf.id}`} className="quoted">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <Avatar
                  seed={post.quoteOf.author.avatarSeed}
                  name={post.quoteOf.author.displayName}
                  handle={post.quoteOf.author.handle}
                  size="sm"
                />
                <div style={{ minWidth: 0 }}>
                  <strong>{post.quoteOf.author.displayName}</strong>{' '}
                  <span className="muted">@{post.quoteOf.author.handle}</span>
                  <p className="muted clamp-2">{post.quoteOf.body}</p>
                </div>
              </div>
            </Link>
          ) : null}

          {variant !== 'thread' ? (
            <div className="actions">
              <button
                type="button"
                className="action"
                onClick={() => onReply?.(post)}
                disabled={!user}
                aria-label={`Reply to ${post.author.displayName}`}
              >
                <IconReply />
                <span>{compactNumber(post.counts.replies)}</span>
              </button>

              <button
                type="button"
                className="action"
                onClick={() => onQuote?.(post)}
                disabled={!user}
                aria-label={`Quote ${post.author.displayName}`}
              >
                <IconQuote />
                <span>{compactNumber(post.counts.quotes)}</span>
              </button>

              <button
                type="button"
                className="action"
                onClick={() => void toggle('repost')}
                disabled={!user || busy !== null}
                aria-pressed={post.viewer.reposted}
                aria-label={`${post.viewer.reposted ? 'Undo repost of' : 'Repost'} ${post.author.displayName}'s post`}
              >
                <IconRepost />
                <span>{compactNumber(post.counts.reposts)}</span>
              </button>

              <button
                type="button"
                className="action"
                onClick={() => void toggle('like')}
                disabled={!user || busy !== null}
                aria-pressed={post.viewer.liked}
                aria-label={`${post.viewer.liked ? 'Unlike' : 'Like'} ${post.author.displayName}'s post`}
              >
                <IconHeart filled={post.viewer.liked} />
                <span>{compactNumber(post.counts.likes)}</span>
              </button>

              <button
                type="button"
                className="action"
                onClick={() => void toggle('bookmark')}
                disabled={!user || busy !== null}
                aria-pressed={post.viewer.bookmarked}
                aria-label={`${post.viewer.bookmarked ? 'Remove bookmark from' : 'Bookmark'} ${post.author.displayName}'s post`}
              >
                <IconBookmark />
              </button>
            </div>
          ) : null}

          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}

          {variant === 'timeline' ? (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <Link to={`/post/${post.id}`} className="muted" style={{ fontSize: '0.875rem' }}>
                Open thread
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}
