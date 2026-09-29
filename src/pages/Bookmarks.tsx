import { usePaginated } from '../hooks/usePaginated'
import type { PostView } from '../lib/types'
import { PostCard } from '../components/PostCard'
import { RequireAuth } from '../components/RequireAuth'

export function BookmarksPage() {
  const feed = usePaginated<PostView>('/api/posts/saved/list')

  return (
    <RequireAuth>
      <main className="content" id="main">
        <h1>Bookmarks</h1>
        <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
          Only you can see what you have bookmarked.
        </p>

        {feed.loading && feed.items.length === 0 ? (
          <div className="loading-row">
            <span className="spinner" aria-hidden />
            <span>Loading bookmarks</span>
          </div>
        ) : null}

        {feed.error ? (
          <div className="alert alert-error" role="alert">
            {feed.error}
          </div>
        ) : null}

        {!feed.loading && feed.items.length === 0 && !feed.error ? (
          <div className="empty-state">
            <h2>No bookmarks yet</h2>
            <p>Bookmark a post with the flag icon to keep it here.</p>
          </div>
        ) : null}

        {feed.items.map((post) => (
          <PostCard key={post.id} post={post} onChanged={feed.reload} />
        ))}

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
