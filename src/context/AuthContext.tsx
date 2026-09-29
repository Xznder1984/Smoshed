import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler } from '../lib/api'
import { AuthContext } from './useAuth'
import type { SessionUser } from '../lib/types'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: SessionUser | null }>('/api/auth/session')
      setUser(data.user)
    } catch {
      // A failed session probe is not an error worth showing: the app simply
      // continues as a signed-out visitor.
      setUser(null)
    } finally {
      setReady(true)
    }
  }, [])

  // Probing the session reads external state once, so the update happens in the
  // promise callback rather than in the effect body.
  useEffect(() => {
    let cancelled = false

    api<{ user: SessionUser | null }>('/api/auth/session')
      .then((data) => {
        if (!cancelled) setUser(data.user)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // A 401 from anywhere in the app drops the local session immediately rather
  // than leaving the UI in a half-signed-in state.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    return () => setUnauthorizedHandler(() => {})
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    setUser(data.user)
    setReady(true)
  }, [])

  const signup = useCallback(
    async (input: { email: string; password: string; handle: string; displayName: string }) => {
      const data = await api<{ user: SessionUser }>('/api/auth/signup', {
        method: 'POST',
        body: input,
      })
      setUser(data.user)
      setReady(true)
    },
    [],
  )

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo(
    () => ({ user, ready, login, signup, logout, refresh }),
    [user, ready, login, signup, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
