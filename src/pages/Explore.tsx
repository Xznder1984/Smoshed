import { type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useFetch } from '../hooks/usePaginated'
import type { AuthorView, PostView } from '../lib/types'
import { Avatar } from '../components/Avatar'
import { PostCard } from '../components/PostCard'
import { IconSearch } from '../components/icons'

type Results = { posts: PostView[]; users: AuthorView[] }

/**
 * Search page.
 *
 * The query lives in the URL so a result can be linked to and the back button
 * works, and the fetch is delegated to the shared hook. An empty query asks for
 * nothing at all, so the page does not hit the server on every visit.
 */
export function ExplorePage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const submitted = params.get('q')?.trim() ?? ''

  const search = useFetch<Results>(
    submitted.length > 0 ? `/api/search?q=${encodeURIComponent(submitted)}` : null,
  )

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = String(form.get('q') ?? '').trim()
    setParams(value.length > 0 ? { q: value } : {}, { replace: true })
  }

  const results = search.data
  const total = (results?.posts.length ?? 0) + (results?.users.length ?? 0)

  return (
    <main className="content" id="main">
      <h1>Explore</h1>

      <form
        className="search-field"
        style={{ margin: 'var(--space-4) 0' }}
        onSubmit={submit}
        role="search"
      >
        <IconSearch size={20} />
        <label htmlFor="search-input" className="sr-only">
          Search posts and people
        </label>
        <input
          id="search-input"
          name="q"
          className="input"
          type="search"
          defaultValue={submitted}
          placeholder="Search posts and people"
          maxLength={120}
        />
      </form>

      {search.loading ? (
        <div className="loading-row">
          <span className="spinner" aria-hidden />
          <span>Searching</span>
        </div>
      ) : null}

      {search.error ? (
        <div className="alert alert-error" role="alert">
          {search.error}
        </div>
      ) : null}

      {results && !search.loading ? (
        <div role="status" className="sr-only">
          {total} results
        </div>
      ) : null}

      {results && total === 0 ? (
        <div className="empty-state">
          <h2>No results</h2>
          <p>
            Nothing matched &ldquo;{submitted}&rdquo;. Try a different search.
          </p>
        </div>
      ) : null}

      {results && results.users.length > 0 ? (
        <section className="result-group" aria-labelledby="people-results">
          <h2 className="group-heading" id="people-results">
            People
          </h2>
          <div className="user-list">
            {results.users.map((person) => (
              <Link key={person.id} to={`/${person.handle}`} className="user-row">
                <Avatar
                  seed={person.avatarSeed}
                  name={person.displayName}
                  handle={person.handle}
                  size="sm"
                />
                <span>
                  <strong>{person.displayName}</strong>{' '}
                  <span className="muted">@{person.handle}</span>
                  {person.bio ? (
                    <span style={{ display: 'block' }} className="muted">
                      {person.bio}
                    </span>
                  ) : null}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {results && results.posts.length > 0 ? (
        <section className="result-group" aria-labelledby="post-results">
          <h2 className="group-heading" id="post-results">
            Posts
          </h2>
          {results.posts.map((post) => (
            <PostCard key={post.id} post={post} onChanged={search.reload} />
          ))}
        </section>
      ) : null}

      {!submitted && !search.loading ? (
        <div className="empty-state">
          <h2>Find people and posts</h2>
          <p>Search by name, handle, or words in a post.</p>
          {!user ? (
            <p>
              <Link to="/signup" className="btn btn-primary">
                Create an account
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </main>
  )
}
