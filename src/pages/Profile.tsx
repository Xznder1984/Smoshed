import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useFetch, usePaginated } from '../hooks/usePaginated'
import { useComposerContext } from '../hooks/useComposerContext'
import { api, ApiError } from '../lib/api'
import { compactNumber } from '../lib/format'
import type { AuthorView, PostView, UserProfile } from '../lib/types'
import { Avatar } from '../components/Avatar'
import { PostCard } from '../components/PostCard'
import { Composer } from '../components/Composer'
import { IconBlock, IconMute } from '../components/icons'

type Tab = 'posts' | 'replies' | 'followers' | 'following'

export function ProfilePage() {
  const rawHandle = useParams<{ handle: string }>().handle ?? ''
  const handle = rawHandle.replace(/^@/, '')
  const { user: viewerSession } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('posts')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const composer = useComposerContext()

  const profile = useFetch<UserProfile>(handle ? `/api/users/${handle}` : null)

  const listPath = handle
    ? tab === 'posts'
      ? `/api/users/${handle}/posts`
      : tab === 'replies'
        ? `/api/users/${handle}/replies`
        : tab === 'followers'
          ? `/api/users/${handle}/followers`
          : `/api/users/${handle}/following`
    : null

  const isPeopleTab = tab === 'followers' || tab === 'following'
  const posts = usePaginated<PostView>(listPath && !isPeopleTab ? listPath : null)
  const people = usePaginated<AuthorView>(listPath && isPeopleTab ? listPath : null)

  if (profile.error) {
    return (
      <main className="content" id="main">
        <div className="alert alert-error" role="alert">
          {profile.error}
        </div>
        <p style={{ marginTop: 'var(--space-4)' }}>
          <Link to="/">Back to the feed</Link>
        </p>
      </main>
    )
  }

  if (profile.loading && !profile.data) {
    return (
      <main className="content" id="main">
        <div className="loading-row">
          <span className="spinner" aria-hidden />
          <span>Loading profile</span>
        </div>
      </main>
    )
  }

  const data = profile.data
  if (!data) return null

  // The relationship the viewer has with this account is nested on the user,
  // and being signed in as them is decided locally against the session.
  const person = data.user
  const viewer = person.viewer
  const isSelf = viewerSession?.id === person.id

  async function act(kind: 'follow' | 'mute' | 'block') {
    if (!handle || busy) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/users/${handle}/${kind}`, { method: 'POST' })
      profile.reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="content" id="main">
      <div className="panel">
        <div className="profile-header">
          <Avatar
            seed={person.avatarSeed}
            name={person.displayName}
            handle={person.handle}
            size="lg"
            ring
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <h1>{person.displayName}</h1>
              {person.isBot ? <span className="tag tag-bot">bot</span> : null}
              {person.isAdmin ? <span className="tag tag-owner">admin</span> : null}
            </div>
            <p className="muted">@{person.handle}</p>
            {person.bio ? <p style={{ marginTop: 'var(--space-2)' }}>{person.bio}</p> : null}

            <div className="profile-stats">
              <span>
                <span className="stat-value">{compactNumber(person.counts.posts)}</span>{' '}
                <span className="stat-label">Posts</span>
              </span>
              <span>
                <span className="stat-value">{compactNumber(person.counts.followers)}</span>{' '}
                <span className="stat-label">Followers</span>
              </span>
              <span>
                <span className="stat-value">{compactNumber(person.counts.following)}</span>{' '}
                <span className="stat-label">Following</span>
              </span>
            </div>
          </div>
        </div>

        {error ? (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        ) : null}

        {isSelf ? (
          <div className="row">
            <Link to="/settings" className="btn btn-outline">
              Edit profile
            </Link>
          </div>
        ) : viewerSession && viewer ? (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className={viewer.following ? 'btn btn-outline' : 'btn btn-primary'}
              disabled={busy || viewer.blockedBy}
              aria-pressed={viewer.following}
              onClick={() => void act('follow')}
            >
              {viewer.following ? 'Following' : 'Follow'}
            </button>

            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              aria-pressed={viewer.muting}
              onClick={() => void act('mute')}
            >
              <IconMute size={18} />
              {viewer.muting ? 'Muted' : 'Mute'}
            </button>

            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              aria-pressed={viewer.blocking}
              onClick={() => {
                if (
                  !viewer.blocking &&
                  !confirm(
                    `Block @${person.handle}? They will not be able to follow you, reply to you, or see your posts.`,
                  )
                ) {
                  return
                }
                void act('block')
              }}
            >
              <IconBlock size={18} />
              {viewer.blocking ? 'Unblock' : 'Block'}
            </button>
          </div>
        ) : viewerSession ? null : (
          <div className="row">
            <Link to="/login" className="btn btn-primary">
              Sign in to follow
            </Link>
          </div>
        )}

        {viewer?.blocking ? (
          <p className="callout" style={{ marginTop: 'var(--space-3)' }}>
            You have blocked <strong>@{person.handle}</strong>. Their posts are hidden from
            your feeds, and they cannot reach you.
          </p>
        ) : null}
      </div>

      <div className="tabs" role="tablist" aria-label="Profile sections">
        {(['posts', 'replies', 'followers', 'following'] as Tab[]).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === name}
            style={{ textTransform: 'capitalize' }}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Your own composer sits above the Posts tab. On someone else's profile
          it is hidden until you actually reply to or quote something, so the
          buttons are never inert. */}
      {(isSelf && tab === 'posts') || composer.active ? (
        <Composer onPosted={posts.reload} placeholder="Say something" {...composer.composerProps} />
      ) : null}

      {isPeopleTab ? (
        people.items.length === 0 && !people.loading ? (
          <div className="empty-state">
            <p>Nobody here yet.</p>
          </div>
        ) : (
          <div className="user-list">
            {people.items.map((person) => (
              <Link key={person.id} to={`/@${person.handle}`} className="user-row">
                <Avatar
                  seed={person.avatarSeed}
                  name={person.displayName}
                  handle={person.handle}
                  size="sm"
                />
                <span>
                  <strong>{person.displayName}</strong>{' '}
                  <span className="muted">@{person.handle}</span>
                </span>
              </Link>
            ))}
          </div>
        )
      ) : posts.items.length === 0 && !posts.loading ? (
        <div className="empty-state">
          <h2>{tab === 'replies' ? 'No replies yet' : 'No posts yet'}</h2>
        </div>
      ) : (
        <div>
          {posts.items.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onChanged={posts.reload}
              {...composer.cardProps}
            />
          ))}
        </div>
      )}

      <p style={{ marginTop: 'var(--space-5)' }}>
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
          Go back
        </button>
      </p>
    </main>
  )
}
