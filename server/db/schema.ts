import { relations, sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm'
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/** Postgres full-text search vector. Generated, never written by hand. */
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

export const notificationType = pgEnum('notification_type', [
  'like',
  'repost',
  'reply',
  'follow',
  'mention',
  'quote',
  'bot_reply',
])
export const reportStatus = pgEnum('report_status', ['open', 'reviewing', 'resolved', 'dismissed'])
export const reportReason = pgEnum('report_reason', [
  'spam',
  'harassment',
  'hate',
  'violence',
  'self_harm',
  'sexual',
  'misinformation',
  'other',
])
export const jobStatus = pgEnum('job_status', ['queued', 'processing', 'done', 'failed', 'skipped'])

/** Accounts. `isBot` marks the built-in @smosh account. Never user-editable. */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    handle: text('handle').notNull(),
    displayName: text('display_name').notNull(),
    bio: text('bio').notNull().default(''),
    /** Deterministic gradient seed used to render the generated avatar. */
    avatarSeed: text('avatar_seed').notNull(),
    passwordHash: text('password_hash').notNull(),
    isBot: boolean('is_bot').notNull().default(false),
    isAdmin: boolean('is_admin').notNull().default(false),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(sql`lower(${t.email})`),
    uniqueIndex('users_handle_key').on(sql`lower(${t.handle})`),
    index('users_created_at_idx').on(t.createdAt),
  ],
)

/** Server-side sessions. Only a hash of the cookie value is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** HMAC of the CSRF token. Compared against the double-submit cookie. */
    csrfHash: text('csrf_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the account password was last confirmed. Required before saving bot settings. */
    reauthenticatedAt: timestamp('reauthenticated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent').notNull().default(''),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
)

/** Single-use password reset tokens. Only a hash is stored. */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [index('prt_token_hash_idx').on(t.tokenHash), index('prt_user_id_idx').on(t.userId)],
)

/** OAuth account links. One row per (provider, providerId) pair. */
export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerId: text('provider_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('oauth_provider_key').on(t.provider, t.providerId)],
)

/** Single-use email magic link tokens. Only a hash is stored. */
export const magicLinkTokens = pgTable(
  'magic_link_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('mlt_token_hash_idx').on(t.tokenHash), index('mlt_user_id_idx').on(t.userId)],
)

