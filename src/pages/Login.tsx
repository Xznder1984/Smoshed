import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { ApiError } from '../lib/api'

/**
 * Sign-in form.
 *
 * Failures are shown as a single message above the form rather than next to
 * each field, and the message never reveals whether an address exists.
 */
export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
      navigate('/')
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not sign in. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="content" id="main">
      <div className="panel">
        <h1>Sign in to Smoshed</h1>

        {error ? (
          <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-4)' }}>
            {error}
          </div>
        ) : null}

        <form className="stack" style={{ marginTop: 'var(--space-4)' }} onSubmit={submit}>
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Signing in' : 'Sign in'}
          </button>
        </form>

        <p style={{ marginTop: 'var(--space-4)' }}>
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>
        <p>
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </div>
    </main>
  )
}
