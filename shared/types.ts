/** Wire shape of a post as the client receives it. */
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
  viewer?: { following: boolean; followedBy: boolean; blocking: boolean; muting: boolean; blockedBy: boolean }
}

export type NotificationView = {
  id: string
  type: 'like' | 'repost' | 'reply' | 'follow' | 'mention' | 'quote' | 'bot_reply'
  createdAt: string
  readAt: string | null
  actor: AuthorView | null
  post: PostView | null
}

export type SessionView = {
  user: AuthorView & { email: string; isOwner: boolean }
  csrfToken: string
}

export type ApiError = { error: { message: string; fields?: { path: string; message: string }[] } }
