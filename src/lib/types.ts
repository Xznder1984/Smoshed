/**
 * Response shapes the client expects back from the API.
 *
 * These mirror what the Hono routes actually serialise. `Date` values are
 * already ISO strings by the time they reach the browser, so nothing here
 * needs parsing.
 */
export type AuthorView = {
  id: string
  handle: string
  displayName: string
  bio: string
  avatarSeed: string
  isBot: boolean
  isAdmin: boolean
  createdAt: string
  counts: { followers: number; following: number; posts: number }
  viewer?: {
    following: boolean
    followedBy: boolean
    blocking: boolean
    blockedBy: boolean
    muting: boolean
  }
}

export type PostView = {
  id: string
  body: string
  createdAt: string
  author: AuthorView
  replyToId: string | null
  quoteOfId: string | null
  depth: number
  isBotReply: boolean
  counts: { replies: number; reposts: number; likes: number; quotes: number }
  viewer: {
    liked: boolean
    reposted: boolean
    bookmarked: boolean
    followingAuthor: boolean
  }
  replyTo?: PostView | null
  quoteOf?: PostView | null
}

export type SessionUser = AuthorView & {
  email: string
  isOwner: boolean
}

export type NotificationItem = {
  id: string
  type: 'reply' | 'repost' | 'like' | 'follow' | 'mention' | 'quote' | 'bot_reply'
  createdAt: string
  readAt: string | null
  actor: AuthorView | null
  post: PostView | null
}

/**
 * `GET /api/users/:handle` returns the author with the viewer's relationship
 * nested inside it, so `viewer` is read off `user`.
 */
export type UserProfile = {
  user: AuthorView
}

export type ProviderId = 'groq' | 'nvidia' | 'ollama' | 'keenable'

export type BotSettings = {
  enabled: boolean
  providerOrder: ProviderId[]
  models: Record<ProviderId, string>
  systemPrompt: string
  temperature: number
  maxTokens: number
  perUserHourlyLimit: number
  globalHourlyLimit: number
  globalDailyLimit: number
  maxDepth: number
  blockedWords: string[]
  updatedAt: string
}

/** `GET /api/bot/settings` returns the editable settings plus reference data. */
export type BotSettingsResponse = BotSettings & {
  providers: {
    id: ProviderId
    label: string
    configured: boolean
    baseUrl: string
    model: string
  }[]
  defaults: { providerOrder: ProviderId[]; systemPrompt: string }
  limits: { maxPostLength: number }
}

/** A cursor-paginated list: the shape every list endpoint returns. */
export type Page<T> = {
  items: T[]
  nextCursor: string | null
}

/** `GET /api/posts/:id/thread` returns the whole conversation in one request. */
export type ThreadResponse = {
  ancestors: PostView[]
  root: PostView
  replies: PostView[]
}

export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'hate'
  | 'violence'
  | 'self_harm'
  | 'sexual'
  | 'misinformation'
  | 'other'

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam or scams' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'self_harm', label: 'Self-harm content' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'misinformation', label: 'False information' },
  { value: 'other', label: 'Something else' },
]
