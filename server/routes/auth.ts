import { Hono } from 'hono'
import type { FieldError } from '../lib/respond.js'
import { fail, readJson } from '../lib/respond.js'
import { canDeliverMail, deliver } from '../lib/mailer.js'
import { and, eq, or, isNull, desc, sql, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db/client.js'
import {
  HttpError,
  assertCsrf,
  assertSameOrigin,
  isOwner,
  loadSession,
  markReauthenticated,
  requireUser,
  rotateSession,
  createSession,
  destroySession,
} from '../lib/auth.js'
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  keyedTokenHash,
  newId,
  randomToken,
  verifyPassword,
} from '../lib/crypto.js'
import {
  bioSchema,
  displayNameSchema,
  emailSchema,
  handleSchema,
  passwordSchema,
} from '../lib/sanitize.js'
import {
  clearFailures,
  clientIp,
  enforce,
  lockoutRemaining,
  registerFailure,
} from '../lib/rate-limit.js'
import { authorCounts, toAuthorBase } from '../lib/views.js'
import { env } from '../lib/env.js'
import { authorizeUrl, exchangeCode, isOAuthConfigured, OAuthError } from '../lib/oauth.js'

/**
 * The password field used to *confirm an identity*, as opposed to choosing a
 * new one.
 *
 * These endpoints must not apply the sign-up policy. A password that predates a
 * policy change, or was simply mistyped, is not invalid input: holding it to the
 * strength rules would answer "check the highlighted fields" instead of "that
 * password is not correct", and would return before the Argon2 comparison runs,
 * so the response would leak the policy class of the stored password and the
 * attempt would never count towards the lockout. Every attempt pays the same
 * hashing cost either way.
 */
const existingPasswordSchema = z.string().min(1).max(200)

const credentialsSchema = z.object({
  email: emailSchema,
  password: existingPasswordSchema,
})

const signupSchema = credentialsSchema.extend({
  handle: handleSchema,
  displayName: displayNameSchema,
})

/** Re-authentication: the password alone, since the session identifies the account. */
const reauthSchema = z.object({
  password: existingPasswordSchema,
})

const changePasswordSchema = z.object({
  currentPassword: existingPasswordSchema,
  newPassword: passwordSchema,
})


function fieldsFrom(error: z.ZodError): FieldError[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
}

async function uniqueHandle(db: ReturnType<typeof getDb>, base: string): Promise<string> {
  const clean = base.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
  if (!clean) return `user_${randomToken(4)}`
  let handle = clean
  let n = 1
  while (true) {
    const existing = (
      await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.handle, handle)).limit(1)
    )[0]
    if (!existing) return handle
    n += 1
    handle = `${clean.slice(0, 18)}_${n}`
  }
}

