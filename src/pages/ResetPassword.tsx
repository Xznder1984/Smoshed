import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { passwordStrength } from '../lib/format'

/**
 * Sets a new password from a reset link.
 *
 * The token arrives in the query string and is sent once. On success the server
 * destroys every session for that account, so the browser is signed out and
 * sent to the sign-in page rather than pretending to be still signed in.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return

    if (password !== confirm) {
      setProblem('The two passwords do not match.')
      return
    }
    const strength = passwordStrength(password)
    if (!strength.ok) {
      setProblem(strength.message)
      return
    }
    setProblem(null)
    setBusy(true)
    setError(null)

    try {
      await api('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: { token, password },
      })
      navigate('/login', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reset the password. The link may have expired.',
      )
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <main className="content" id="main">
        <div className="panel">
          <h1>Reset your password</h1>
          <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-4)' }}>
            This link is missing its reset token. Request a new link.
          </div>
          <p style={{ marginTop: 'var(--space-4)' }}>
            <Link to="/forgot-password">Request a new link</Link>
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="content" id="main">
      <div className="panel">
        <h1>Choose a new password</h1>

        {error ? (
          <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-4)' }}>
            {error}
          </div>
        ) : null}

        {problem ? (
          <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-4)' }}>
            {problem}
          </div>
        ) : null}

        <form className="stack" style={{ marginTop: 'var(--space-4)' }} onSubmit={submit}>
          <div className="field">
            <label htmlFor="new-reset-password">New password</label>
            <input
              id="new-reset-password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby="new-reset-hint"
            />
            <span className="field-hint" id="new-reset-hint">
              At least 12 characters.
            </span>
          </div>

          <div className="field">
            <label htmlFor="confirm-reset-password">Confirm new password</label>
            <input
              id="confirm-reset-password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Saving' : 'Set new password'}
          </button>
        </form>
      </div>
    </main>
  )
}
