import { env } from './env.js'

export type OAuthProvider = 'google' | 'discord'

export type OAuthProfile = {
  provider: OAuthProvider
  providerId: string
  email: string
  displayName: string
}

export class OAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OAuthError'
  }
}

function redirectUri(provider: OAuthProvider): string {
  const base = env.appUrl
  return `${base}/api/auth/${provider}/callback`
}

export function authorizeUrl(provider: OAuthProvider, state: string): string {
  const redirect = redirectUri(provider)

  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID
    if (!clientId) throw new OAuthError('Google sign-in is not configured')
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }

  const clientId = process.env.DISCORD_CLIENT_ID
  if (!clientId) throw new OAuthError('Discord sign-in is not configured')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'identify email',
    state,
  })
  return `https://discord.com/oauth2/authorize?${params}`
}

export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
): Promise<OAuthProfile> {
  const redirect = redirectUri(provider)

  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    if (!clientId || !clientSecret) throw new OAuthError('Google sign-in is not configured')

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) throw new OAuthError('Google token exchange failed')
    const token = (await tokenRes.json()) as { access_token?: string }
    if (!token.access_token) throw new OAuthError('Google token exchange failed')

    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    if (!profileRes.ok) throw new OAuthError('Google profile fetch failed')
    const profile = (await profileRes.json()) as {
      sub?: string
      email?: string
      name?: string
      picture?: string
    }
    if (!profile.sub || !profile.email) throw new OAuthError('Google profile incomplete')

    return {
      provider: 'google',
      providerId: profile.sub,
      email: profile.email,
      displayName: profile.name ?? profile.email.split('@')[0]!,
    }
  }

  const clientId = process.env.DISCORD_CLIENT_ID
  const clientSecret = process.env.DISCORD_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new OAuthError('Discord sign-in is not configured')

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) throw new OAuthError('Discord token exchange failed')
  const token = (await tokenRes.json()) as { access_token?: string }
  if (!token.access_token) throw new OAuthError('Discord token exchange failed')

  const profileRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
  if (!profileRes.ok) throw new OAuthError('Discord profile fetch failed')
  const profile = (await profileRes.json()) as {
    id?: string
    email?: string
    username?: string
    global_name?: string
  }
  if (!profile.id || !profile.email) throw new OAuthError('Discord profile incomplete')

  return {
    provider: 'discord',
    providerId: profile.id,
    email: profile.email,
    displayName: profile.global_name ?? profile.username ?? 'Discord user',
  }
}

export function isOAuthConfigured(provider: OAuthProvider): boolean {
  if (provider === 'google') {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  }
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET)
}