export function authRoutes() {
  const app = new Hono()

  /** Current session, used by the client to decide what to render. */
  app.get('/session', async (c) => {
    const user = await loadSession(c)
    if (!user) return c.json({ user: null })
    return c.json({ user: await sessionUser(user) })
  })

  app.post('/signup', async (c) => {
    assertSameOrigin(c)
    await enforce(c, 'signup', `ip:${clientIp(c)}`)
    const parsed = signupSchema.safeParse(await readJson(c))
    if (!parsed.success) {
      return fail(c, 422, 'Check the highlighted fields.', fieldsFrom(parsed.error))
    }
    const { email, password, handle, displayName } = parsed.data
    const db = getDb()

    const emailTaken = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email}`)
      .limit(1)
    if (emailTaken.length > 0) {
      return fail(c, 409, 'That email is already registered.', [
        { path: 'email', message: 'That email is already registered.' },
      ])
    }

    const handleTaken = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.handle}) = ${handle}`)
      .limit(1)
    if (handleTaken.length > 0) {
      return fail(c, 409, 'That handle is taken.', [
        { path: 'handle', message: 'That handle is taken.' },
      ])
    }

    const user = {
      id: newId(),
      email,
      handle,
      displayName,
      bio: '',
      avatarSeed: randomToken(8),
      passwordHash: await hashPassword(password),
      isBot: false,
      isAdmin: false,
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await db.insert(schema.users).values(user)
    await createSession(c, user.id, { userAgent: c.req.header('user-agent') ?? '' })
    return c.json({ user: await sessionUser(user) }, 201)
  })

  app.post('/login', async (c) => {
    assertSameOrigin(c)
    const ip = clientIp(c)
    const parsed = credentialsSchema.safeParse(await readJson(c))
    if (!parsed.success) {
      return fail(c, 422, 'Enter your email and password.')
    }
    const { email, password } = parsed.data
    const db = getDb()

    const locked = await lockoutRemaining('ip', ip)
    if (locked > 0) {
      c.header('Retry-After', String(locked))
      return fail(c, 429, `Too many attempts. Try again in ${locked} seconds.`)
    }
    await enforce(c, 'login', `ip:${ip}`)

    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1)
    const user = rows[0]

    // Always run a verification so a missing account and a wrong password take
    // a comparable amount of time.
    const ok = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password)

    if (!user || !ok) {
      const result = await registerFailure('ip', ip)
      if (result.locked) {
        c.header('Retry-After', String(result.retryAfter))
        return fail(c, 429, 'Too many attempts. Try again shortly.')
      }
      return fail(c, 401, 'Your email or password is wrong.')
    }

    await clearFailures('ip', ip)
    // Rotate the session id on sign-in so a pre-auth id cannot be fixated.
    await rotateSession(c, user.id)
    return c.json({ user: await sessionUser(user) })
  })

  app.post('/logout', async (c) => {
    await assertCsrf(c)
    await destroySession(c)
    return c.json({ ok: true })
  })

  /**
   * Always answers the same way, so this endpoint cannot be used to find out
   * which email addresses have accounts.
   *
   * A reset link is only created when a mail provider is configured. With no
   * provider the request is accepted and silently dropped: returning a link in
   * the response, or logging it, would put a working account takeover in the
   * browser history or the server logs.
   */
  app.post('/password-reset/request', async (c) => {
    assertSameOrigin(c)
    await enforce(c, 'passwordReset', `ip:${clientIp(c)}`)
    const parsed = z.object({ email: emailSchema }).safeParse(await readJson(c))
    if (!parsed.success) {
      return fail(c, 422, 'Enter a valid email address.')
    }

    if (canDeliverMail()) {
      const db = getDb()
      const rows = await db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.email, parsed.data.email))
        .limit(1)

      if (rows[0]) {
        const token = randomToken(32)
        await db.insert(schema.passwordResetTokens).values({
          id: newId(),
          userId: rows[0].id,
          tokenHash: keyedTokenHash(token, env.sessionSecret),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        })
        const sent = await deliver({
          to: rows[0].email,
          subject: 'Reset your Smoshed password',
          text: [
            'Someone asked to reset the password for this Smoshed account.',
            '',
            `Open this link within the next hour to choose a new password:`,
            `${env.appUrl}/reset-password?token=${encodeURIComponent(token)}`,
            '',
            'If this was not you, no action is needed and the link will expire on its own.',
          ].join('\n'),
        })

        if (!sent.delivered) {
          // The row exists but nobody can use it, so drop it immediately.
          await db.delete(schema.passwordResetTokens).where(
            eq(schema.passwordResetTokens.tokenHash, keyedTokenHash(token, env.sessionSecret)),
          )
        }
      }
    }

    return c.json({ ok: true })
  })

  app.post('/password-reset/confirm', async (c) => {
    assertSameOrigin(c)
    await enforce(c, 'passwordReset', `ip:${clientIp(c)}`)
    const parsed = z
      .object({ token: z.string().min(10), password: passwordSchema })
      .safeParse(await readJson(c))
    if (!parsed.success) {
      return fail(c, 422, 'That reset link is not valid.')
    }
    const db = getDb()
    const tokenHash = keyedTokenHash(parsed.data.token, env.sessionSecret)

    const rows = await db
      .select()
      .from(schema.passwordResetTokens)
      .where(
        and(
          eq(schema.passwordResetTokens.tokenHash, tokenHash),
          isNull(schema.passwordResetTokens.usedAt),
        ),
      )
      .limit(1)
    const record = rows[0]
    if (!record || record.expiresAt.getTime() < Date.now()) {
      return fail(c, 400, 'That reset link has expired. Request a new one.')
    }

    await db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(parsed.data.password), updatedAt: new Date() })
      .where(eq(schema.users.id, record.userId))
    await db
      .update(schema.passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.passwordResetTokens.id, record.id))
    // A password change signs every device out.
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, record.userId))
    return c.json({ ok: true })
  })

  /**
   * Password re-entry, required before sensitive changes.
   *
   * Only the password is accepted. The account comes from the session, so a
   * client cannot re-authenticate as a different account by sending a
   * different email address.
   */
  app.post('/reauth', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    await enforce(c, 'login', `user:${user.id}`)
    const parsed = reauthSchema.safeParse(await readJson(c))
    if (!parsed.success) return fail(c, 422, 'Enter your password.')

    const rows = await dbSelectUserById(user.id)
    if (!rows) return fail(c, 404, 'Account not found.')
    const ok = await verifyPassword(rows.passwordHash, parsed.data.password)
    if (!ok) return fail(c, 401, 'That password is not correct.')

    // Fresh session on re-auth, so the pre-auth id cannot be reused afterwards.
    await rotateSession(c, user.id)
    await markReauthenticated(c)
    return c.json({ ok: true, reauthenticatedAt: Date.now() })
  })

  /**
   * Password change.
   *
   * The current password must be re-entered. Every other session is destroyed
   * on success, so a stolen session cannot survive the change, and the current
   * session gets a new id.
   */
  app.post('/change-password', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    await enforce(c, 'login', `user:${user.id}`)
    const parsed = changePasswordSchema.safeParse(await readJson(c))
    if (!parsed.success) {
      return fail(c, 422, 'Check the new password.', fieldsFrom(parsed.error))
    }

    const db = getDb()
    const rows = await db
      .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1)
    if (!rows[0]) return fail(c, 404, 'Account not found.')

    const ok = await verifyPassword(rows[0].passwordHash, parsed.data.currentPassword)
    if (!ok) return fail(c, 401, 'That current password is not correct.')

    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return fail(c, 422, 'Choose a password you have not just used.')
    }

    await db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(parsed.data.newPassword), updatedAt: new Date() })
      .where(eq(schema.users.id, user.id))

    // A new id for this session, and every other session is invalidated.
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id))
    await rotateSession(c, user.id)

    return c.json({ ok: true })
  })

  /** Profile edits. isBot and isAdmin are never writable from here. */
  app.patch('/profile', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    const parsed = z
      .object({
        displayName: displayNameSchema.optional(),
        bio: bioSchema.optional(),
        handle: handleSchema.optional(),
      })
      .safeParse(await readJson(c))
    if (!parsed.success) {
      return fail(c, 422, 'Check the highlighted fields.', fieldsFrom(parsed.error))
    }
    const db = getDb()
    const { displayName, bio, handle } = parsed.data

    if (handle) {
      const taken = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(sql`lower(${schema.users.handle}) = ${handle}`, sql`${schema.users.id} <> ${user.id}`))
        .limit(1)
      if (taken.length > 0) {
        return fail(c, 409, 'That handle is taken.', [
          { path: 'handle', message: 'That handle is taken.' },
        ])
      }
    }

    await db
      .update(schema.users)
      .set({
        ...(displayName !== undefined ? { displayName } : {}),
        ...(bio !== undefined ? { bio } : {}),
        ...(handle !== undefined ? { handle } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, user.id))

    const updated = await dbSelectUserById(user.id)
    if (!updated) return fail(c, 404, 'Account not found.')
    return c.json({ user: await sessionUser(updated) })
  })

  /** Everything the app stores about the signed-in account. */
  app.get('/export', async (c) => {
    const user = requireUser(c)
    const db = getDb()
    const me = await dbSelectUserById(user.id)
    if (!me) return fail(c, 404, 'Account not found.')

    const [myPosts, myLikes, myReposts, myBookmarks, myFollows, myFollowers, myNotifications] =
      await Promise.all([
        db.select().from(schema.posts).where(eq(schema.posts.authorId, user.id)),
        db.select().from(schema.likes).where(eq(schema.likes.userId, user.id)),
        db.select().from(schema.reposts).where(eq(schema.reposts.userId, user.id)),
        db.select().from(schema.bookmarks).where(eq(schema.bookmarks.userId, user.id)),
        db.select().from(schema.follows).where(eq(schema.follows.followerId, user.id)),
        db.select().from(schema.follows).where(eq(schema.follows.followingId, user.id)),
        db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id)),
      ])

    return c.json({
      exportedAt: new Date().toISOString(),
      account: {
        id: me.id,
        email: me.email,
        handle: me.handle,
        displayName: me.displayName,
        bio: me.bio,
        createdAt: me.createdAt,
      },
      posts: myPosts,
      likes: myLikes,
      reposts: myReposts,
      bookmarks: myBookmarks,
      following: myFollows,
      followers: myFollowers,
      notifications: myNotifications,
    })
  })

  /**
   * Deletes the account and everything attached to it. Cascades remove posts,
   * likes, follows, notifications, sessions, bookmarks and bot jobs.
   *
   * The password must be re-entered, so a hijacked session cannot delete an
   * account even with a valid CSRF token. Only the password is accepted, since
   * the session already identifies the account.
   */
  app.delete('/account', async (c) => {
    const user = requireUser(c)
    await assertCsrf(c)
    const db = getDb()
    const me = await dbSelectUserById(user.id)
    if (!me) return fail(c, 404, 'Account not found.')
    if (me.isBot) return fail(c, 400, 'The Smosh AI account cannot be deleted.')

    const parsed = reauthSchema.safeParse(await readJson(c))
    if (!parsed.success) return fail(c, 422, 'Enter your password to confirm.')
    const ok = await verifyPassword(me.passwordHash, parsed.data.password)
    if (!ok) return fail(c, 401, 'That password is not correct.')

    await db.delete(schema.users).where(eq(schema.users.id, user.id))
    await destroySession(c)
    return c.json({ ok: true })
  })

  // --- OAuth: Google & Discord ---

  for (const provider of ['google', 'discord'] as const) {
    app.get(`/${provider}`, async (c) => {
      if (!isOAuthConfigured(provider)) {
        return fail(c, 503, `${provider} sign-in is not configured.`)
      }
      const state = randomToken(32)
      c.header('Set-Cookie', `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`)
      return c.redirect(authorizeUrl(provider, state))
    })

    app.get(`/${provider}/callback`, async (c) => {
      const state = c.req.query('state')
      const cookieState = c.req.header('cookie')?.match(/oauth_state=([^;]+)/)?.[1]
      if (!state || !cookieState || state !== cookieState) {
        return fail(c, 400, 'Invalid OAuth state.')
      }
      const code = c.req.query('code')
      if (!code) return fail(c, 400, 'Missing authorization code.')

      let profile
      try {
        profile = await exchangeCode(provider, code)
      } catch (err) {
        if (err instanceof OAuthError) return fail(c, 400, err.message)
        return fail(c, 500, 'OAuth sign-in failed.')
      }

      const db = getDb()
      const email = profile.email.toLowerCase()

      // Find existing user by email or by OAuth identity
      let user = (
        await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1)
      )[0]

      if (!user) {
        // Check if this OAuth identity already has an account under a different email
        const existingOAuth = (
          await db
            .select({ userId: schema.oauthAccounts.userId })
            .from(schema.oauthAccounts)
            .where(
              and(
                eq(schema.oauthAccounts.provider, provider),
                eq(schema.oauthAccounts.providerId, profile.providerId),
              ),
            )
            .limit(1)
        )[0]
        if (existingOAuth) {
          user = (
            await db.select().from(schema.users).where(eq(schema.users.id, existingOAuth.userId)).limit(1)
          )[0]
        }
      }

      if (!user) {
        // Create new account
        const handle = profile.displayName
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '')
          .slice(0, 20) || `user_${randomToken(4)}`
        const generatedHandle = await uniqueHandle(db, handle)
        user = {
          id: newId(),
          email,
          handle: generatedHandle,
          displayName: profile.displayName.slice(0, 50),
          bio: '',
          avatarSeed: randomToken(8),
          passwordHash: '',
          isBot: false,
          isAdmin: false,
          emailVerifiedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        await db.insert(schema.users).values(user)
      }

      // Link OAuth identity if not already linked
      await db
        .insert(schema.oauthAccounts)
        .values({ id: newId(), userId: user.id, provider, providerId: profile.providerId })
        .onConflictDoNothing()

      await createSession(c, user.id, { userAgent: c.req.header('user-agent') ?? '' })
      c.header('Set-Cookie', 'oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
      return c.redirect('/')
    })
  }

  // --- Email magic link ---

  app.post('/magic-link', async (c) => {
    assertSameOrigin(c)
    await enforce(c, 'magicLink', `ip:${clientIp(c)}`)
    const parsed = z.object({ email: emailSchema }).safeParse(await readJson(c))
    if (!parsed.success) {
      return fail(c, 422, 'Enter a valid email address.')
    }
    if (!canDeliverMail()) {
      return fail(c, 503, 'Email sign-in is not configured.')
    }

    const db = getDb()
    const email = parsed.data.email.toLowerCase()
    const user = (await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1))[0]

    if (user) {
      const token = randomToken(32)
      await db.insert(schema.magicLinkTokens).values({
        id: newId(),
        userId: user.id,
        tokenHash: keyedTokenHash(token, env.sessionSecret),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      })
      await deliver({
        to: user.email,
        subject: 'Your Smoshed sign-in link',
        text: [
          'Open this link to sign in to Smoshed:',
          `${env.appUrl}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
          '',
          'This link expires in 15 minutes.',
        ].join('\n'),
      })
    }

    return c.json({ ok: true })
  })

  app.get('/magic-link/verify', async (c) => {
    const token = c.req.query('token')
    if (!token) return fail(c, 400, 'Missing token.')

    const db = getDb()
    const tokenHash = keyedTokenHash(token, env.sessionSecret)
    const rows = await db
      .select()
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.tokenHash, tokenHash))
      .limit(1)
    const record = rows[0]
    if (!record || record.expiresAt.getTime() < Date.now()) {
      return fail(c, 400, 'That link has expired. Request a new one.')
    }

    // Consume the token before creating the session, so a replayed link fails.
    await db.delete(schema.magicLinkTokens).where(eq(schema.magicLinkTokens.id, record.id))
    await createSession(c, record.userId, { userAgent: c.req.header('user-agent') ?? '' })
    return c.redirect('/')
  })

  return app
}


async function dbSelectUserById(id: string) {
  const db = getDb()
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1)
  return rows[0] ?? null
}

async function sessionUser(user: {
  id: string
  email: string
  handle: string
  displayName: string
  bio: string
  avatarSeed: string
  isBot: boolean
  isAdmin: boolean
  createdAt: Date
}) {
  const db = getDb()
  return {
    ...toAuthorBase(user),
    email: user.email,
    isOwner: isOwner(user),
    counts: await authorCounts(db, user.id),
  }
}

export { HttpError, desc, or, inArray }