/** Posts, replies and quote posts share one table, like the original model. */
export const posts = pgTable(
  'posts',
  {
    id: text('id').primaryKey(),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    /** Set when this post is a reply. */
    replyToId: text('reply_to_id'),
    /** Set when this post quotes another post. */
    quoteOfId: text('quote_of_id'),
    /** Depth in the reply chain, 0 for a root post. Caps bot reply depth. */
    depth: integer('depth').notNull().default(0),
    /** Set when a post was created in reply to a Smosh AI reply. */
    isBotReply: boolean('is_bot_reply').notNull().default(false),
    replyCount: integer('reply_count').notNull().default(0),
    repostCount: integer('repost_count').notNull().default(0),
    likeCount: integer('like_count').notNull().default(0),
    quoteCount: integer('quote_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Raw column reference: `body` is not in scope inside this literal.
    search: tsvector('search').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(body, ''))`,
    ),
  },
  (t) => [
    index('posts_author_created_idx').on(t.authorId, t.createdAt.desc()),
    index('posts_created_at_idx').on(t.createdAt.desc()),
    index('posts_reply_to_idx').on(t.replyToId),
    index('posts_quote_of_idx').on(t.quoteOfId),
    index('posts_search_idx').using('gin', t.search),
  ],
)

export const postRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  replyTo: one(posts, { fields: [posts.replyToId], references: [posts.id], relationName: 'reply' }),
  replies: many(posts, { relationName: 'reply' }),
  quoteOf: one(posts, { fields: [posts.quoteOfId], references: [posts.id], relationName: 'quote' }),
  likes: many(likes),
  reposts: many(reposts),
  bookmarks: many(bookmarks),
}))

export const likes = pgTable(
  'likes',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    index('likes_post_id_idx').on(t.postId),
  ],
)

export const reposts = pgTable(
  'reposts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    index('reposts_post_id_idx').on(t.postId),
    index('reposts_user_created_idx').on(t.userId, t.createdAt.desc()),
  ],
)

export const bookmarks = pgTable(
  'bookmarks',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    index('bookmarks_user_created_idx').on(t.userId, t.createdAt.desc()),
  ],
)

export const follows = pgTable(
  'follows',
  {
    followerId: text('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followingId: text('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followingId] }),
    index('follows_following_idx').on(t.followingId),
  ],
)

export const blocks = pgTable(
  'blocks',
  {
    blockerId: text('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: text('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index('blocks_blocked_idx').on(t.blockedId),
  ],
)

export const mutes = pgTable(
  'mutes',
  {
    muterId: text('muter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mutedId: text('muted_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.muterId, t.mutedId] }),
    index('mutes_muted_idx').on(t.mutedId),
  ],
)

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    /** Recipient. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Who caused it. Null is reserved for system events. */
    actorId: text('actor_id').references(() => users.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    postId: text('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('notifications_user_unread_idx').on(t.userId, t.readAt),
  ],
)

/** Moderation queue. Readable by the owner from the moderation table. */
export const reports = pgTable(
  'reports',
  {
    id: text('id').primaryKey(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetUserId: text('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    targetPostId: text('target_post_id').references(() => posts.id, { onDelete: 'set null' }),
    reason: reportReason('reason').notNull(),
    details: text('details').notNull().default(''),
    status: reportStatus('status').notNull().default('open'),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('reports_status_created_idx').on(t.status, t.createdAt.desc()),
    index('reports_target_user_idx').on(t.targetUserId),
  ],
)

/**
 * Smosh AI configuration. Single row (id = 1) seeded with safe defaults by
 * migration 0001 so the bot works out of the box.
 */
export const botSettings = pgTable('bot_settings', {
  id: integer('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  /** JSON array of provider ids, tried left to right. */
  providerOrder: jsonb('provider_order').notNull().default(['groq', 'nvidia', 'ollama']),
  models: jsonb('models').notNull().default({
    groq: 'llama-3.3-70b-versatile',
    nvidia: 'nvidia/nemotron-3-super-120b-a12b',
    ollama: 'llama3.3',
  }),
  systemPrompt: text('system_prompt').notNull(),
  temperature: integer('temperature').notNull().default(1),
  maxTokens: integer('max_tokens').notNull().default(300),
  /** Bot replies per user per hour. */
  perUserHourlyLimit: integer('per_user_hourly_limit').notNull().default(5),
  /** Bot replies per hour across the whole site. */
  globalHourlyLimit: integer('global_hourly_limit').notNull().default(200),
  /** Bot replies per day across the whole site. */
  globalDailyLimit: integer('global_daily_limit').notNull().default(2000),
  /** Max consecutive bot replies in one thread. */
  maxDepth: integer('max_depth').notNull().default(2),
  blockedWords: jsonb('blocked_words').notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
})

/** Every bot settings change, with no secret values ever recorded. */
export const botSettingsAudit = pgTable(
  'bot_settings_audit',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    changes: jsonb('changes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bot_settings_audit_created_idx').on(t.createdAt.desc())],
)

/** Job queue. A mention enqueues one row; the worker picks it up. */
export const botJobs = pgTable(
  'bot_jobs',
  {
    id: text('id').primaryKey(),
    /** The post that mentioned @smosh. Unique, so a post enqueues once. */
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    requestedById: text('requested_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: jobStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    /** Failure reason. Never contains provider keys or user text. */
    error: text('error'),
    provider: text('provider'),
    resultPostId: text('result_post_id').references(() => posts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('bot_jobs_post_id_key').on(t.postId),
    index('bot_jobs_status_created_idx').on(t.status, t.createdAt),
  ],
)

/**
 * Fixed-window counters. Stateless Vercel functions share this table instead of
 * an in-process map or a paid Redis.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    scope: text('scope').notNull(),
    bucket: text('bucket').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.bucket] }),
    index('rate_limits_expires_at_idx').on(t.expiresAt),
  ],
)

/** Login lockout state, tracked separately so backoff can grow. */
/**
 * Login lockout state, tracked separately so backoff can grow.
 *
 * `scope` is a keyed hash of the account or address being attempted, so there is
 * exactly one row per identity. That uniqueness is not cosmetic: the upsert in
 * `registerFailure` uses `ON CONFLICT (scope) DO UPDATE`, which Postgres rejects
 * outright unless the column carries a unique constraint. With only a plain
 * index there, every failed sign-in raised a query error and answered 500
 * instead of counting the failure.
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    failedCount: integer('failed_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('login_attempts_scope_key').on(t.scope)],
)

export const userRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  sessions: many(sessions),
  notifications: many(notifications),
  following: many(follows, { relationName: 'follower' }),
  followers: many(follows, { relationName: 'following' }),
}))

export const followRelations = relations(follows, ({ one }) => ({
  follower: one(users, { fields: [follows.followerId], references: [users.id], relationName: 'follower' }),
  following: one(users, { fields: [follows.followingId], references: [users.id], relationName: 'following' }),
}))

export const notificationRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, { fields: [notifications.userId], references: [users.id], relationName: 'recipient' }),
  actor: one(users, { fields: [notifications.actorId], references: [users.id], relationName: 'actor' }),
  post: one(posts, { fields: [notifications.postId], references: [posts.id] }),
}))

export const reportRelations = relations(reports, ({ one }) => ({
  reporter: one(users, { fields: [reports.reporterId], references: [users.id], relationName: 'reporter' }),
  targetUser: one(users, { fields: [reports.targetUserId], references: [users.id], relationName: 'targetUser' }),
  targetPost: one(posts, { fields: [reports.targetPostId], references: [posts.id] }),
}))

export type User = InferSelectModel<typeof users>
export type NewUser = InferInsertModel<typeof users>
export type Post = InferSelectModel<typeof posts>
export type NewPost = InferInsertModel<typeof posts>
export type Session = InferSelectModel<typeof sessions>
export type Notification = InferSelectModel<typeof notifications>
export type Report = InferSelectModel<typeof reports>
export type BotSettings = InferSelectModel<typeof botSettings>
export type BotJob = InferSelectModel<typeof botJobs>
