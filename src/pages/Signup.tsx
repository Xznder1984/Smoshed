import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { ApiError } from '../lib/api'
import { handleError, passwordStrength } from '../lib/format'
import { MIN_PASSWORD_LENGTH } from '@shared/constants'

export function SignupPage() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ displayName: '', handle: '', email: '', password: '' })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [handleProblem, setHandleProblem] = useState<string | null>(null)
  const [passwordProblem, setPasswordProblem] = useState<string | null>(null)

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return

    // Same rules the server applies, checked up front so the user is not made
    // to wait for a round trip to learn the handle is taken.
    const problems: Record<string, string> = {}
    const handle = form.handle.trim().toLowerCase()
    const handleMessage = handleError(handle)
    if (handleMessage) problems.handle = handleMessage
    const strength = passwordStrength(form.password)
    if (!strength.ok) problems.password = strength.message ?? 'Choose a stronger password.'

    setFieldErrors(problems)
    if (Object.keys(problems).length > 0) return

    setBusy(true)
    setError(null)
    try {
      await signup({
        email: form.email.trim(),
        password: form.password,
        handle,
        displayName: form.displayName.trim(),
      })
      navigate('/')
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        if (err.fields.length > 0) {
          setFieldErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])))
        }
      } else {
        setError('Could not create your account. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="content" id="main">
      <div className="panel">
        <h1>Create your account</h1>

        {error ? (
          <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-4)' }}>
            {error}
          </div>
        ) : null}

        <div className="stack" style={{ marginTop: 'var(--space-4)' }}>
          <a href="/api/auth/google" className="btn btn-outline btn-block">
            Sign up with Google
          </a>
          <a href="/api/auth/discord" className="btn btn-outline btn-block">
            Sign up with Discord
          </a>
        </div>

        <div className="divider">
          <span>or</span>
        </div>

        <form className="stack" style={{ marginTop: 'var(--space-4)' }} onSubmit={submit}>
          <div className="field">
            <label htmlFor="signup-name">Display name</label>
            <input
              id="signup-name"
              className="input"
              autoComplete="name"
              maxLength={50}
              required
              value={form.displayName}
              onChange={(event) => update('displayName', event.target.value)}
              aria-invalid={Boolean(fieldErrors.displayName)}
              aria-describedby={fieldErrors.displayName ? 'err-name' : undefined}
            />
            {fieldErrors.displayName ? (
              <span className="field-error" id="err-name">
                {fieldErrors.displayName}
              </span>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="signup-handle">Handle</label>
            <input
              id="signup-handle"
              className="input"
              autoComplete="username"
              required
              value={form.handle}
              onChange={(event) => {
                const value = event.target.value.toLowerCase()
                update('handle', value)
                setHandleProblem(handleError(value))
              }}
              onBlur={() => setHandleProblem(handleError(form.handle.trim().toLowerCase()))}
              aria-invalid={Boolean(fieldErrors.handle || handleProblem)}
              aria-describedby="hint-handle err-handle"
              spellCheck={false}
            />
            <span className="field-hint" id="hint-handle">
              Letters, numbers, and underscores. This is how people will find you.
            </span>
            {fieldErrors.handle || handleProblem ? (
              <span className="field-error" id="err-handle">
                {fieldErrors.handle ?? handleProblem}
              </span>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={(event) => update('email', event.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'err-email' : undefined}
            />
            {fieldErrors.email ? (
              <span className="field-error" id="err-email">
                {fieldErrors.email}
              </span>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={form.password}
              onChange={(event) => {
                update('password', event.target.value)
                setPasswordProblem(passwordStrength(event.target.value).message)
              }}
              aria-invalid={Boolean(fieldErrors.password || passwordProblem)}
              aria-describedby="hint-password err-password"
            />
            <span className="field-hint" id="hint-password">
              At least {MIN_PASSWORD_LENGTH} characters. A short sentence you will remember
              works well.
            </span>
            {fieldErrors.password || passwordProblem ? (
              <span className="field-error" id="err-password">
                {fieldErrors.password ?? passwordProblem}
              </span>
            ) : null}
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Creating your account' : 'Create account'}
          </button>
        </form>

        <p style={{ marginTop: 'var(--space-4)' }}>
          By signing up you agree to the <Link to="/legal/terms">terms</Link> and{' '}
          <Link to="/legal/privacy">privacy policy</Link>.
        </p>
        <p>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </main>
  )
}
