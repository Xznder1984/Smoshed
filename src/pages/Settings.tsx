import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useFetch } from '../hooks/usePaginated'
import { api, ApiError } from '../lib/api'
import { MAX_BIO_LENGTH, MAX_DISPLAY_NAME_LENGTH } from '@shared/constants'
import type { BotSettings, BotSettingsResponse, ProviderId } from '../lib/types'
import { RequireAuth } from '../components/RequireAuth'

type Tab = 'profile' | 'account' | 'bot'

type Notice = { kind: 'error' | 'success'; text: string } | null

export function SettingsPage({ section }: { section?: string }) {
  const { user, refresh } = useAuth()
  const [chosen, setChosen] = useState<Tab>('profile')

  // The bot section has its own route, so it is derived from the path instead
  // of being synced into state after render.
  const tab: Tab = section === 'bot' ? 'bot' : chosen

  return (
    <RequireAuth>
      <main className="content" id="main">
        <h1>Settings</h1>

        <div className="tabs" role="tablist" aria-label="Settings sections">
          {(['profile', 'account', ...(user?.isOwner ? (['bot'] as const) : [])] as Tab[]).map(
            (name) => (
              <button
                key={name}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === name}
                style={{ textTransform: 'capitalize' }}
                onClick={() => setChosen(name)}
              >
                {name === 'bot' ? 'Smosh AI' : name}
              </button>
            ),
          )}
        </div>

        {tab === 'profile' ? <ProfileSettings onSaved={refresh} /> : null}
        {tab === 'account' ? <AccountSettings /> : null}
        {tab === 'bot' ? <BotSettingsPanel /> : null}
      </main>
    </RequireAuth>
  )
}

