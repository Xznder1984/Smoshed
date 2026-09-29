import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

/**
 * Wraps a page that only makes sense when signed in. The session is probed
 * once on load, so the real check cannot run until `ready` is true, otherwise a
 * signed-in visitor would be bounced to sign in on every refresh.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const location = useLocation()

  if (!ready) {
    return (
      <div className="loading-row" role="status">
        <span className="spinner" aria-hidden />
        <span>Checking your session</span>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="empty-state">
        <h1>Sign in to continue</h1>
        <p>You need an account to see this page.</p>
        <p>
          <Link to="/login" state={{ from: location.pathname }} className="btn btn-primary">
            Sign in
          </Link>
        </p>
        <p>
          No account yet? <Link to="/signup">Create one</Link>.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
