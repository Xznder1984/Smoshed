import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="content" id="main">
      <div className="empty-state">
        <h1>404</h1>
        <h2>That page does not exist</h2>
        <p>It may have been deleted, or the link may be wrong.</p>
        <p>
          <Link to="/" className="btn btn-primary">
            Go to the feed
          </Link>
        </p>
      </div>
    </main>
  )
}
