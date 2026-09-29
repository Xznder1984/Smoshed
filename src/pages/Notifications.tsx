import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { usePaginated } from '../hooks/usePaginated'
import { api } from '../lib/api'
import { relativeTime } from '../lib/format'
import type { NotificationItem } from '../lib/types'
import { Avatar } from '../components/Avatar'
import { PostBody } from '../components/PostBody'
import { RequireAuth } from '../components/RequireAuth'

/** Plain-language sentence for each notification type. */
function describe(item: NotificationItem): ReactNode {
  const who = <strong>{item.actor?.displayName ?? 'Someone'}</strong>
  switch (item.type) {
    case 'follow':
      return <>{who} followed you</>
    case 'like':
      return <>{who} liked your post</>
    case 'repost':
      return <>{who} reposted your post</>
    case 'reply':
      return <>{who} replied to you</>
    case 'mention':
      return <>{who} mentioned you</>
    case 'quote':
      return <>{who} quoted your post</>
    case 'bot_reply':
      return <>@smosh replied to you</>
    default:
      return <>Update from Smoshed</>
  }
}

export function NotificationsPage() {
  const feed = usePaginated<NotificationItem>('/api/notifications')
  const { user } = useAuth()
  const { items, patch } = feed
  // Marking read is a one-shot per visit, so a ref guard keeps the effect from
  // re-firing on every list change.
  const markedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!user || items.length === 0) return
    const unread = items.filter((item) => item.readAt === null)
    if (unread.length === 0) return
    // A new page of unread items means a new batch, so it is marked again.
    const batch = `${items[0].id}:${unread.length}`
    if (markedFor.current === batch) return
    markedFor.current = batch

    void api('/api/notifications/read', {
      method: 'POST',
      body: { ids: unread.map((item) => item.id) },
    })
      .then(() => {
        // Reflect the change locally so the highlight clears without a refetch.
        const readAt = new Date().toISOString()
        const ids = new Set(unread.map((item) => item.id))
        patch((current) => current.map((item) => (ids.has(item.id) ? { ...item, readAt } : item)))
      })
      .catch(() => {
        // If marking read fails, leave the state honest and let the next visit
        // try again.
        markedFor.current = null
      })
  }, [items, user, patch])

  return (
    <RequireAuth>
      <main className="content" id="main">
        <h1>Notifications</h1>

        {feed.loading && items.length === 0 ? (
          <div className="loading-row">
            <span className="spinner" aria-hidden />
            <span>Loading notifications</span>
          </div>
        ) : null}

        {feed.error ? (
          <div className="alert alert-error" role="alert">
            {feed.error}
          </div>
        ) : null}

        {!feed.loading && items.length === 0 && !feed.error ? (
          <div className="empty-state">
            <h2>Nothing new</h2>
            <p>Replies, likes, reposts, and new followers will show up here.</p>
          </div>
        ) : null}

        <div className="panel" style={{ padding: 0 }}>
          {items.map((item) => (
            <div key={item.id} className="notification">
              {item.actor ? (
                <Avatar
                  seed={item.actor.avatarSeed}
                  name={item.actor.displayName}
                  handle={item.actor.handle}
                  size="sm"
                />
              ) : null}
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="notification-text">
                  {describe(item)} <span className="muted">· {relativeTime(item.createdAt)}</span>
                </p>
                {item.post ? (
                  <Link to={`/post/${item.post.id}`} className="notification-post">
                    <PostBody body={item.post.body} />
                  </Link>
                ) : item.type !== 'follow' ? (
                  <p className="muted" style={{ fontSize: '0.875rem' }}>
                    This post is no longer available.
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {feed.nextCursor ? (
          <button
            type="button"
            className="btn btn-outline btn-block"
            onClick={feed.loadMore}
            disabled={feed.loadingMore}
          >
            {feed.loadingMore ? 'Loading' : 'Load more'}
          </button>
        ) : null}
      </main>
    </RequireAuth>
  )
}
