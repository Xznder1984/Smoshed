/**
 * Single place that reads process.env. Every read is explicit, nothing is
 * logged, and a missing value fails loudly at the point of use rather than
 * turning into a confusing undefined later.
 */
export const env = {
  get databaseUrl(): string {
    return require_('DATABASE_URL')
  },
  get sessionSecret(): string {
    return require_('SESSION_SECRET')
  },
  /**
   * The one account allowed to change Smosh AI settings. Resolved server-side
   * on every request; never sent to the browser and never user-editable.
   */
  get ownerEmail(): string {
    return (process.env.OWNER_EMAIL ?? '').trim().toLowerCase()
  },
  get groqApiKey(): string | undefined {
    return optional('GROQ_API_KEY')
  },
  get nvidiaApiKey(): string | undefined {
    return optional('NVIDIA_API_KEY')
  },
  get ollamaApiKey(): string | undefined {
    return optional('OLLAMA_API_KEY')
  },
  get keenableApiKey(): string | undefined {
    return optional('KEENABLE_API_KEY')
  },
  get googleClientId(): string | undefined {
    return optional('GOOGLE_CLIENT_ID')
  },
  get googleClientSecret(): string | undefined {
    return optional('GOOGLE_CLIENT_SECRET')
  },
  get discordClientId(): string | undefined {
    return optional('DISCORD_CLIENT_ID')
  },
  get discordClientSecret(): string | undefined {
    return optional('DISCORD_CLIENT_SECRET')
  },
  /**
   * The public address of this deployment. Used for password reset links, so
   * it should be the address a person actually visits.
   *
   * It may also be a comma-separated list when one deployment serves more than
   * one address, which is what happens with Vercel preview URLs: every commit
   * gets its own hostname, and a single pinned value would be wrong for all but
   * the one it was copied from. The first entry is the canonical one.
   */
  get appUrls(): string[] {
    const configured = (process.env.APP_URL ?? 'http://localhost:5173')
      .split(',')
      .map((value) => value.trim().replace(/\/+$/, ''))
      .filter(Boolean)
    return configured.length > 0 ? configured : ['http://localhost:5173']
  },
  get appUrl(): string {
    return this.appUrls[0]!
  },
  /**
   * Whether to mark cookies `Secure`.
   *
   * This is about the transport the browser is actually using, not about the
   * value in `APP_URL`. Deriving it from `APP_URL` means a deployment with a
   * stale or absent value silently drops the flag and ships session cookies
   * without transport protection, so an unset value is treated as production
   * and only local development turns it off.
   */
  get useSecureCookies(): boolean {
    if (this.appUrls.some((url) => url.startsWith('https'))) return true
    return process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'
  },
  /**
   * Origins allowed to send credentialed API requests.
   *
   * The two loopback entries exist only for local development, where Vite
   * serves the app on a different port from the API. In production the
   * deployment's own origin is the only one, and credentials are never combined
   * with a wildcard.
   */
  get allowedOrigins(): string[] {
    const local = ['http://localhost:5173', 'http://127.0.0.1:5173']
    const configured = this.appUrls.filter((url) => !local.includes(url))
    return [...configured, ...local]
  },
  /** Resend API key, used only for password reset delivery. */
  get resendApiKey(): string | undefined {
    return optional('RESEND_API_KEY')
  },
  /**
   * Shared secret for the routes a platform scheduler calls, such as the bot job
   * runner and the maintenance purge.
   *
   * Those endpoints also accept an owner session so the owner can trigger them
   * by hand, but a timer holds no session, so it authenticates with this instead.
   * It is compared as a credential and never sent to the browser.
   */
  get cronSecret(): string | undefined {
    return optional('CRON_SECRET')
  },
  /** Verified sender address, for example "Smoshed <no-reply@yourdomain>". */
  get mailFrom(): string | undefined {
    return optional('MAIL_FROM')
  },
}

function require_(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export const SESSION_COOKIE = 'smosh_session'
export const CSRF_COOKIE = 'smosh_csrf'
export const SESSION_TTL_DAYS = 30
export const MAX_POST_LENGTH = 280
export const BOT_HANDLE = 'smosh'
