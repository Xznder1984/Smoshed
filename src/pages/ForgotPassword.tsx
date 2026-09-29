import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { canResetPasswords } from '../lib/site'

/**
 * Requests a password reset link.
 *
 * The response is deliberately identical whether or not the address exists, so
 * this page cannot be used to discover which addresses are registered. The
 * confirmation below is therefore phrased as a possibility, not a promise.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/auth/password-reset/request', {
        method: 'POST',
        body: { email: email.trim() },
      })
      setSent(true)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not send the reset link. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="content" id="main">
      <div className="panel">
        <h1>Reset your password</h1>

        {sent ? (
          <div role="status" style={{ marginTop: 'var(--space-4)' }}>
            <p>
              If that address belongs to a Smoshed account, a reset link is on its way. The
              link is valid for one hour and can only be used once.
            </p>
            {canResetPasswords() ? null : (
              <p className="muted">
                Mail delivery is not configured on this deployment yet, so no message will
                actually arrive. Ask the operator for a link.
              </p>
            )}
            <p>
              <Link to="/login">Back to sign in</Link>
            </p>
          </div>
        ) : (
          <>
            {error ? (
              <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-4)' }}>
                {error}
              </div>
            ) : null}

            {canResetPasswords() ? null : (
              <div className="alert alert-warning" role="status" style={{ marginTop: 'var(--space-4)' }}>
                Password reset is not available on this deployment: no mail provider is
                configured, so a link could not be delivered.
              </div>
            )}

            <form className="stack" style={{ marginTop: 'var(--space-4)' }} onSubmit={submit}>
              <div className="field">
                <label htmlFor="reset-email">Email</label>
                <input
                  id="reset-email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-describedby="reset-hint"
                />
                <span className="field-hint" id="reset-hint">
                  The address you signed up with.
                </span>
              </div>

              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                {busy ? 'Sending' : 'Send reset link'}
              </button>
            </form>
          </>
        )}

        <p style={{ marginTop: 'var(--space-4)' }}>
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </main>
  )
}
