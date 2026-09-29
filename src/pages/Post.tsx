import { useCallback, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useFetch } from '../hooks/usePaginated'
import { useComposerContext } from '../hooks/useComposerContext'
import { relativeTime } from '../lib/format'
import type { PostView, ThreadResponse } from '../lib/types'
import { PostBody } from '../components/PostBody'
import { PostCard } from '../components/PostCard'
import { Composer } from '../components/Composer'

/**
 * Thread view.
 *
 * The whole conversation comes from one `/thread` request, so the ancestors,
 * the focused post and its replies arrive together and a reply always has its
 * context. The thread polls, which is the point of a thread when @smosh is
 * answering.
 */
export function PostPage() {
  const { id } = useParams<{ id: string }>()
  const thread = useFetch<ThreadResponse>(id ? `/api/posts/${id}/thread` : null)
  const { reload } = thread
  const refreshAll = useCallback(() => reload(), [reload])
  const composer = useComposerContext()

  // Replying to @smosh can take a moment, so the thread polls rather than
  // waiting for a manual refresh.
  useEffect(() => {
    const timer = setInterval(reload, 15_000)
    return () => clearInterval(timer)
  }, [reload])

  if (thread.error) {
    return (
      <main className="content" id="main">
        <div className="alert alert-error" role="alert">
          {thread.error}
        </div>
      </main>
    )
  }

  if (thread.loading && !thread.data) {
    return (
      <main className="content" id="main">
        <div className="loading-row">
          <span className="spinner" aria-hidden />
          <span>Loading thread</span>
        </div>
      </main>
    )
  }

  const data = thread.data
  if (!data) {
    return (
      <main className="content" id="main">
        <div className="empty-state">
          <h2>That post is gone</h2>
          <p>It may have been deleted by its author.</p>
        </div>
      </main>
    )
  }

  const { ancestors, root: post, replies } = data

  // The composer on a thread answers the focused post by default. Choosing to
  // reply to or quote something deeper overrides that, and cancelling returns
  // to the default rather than leaving an empty box.
  const chosen = composer.composerProps.inReplyTo ?? composer.composerProps.quoteOf
  const target = chosen ?? { id: post.id, handle: post.author.handle, body: post.body }

  return (
    <main className="content" id="main">
      <h1 className="sr-only">Post and replies</h1>

      {ancestors.length > 0 ? (
        <div className="thread-panel">
          {ancestors.map((ancestor: PostView, index) => (
            <div
              key={ancestor.id}
              style={index < ancestors.length - 1 ? { marginBottom: 'var(--space-2)' } : undefined}
            >
              <Link to={`/post/${ancestor.id}`} className="muted" style={{ fontSize: '0.875rem' }}>
                In reply to @{ancestor.author.handle} · {relativeTime(ancestor.createdAt)}
              </Link>
              <p style={{ marginTop: 'var(--space-1)' }}>
                <PostBody body={ancestor.body} />
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <PostCard post={post} variant="detail" onChanged={refreshAll} {...composer.cardProps} />

      <Composer
        placeholder={`Reply to @${target.handle}`}
        inReplyTo={composer.composerProps.inReplyTo ?? target}
        quoteOf={composer.composerProps.quoteOf}
        onCancelContext={chosen ? composer.composerProps.onCancelContext : undefined}
        onPosted={refreshAll}
      />

      <h2 style={{ margin: 'var(--space-5) 0 var(--space-3)' }}>
        {replies.length === 0 ? 'No replies yet' : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
      </h2>

      {replies.length === 0 ? (
        <div className="empty-state">
          <p>Be the first to reply.</p>
        </div>
      ) : (
        <div className="thread">
          {replies.map((reply: PostView) => (
            <PostCard key={reply.id} post={reply} variant="thread" onChanged={refreshAll} />
          ))}
        </div>
      )}
    </main>
  )
}