function ProfileSettings({ onSaved }: { onSaved: () => Promise<void> }) {
  const { user } = useAuth()
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Notice>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await api('/api/auth/profile', {
        method: 'PATCH',
        body: { displayName, bio },
      })
      await onSaved()
      setMessage({ kind: 'success', text: 'Profile saved.' })
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Could not save your profile.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>Profile</h2>

      {message ? (
        <div
          className={message.kind === 'error' ? 'alert alert-error' : 'alert alert-success'}
          role="status"
        >
          {message.text}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="set-name">Display name</label>
        <input
          id="set-name"
          className="input"
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="set-bio">Bio</label>
        <textarea
          id="set-bio"
          className="textarea"
          maxLength={MAX_BIO_LENGTH}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          aria-describedby="bio-count"
        />
        <span className="char-count" id="bio-count" aria-live="polite">
          {MAX_BIO_LENGTH - bio.length}
        </span>
      </div>

      <p className="field-hint">
        Your handle is <strong>@{user?.handle}</strong> and cannot be changed.
      </p>

      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}

function AccountSettings() {
  const { user, logout } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const [deletePassword, setDeletePassword] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      })
      // Every other session was dropped server-side, so the fields are cleared.
      setCurrentPassword('')
      setNewPassword('')
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your password.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault()
    if (confirmText.trim().toLowerCase() !== 'delete') {
      setDeleteError('Type DELETE to confirm.')
      return
    }
    setDeleting(true)
    setDeleteError(null)
    try {
      await api('/api/auth/account', { method: 'DELETE', body: { password: deletePassword } })
      // The session is already gone server-side; clear it here too.
      await logout()
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : 'Could not delete the account. Try again.',
      )
      setDeleting(false)
    }
  }

  async function exportData() {
    try {
      const response = await fetch('/api/auth/export', { credentials: 'same-origin' })
      if (!response.ok) throw new Error('export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'smoshed-data.json'
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Could not build your export. Please try again.')
    }
  }

  return (
    <div className="stack">
      <form className="panel stack" onSubmit={changePassword}>
        <h2>Change password</h2>

        {error ? (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        ) : null}
        {done ? (
          <div className="alert alert-success" role="status">
            Password changed. Other sessions were signed out.
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="cur-password">Current password</label>
          <input
            id="cur-password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            aria-describedby="new-password-hint"
          />
          <span className="field-hint" id="new-password-hint">
            At least 12 characters.
          </span>
        </div>

        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving' : 'Change password'}
          </button>
          <Link to="/forgot-password" className="btn btn-ghost">
            Forgot your password?
          </Link>
        </div>
      </form>

      <section className="panel stack">
        <h2>Your data</h2>
        <p className="muted">
          Download everything Smoshed holds about you: your profile, your posts, and the
          links between you and other people.
        </p>
        <div className="row">
          <button type="button" className="btn btn-outline" onClick={() => void exportData()}>
            Download my data
          </button>
        </div>
      </section>

      <section className="panel stack">
        <h2>Session</h2>
        <p className="muted">Sign out of this browser.</p>
        <div className="row">
          <button type="button" className="btn btn-outline" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </section>

      <section className="panel stack">
        <h2>Delete account</h2>
        <p className="muted">
          This removes your profile and every post, like, repost, bookmark and follow. It
          cannot be undone.
        </p>

        {deleteError ? (
          <div className="alert alert-error" role="alert">
            {deleteError}
          </div>
        ) : null}

        <form className="stack" onSubmit={deleteAccount}>
          <div className="field">
            <label htmlFor="del-password">Confirm your password</label>
            <input
              id="del-password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="del-confirm">Type DELETE to confirm</label>
            <input
              id="del-confirm"
              className="input"
              required
              autoComplete="off"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
            />
          </div>

          <div className="row">
            <button
              type="submit"
              className="btn btn-danger"
              disabled={deleting || deletePassword.length === 0}
            >
              {deleting ? 'Deleting' : `Delete ${user?.handle ? `@${user.handle}` : 'account'}`}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

/**
 * Smosh AI settings.
 *
 * Saving requires a password confirmation. The form spends the password on
 * `/api/auth/reauth` first, and the server decides whether the session is fresh
 * enough to write, so the client-side check is a convenience rather than the
 * control.
 */
function BotSettingsPanel() {
  const { data, loading, error, reload } = useFetch<BotSettingsResponse>('/api/bot/settings')
  const [draft, setDraft] = useState<BotSettings | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Notice>(null)
  const [loaded, setLoaded] = useState<BotSettingsResponse | null>(null)

  // Seed the editable copy from the server response. Adjusting during render
  // rather than in an effect avoids an extra render pass, and a later reload
  // still replaces the draft, which is what "Discard changes" relies on.
  if (data && data !== loaded) {
    setLoaded(data)
    setDraft(pickSettings(data))
  }

  if (loading && !draft) {
    return (
      <div className="loading-row">
        <span className="spinner" aria-hidden />
        <span>Loading Smosh settings</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        {error}
      </div>
    )
  }

  if (!draft || !data) return null

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    setBusy(true)
    setMessage(null)
    try {
      // The password is spent on re-authentication, never sent to the settings
      // endpoint. The server records the resulting session timestamp and checks
      // it on the write.
      await api('/api/auth/reauth', { method: 'POST', body: { password } })
      await api('/api/bot/settings', { method: 'PUT', body: { ...draft } })
      setMessage({ kind: 'success', text: 'Smosh settings saved.' })
      setPassword('')
      reload()
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null
      if (apiError?.status === 428 || apiError?.status === 401) {
        setMessage({ kind: 'error', text: 'That password was not correct. Try again.' })
      } else {
        setMessage({ kind: 'error', text: apiError?.message ?? 'Could not save the settings.' })
      }
    } finally {
      setBusy(false)
    }
  }

  const order = draft.providerOrder
  const current = draft

  function moveProvider(id: ProviderId, direction: -1 | 1) {
    const index = order.indexOf(id)
    const next = index + direction
    if (index < 0 || next < 0 || next >= order.length) return
    const updated = [...order]
    updated[index] = order[next]
    updated[next] = id
    setDraft({ ...current, providerOrder: updated })
  }

  return (
    <form className="panel stack" onSubmit={save}>
      <h2>Smosh AI</h2>
      <p className="muted">
        Controls the built-in bot account. Mention @smosh in a post or a reply and it will
        answer, subject to the limits below.
      </p>

      {message ? (
        <div
          className={message.kind === 'error' ? 'alert alert-error' : 'alert alert-success'}
          role="status"
        >
          {message.text}
        </div>
      ) : null}

      <div className="field">
        <label className="field-label">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            style={{ marginRight: 8 }}
          />
          Smosh replies to mentions
        </label>
      </div>

      <fieldset style={{ border: 'none', padding: 0 }}>
        <legend className="field-label" style={{ marginBottom: 'var(--space-2)' }}>
          Provider order
        </legend>
        <p className="field-hint" style={{ marginBottom: 'var(--space-2)' }}>
          Tried top to bottom. A provider with no API key is skipped.
        </p>
        {data.providers.map((provider) => {
          const position = order.indexOf(provider.id)
          return (
            <div key={provider.id} className="row-between" style={{ padding: 'var(--space-2) 0' }}>
              <span>
                <strong>
                  {position + 1}. {provider.label}
                </strong>{' '}
                <span className={provider.configured ? 'muted' : 'field-error'}>
                  {provider.configured ? `ready - ${provider.model}` : 'no API key set'}
                </span>
              </span>
              <span className="row" style={{ gap: 4 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label={`Move ${provider.label} up`}
                  disabled={position === 0}
                  onClick={() => moveProvider(provider.id, -1)}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label={`Move ${provider.label} down`}
                  disabled={position === order.length - 1}
                  onClick={() => moveProvider(provider.id, 1)}
                >
                  Down
                </button>
              </span>
            </div>
          )
        })}
      </fieldset>

      <div className="field">
        <label htmlFor="bot-prompt">System prompt</label>
        <textarea
          id="bot-prompt"
          className="textarea"
          rows={8}
          value={draft.systemPrompt}
          onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })}
        />
        <span className="field-hint">
          Defines how Smosh behaves. Anything a user writes is treated as data, never as
          instructions.
        </span>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-4)' }}>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label htmlFor="bot-per-user">Replies per user per hour</label>
          <input
            id="bot-per-user"
            className="input"
            type="number"
            min={0}
            max={500}
            value={draft.perUserHourlyLimit}
            onChange={(event) =>
              setDraft({ ...draft, perUserHourlyLimit: Number(event.target.value) })
            }
          />
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label htmlFor="bot-global-hour">Replies per hour, site wide</label>
          <input
            id="bot-global-hour"
            className="input"
            type="number"
            min={0}
            max={5000}
            value={draft.globalHourlyLimit}
            onChange={(event) =>
              setDraft({ ...draft, globalHourlyLimit: Number(event.target.value) })
            }
          />
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label htmlFor="bot-global-day">Replies per day, site wide</label>
          <input
            id="bot-global-day"
            className="input"
            type="number"
            min={0}
            max={50000}
            value={draft.globalDailyLimit}
            onChange={(event) =>
              setDraft({ ...draft, globalDailyLimit: Number(event.target.value) })
            }
          />
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label htmlFor="bot-depth">Max bot replies per thread</label>
          <input
            id="bot-depth"
            className="input"
            type="number"
            min={0}
            max={5}
            value={draft.maxDepth}
            onChange={(event) => setDraft({ ...draft, maxDepth: Number(event.target.value) })}
          />
        </div>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-4)' }}>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label htmlFor="bot-temp">Temperature</label>
          <input
            id="bot-temp"
            className="input"
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={draft.temperature}
            onChange={(event) => setDraft({ ...draft, temperature: Number(event.target.value) })}
          />
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label htmlFor="bot-tokens">Max reply length (tokens)</label>
          <input
            id="bot-tokens"
            className="input"
            type="number"
            min={32}
            max={1000}
            step={10}
            value={draft.maxTokens}
            onChange={(event) => setDraft({ ...draft, maxTokens: Number(event.target.value) })}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="bot-blocked">Blocked words</label>
        <input
          id="bot-blocked"
          className="input"
          value={draft.blockedWords.join(', ')}
          onChange={(event) =>
            setDraft({
              ...draft,
              blockedWords: event.target.value
                .split(',')
                .map((word) => word.trim())
                .filter(Boolean),
            })
          }
          aria-describedby="blocked-hint"
        />
        <span className="field-hint" id="blocked-hint">
          Comma separated. If a reply contains any of these, it is dropped.
        </span>
      </div>

      <div className="field">
        <label htmlFor="bot-password">Confirm your password to save</label>
        <input
          id="bot-password"
          className="input"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <span className="field-hint">Required every time, and valid for 10 minutes.</span>
      </div>

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving' : 'Save Smosh settings'}
        </button>
        <button type="button" className="btn btn-outline" onClick={reload} disabled={busy}>
          Discard changes
        </button>
        <Link to="/legal/privacy" className="btn btn-ghost">
          Privacy policy
        </Link>
      </div>
    </form>
  )
}

/**
 * The editable fields, without the reference data the response also carries.
 * Keeping this explicit means a new read-only field cannot be sent back and
 * rejected by the write schema.
 */
function pickSettings(data: BotSettingsResponse): BotSettings {
  return {
    enabled: data.enabled,
    providerOrder: data.providerOrder,
    models: data.models,
    systemPrompt: data.systemPrompt,
    temperature: data.temperature,
    maxTokens: data.maxTokens,
    perUserHourlyLimit: data.perUserHourlyLimit,
    globalHourlyLimit: data.globalHourlyLimit,
    globalDailyLimit: data.globalDailyLimit,
    maxDepth: data.maxDepth,
    blockedWords: data.blockedWords,
    updatedAt: data.updatedAt,
  }
}
