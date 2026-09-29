import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { query } from '../lib/api'
import { useFetch, usePaginated } from '../hooks/usePaginated'
import { useComposerContext } from '../hooks/useComposerContext'
import { Composer } from '../components/Composer'
import { PostCard } from '../components/PostCard'
import { Avatar } from '../components/Avatar'
import type { AuthorView, PostView } from '../lib/types'

/**
 * Home feed.
 *
 * A signed-in visitor sees posts from the accounts they follow. A visitor with
 * no follows yet, or nobody signed in, sees the public timeline instead of an
 * empty page. The feed polls so replies and mentions appear without a manual
 * refresh, which matters most on the thread where @smosh replies.
 */
export function HomePage() {
  const { user, ready } = useAuth()
  const [tab, setTab] = useState<'following' | 'latest'>('following')
  const composer = useComposerContext()

  const scope = user && tab === 'following' ? 'home' : 'latest'
  const path = `/api/posts?${query({ feed: scope })}`
  const feed = usePaginated<PostView>(path)
  const { reload } = feed
  const refresh = useCallback(() => reload(), [reload])

  if (!ready) {
    return (
      <main className="content" id="main">
        <div className="loading-row">
          <span className="spinner" aria-hidden />
          <span>Loading Smoshed</span>
        </div>
      </main>
    )
  }

  return (
    <main className="content" id="main">
      {/*
        The feed is reached first and often, and it had no heading at all, so
        someone navigating by headings found nothing here. The tabs already
        name the two views, but a page still needs one top-level heading; it is
        hidden because "Smoshed" is already on screen in the header.
      */}
      <h1 className="sr-only">Smoshed home</h1>
      <div className="tabs" role="tablist" aria-label="Choose a feed">
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab === 'following'}
          onClick={() => setTab('following')}
        >
          Following
        </button>
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab === 'latest'}
          onClick={() => setTab('latest')}
        >
          Latest
        </button>
      </div>

      <Composer onPosted={refresh} {...composer.composerProps} />

      {feed.loading && feed.items.length === 0 ? (
        <div className="loading-row">
          <span className="spinner" aria-hidden />
          <span>Loading posts</span>
        </div>
      ) : null}

      {feed.error ? (
        <div className="alert alert-error" role="alert">
          {feed.error}
        </div>
      ) : null}

      {!feed.loading && feed.items.length === 0 && !feed.error ? (
        <div className="empty-state">
          <h2>Nothing here yet</h2>
          <p>
            {tab === 'following' && user
              ? 'Follow a few accounts and their posts will show up here.'
              : 'No posts have been made yet. Be the first.'}
          </p>
          <p>
            <Link to="/explore" className="btn btn-outline">
              Find people to follow
            </Link>
          </p>
        </div>
      ) : null}

      <div>
        {feed.items.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onChanged={refresh}
            {...composer.cardProps}
          />
        ))}
      </div>

      {feed.nextCursor ? (
        <button type="button" className="btn btn-outline btn-block" onClick={feed.loadMore} disabled={feed.loadingMore}>
          {feed.loadingMore ? 'Loading' : 'Load more'}
        </button>
      ) : null}

      <Suggestions />
    </main>
  )
}

/** "Who to follow" from real accounts, with no placeholder people. */
function Suggestions() {
  // Suggestions is a short, non-paginated list, so it uses the plain fetch.
  const { data } = useFetch<{ users: AuthorView[] }>('/api/users/suggestions')
  const people = data?.users ?? []
  if (people.length === 0) return null

  return (
    <section className="panel" aria-labelledby="suggestions-heading">
      <h2 id="suggestions-heading" style={{ marginBottom: 'var(--space-3)' }}>
        Who to follow
      </h2>
      <div className="user-list">
        {people.map((person) => (
          <Link key={person.id} to={`/${person.handle}`} className="user-row">
            <Avatar seed={person.avatarSeed} name={person.displayName} handle={person.handle} size="sm" />
            <span>
              <strong>{person.displayName}</strong> <span className="muted">@{person.handle}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
