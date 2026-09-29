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
  const [magicEmail, setMagicEmail] = useState('')
  const [magicSent, setMagicSent] = useState(false)
  const [magicBusy, setMagicBusy] = useState(false)

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

  async function sendMagicLink(event: FormEvent) {
    event.preventDefault()
    if (magicBusy) return
    setMagicBusy(true)
    setMagicSent(false)
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: magicEmail.trim() }),
      })
      if (res.ok) {
        setMagicSent(true)
      } else {
        const data = await res.json().catch(() => null)
        setError(data?.error?.message ?? 'Could not send sign-in link.')
      }
    } catch {
      setError('Could not send sign-in link. Please try again.')
    } finally {
      setMagicBusy(false)
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

        <div className="stack" style={{ marginTop: 'var(--space-4)' }}>
          <a href="/api/auth/google" className="btn btn-outline btn-block">
            Continue with Google
          </a>
          <a href="/api/auth/discord" className="btn btn-outline btn-block">
            Continue with Discord
          </a>
        </div>

        <div className="divider">
          <span>or</span>
        </div>

        <form className="stack" onSubmit={submit}>
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

        <div className="divider">
          <span>or</span>
        </div>

        <form className="stack" onSubmit={sendMagicLink}>
          <div className="field">
            <label htmlFor="magic-email">Email sign-in link</label>
            <input
              id="magic-email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={magicEmail}
              onChange={(event) => setMagicEmail(event.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-outline btn-block" disabled={magicBusy}>
            {magicBusy ? 'Sending' : 'Email me a sign-in link'}
          </button>
          {magicSent ? (
            <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
              Check your email for a sign-in link.
            </p>
          ) : null}
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
