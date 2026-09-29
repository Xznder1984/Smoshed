import { createContext, useContext } from 'react'
import type { SessionUser } from '../lib/types'

export type AuthState = {
  user: SessionUser | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (input: {
    email: string
    password: string
    handle: string
    displayName: string
  }) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

/** Reads the signed-in session. Throws if used outside the provider. */
export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
