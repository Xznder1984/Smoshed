import { and, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../../db/client.js'
import { newId } from '../crypto.js'
import { cleanBody, extractMentions, trimToLength } from '../sanitize.js'
import { getBotConfig, type BotConfig } from './config.js'
import { complete, ProviderError } from './providers.js'
import { rateCheck, rateConsume } from './limits.js'

/** Post id of the built-in @smosh account, fixed at seed time. */
export const SMOSH_POST_AUTHOR_ID = 'smosh-bot'

/** Structural guard against the bot replying in circles. */
export type LoopCheck = { allowed: boolean; reason?: string }

export function isBotAccountId(authorId: string): boolean {
  return authorId === SMOSH_POST_AUTHOR_ID
}

/**
 * Decides whether the bot may reply to a given post.
 *
 * Four independent conditions, each of which must pass:
 *  1. the trigger post is not the bot's own
 *  2. the thread has not already hit the configured depth
 *  3. no ancestor in the chain is the bot
 *  4. the user who triggered it has not blocked the bot
 */
export async function checkLoop(
  db: ReturnType<typeof getDb>,
  input: {
    triggerPostId: string
    triggerAuthorId: string
    config: BotConfig
  },
): Promise<LoopCheck> {
  const { triggerPostId, triggerAuthorId, config } = input

  if (!config.enabled) return { allowed: false, reason: 'bot disabled' }

  // 1. The bot never answers itself.
  if (isBotAccountId(triggerAuthorId)) {
    return { allowed: false, reason: 'trigger is from the bot' }
  }

  const trigger = (
    await db
      .select({
        id: schema.posts.id,
        authorId: schema.posts.authorId,
        replyToId: schema.posts.replyToId,
        isBotReply: schema.posts.isBotReply,
        depth: schema.posts.depth,
      })
      .from(schema.posts)
      .where(eq(schema.posts.id, triggerPostId))
      .limit(1)
  )[0]
  if (!trigger) return { allowed: false, reason: 'trigger post missing' }
  if (trigger.isBotReply || isBotAccountId(trigger.authorId)) {
    return { allowed: false, reason: 'trigger is a bot reply' }
  }

  // 4. A user who blocked the bot cannot trigger it.
  const blocked = await db
    .select({ one: sql<number>`1` })
    .from(schema.blocks)
    .where(
      and(
        eq(schema.blocks.blockerId, triggerAuthorId),
        eq(schema.blocks.blockedId, SMOSH_POST_AUTHOR_ID),
      ),
    )
    .limit(1)
  if (blocked.length > 0) return { allowed: false, reason: 'user blocked the bot' }

  // 2 and 3. Walk the ancestor chain once.
  let cursor: string | null = trigger.replyToId
  let depth = 0
  let sawBot = false
  const visited = new Set<string>([trigger.id])

  while (cursor && depth < 20) {
    if (visited.has(cursor)) return { allowed: false, reason: 'cycle in reply chain' }
    visited.add(cursor)

    const parent = (
      await db
        .select({
          id: schema.posts.id,
          authorId: schema.posts.authorId,
          replyToId: schema.posts.replyToId,
          isBotReply: schema.posts.isBotReply,
          depth: schema.posts.depth,
        })
        .from(schema.posts)
        .where(eq(schema.posts.id, cursor))
        .limit(1)
    )[0]
    if (!parent) break

    if (parent.isBotReply || isBotAccountId(parent.authorId)) {
      sawBot = true
      break
    }
    cursor = parent.replyToId
    depth += 1
  }

  // One bot reply per chain, and never deeper than the configured limit.
  if (sawBot) return { allowed: false, reason: 'bot already replied in this thread' }
  if (trigger.depth >= config.maxDepth) {
    return { allowed: false, reason: 'thread depth limit reached' }
  }
  if (depth > 20) return { allowed: false, reason: 'reply chain too long' }

  return { allowed: true }
}

/** Rate budget check: per user, per hour, and the two global caps. */
export async function checkLimits(
  triggerAuthorId: string,
  config: BotConfig,
): Promise<LoopCheck> {
  const result = await rateCheck({
    userId: triggerAuthorId,
    perUserHourlyLimit: config.perUserHourlyLimit,
    globalHourlyLimit: config.globalHourlyLimit,
    globalDailyLimit: config.globalDailyLimit,
  })
  return result.allowed ? { allowed: true } : { allowed: false, reason: result.reason }
}

/** Queues a job. Unique on postId, so a post can only ever queue one job. */
export async function enqueueBotJob(
  db: ReturnType<typeof getDb>,
  input: { postId: string; requestedById: string },
): Promise<void> {
  await db
    .insert(schema.botJobs)
    .values({ id: newId(), postId: input.postId, requestedById: input.requestedById })
    .onConflictDoNothing()
}

/** Builds the model input from the tagged post plus a few parents. */
export async function buildContext(
  db: ReturnType<typeof getDb>,
  triggerPostId: string,
): Promise<{ userContent: string; depth: number } | null> {
  const trigger = (
    await db
      .select({
        id: schema.posts.id,
        body: schema.posts.body,
        authorId: schema.posts.authorId,
        replyToId: schema.posts.replyToId,
        depth: schema.posts.depth,
      })
      .from(schema.posts)
      .where(eq(schema.posts.id, triggerPostId))
      .limit(1)
  )[0]
  if (!trigger) return null

  const handle = (
    await db
      .select({ handle: schema.users.handle })
      .from(schema.users)
      .where(eq(schema.users.id, trigger.authorId))
      .limit(1)
  )[0]?.handle

  const chain: { handle: string | null; body: string }[] = []
  let cursor: string | null = trigger.replyToId
  let hops = 0
  while (cursor && hops < 4) {
    const parent = (
      await db
        .select({ id: schema.posts.id, body: schema.posts.body, replyToId: schema.posts.replyToId, authorId: schema.posts.authorId })
        .from(schema.posts)
        .where(eq(schema.posts.id, cursor))
        .limit(1)
    )[0]
    if (!parent) break
    const parentHandle = (
      await db
        .select({ handle: schema.users.handle })
        .from(schema.users)
        .where(eq(schema.users.id, parent.authorId))
        .limit(1)
    )[0]?.handle
    chain.unshift({ handle: parentHandle, body: parent.body })
    cursor = parent.replyToId
    hops += 1
  }

  const lines: string[] = []
  for (const item of chain) {
    lines.push(`@${item.handle ?? 'someone'} wrote: ${item.body}`)
  }
  lines.push(`@${handle ?? 'someone'} replied: ${trigger.body}`)

  const userContent = [
    'Here is a thread on Smoshed. The final line is the post you are replying to.',
    '',
    ...lines,
    '',
    'Write your reply to the final line.',
  ].join('\n')

  return { userContent, depth: trigger.depth }
}

/**
 * Cleans the model's output before it can become a post.
 *
 * Models sometimes wrap replies in quotes or add a signature. Anything that
 * looks like markup is dropped, mentions the bot did not intend to make are
 * removed so it cannot ping people, and the result is trimmed on a word
 * boundary. Blocked words from the owner settings replace the whole reply.
 */
export function sanitizeBotReply(
  raw: string,
  config: BotConfig,
  allowedMentions: Set<string>,
): string | null {
  let text = cleanBody(raw)

  // Strip common wrappers and any code fences the model may have produced.
  text = text
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```$/i, '')
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '')
    .replace(/^(assistant|smosh|ai)\s*[:-]\s*/i, '')
    .trim()

  // Remove any HTML or markdown the model may have emitted. Reply text is
  // rendered as plain text, so this is belt and braces.
  text = text
    .replace(/<[^>]*>/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>|]/g, '')
    .replace(/\r\n?/g, '\n')

  // A reply that pings the bot is dropped outright, not edited. Decided before
  // the mention pass below, because that pass removes every mention the owner
  // did not allow, so afterwards there is nothing left to notice and the guard
  // could never fire. A model that keeps addressing the bot is malfunctioning.
  if (mentionsBot(text)) return null

  // The bot addresses the thread, not other accounts. Drop mentions the model
  // invented, keep only ones the owner explicitly allows.
  text = text.replace(/(^|[^\w@])@([a-z0-9_]{1,30})/gi, (_match, prefix: string, handle: string) => {
    return allowedMentions.has(handle.toLowerCase()) ? `${prefix}@${handle}` : ' '
  })

  // Neutralise bare links so a reply cannot drive traffic somewhere.
  text = text.replace(/\bhttps?:\/\/\S+/gi, '(link removed)')

  text = cleanBody(text)
  if (!text) return null

  // An owner-configured blocked word suppresses the reply entirely.
  const lower = text.toLowerCase()
  for (const word of config.blockedWords) {
    const needle = word.toLowerCase().trim()
    if (needle && lower.includes(needle)) return null
  }

  const trimmed = trimToLength(text)
  if (!trimmed) return null
  if (mentionsBot(trimmed)) return null
  return trimmed
}

function mentionsBot(text: string): boolean {
  return extractMentions(text).includes('smosh')
}

/**
 * Runs one queued job end to end. Returns the created post id, or null when
 * nothing was posted. Every failure path records the reason and posts nothing.
 */
export async function runJob(jobId: string): Promise<{ posted: boolean; postId?: string; reason?: string }> {
  const db = getDb()
  const config = await getBotConfig()

  const job = (
    await db.select().from(schema.botJobs).where(eq(schema.botJobs.id, jobId)).limit(1)
  )[0]
  if (!job) return { posted: false, reason: 'job not found' }

  // Claim the job so two concurrent invocations cannot both process it.
  const claimed = await db
    .update(schema.botJobs)
    .set({ status: 'processing', attempts: sql`${schema.botJobs.attempts} + 1`, updatedAt: new Date() })
    .where(and(eq(schema.botJobs.id, jobId), eq(schema.botJobs.status, 'queued')))
    .returning({ id: schema.botJobs.id })
  if (claimed.length === 0) return { posted: false, reason: 'job already claimed' }

  const fail = async (reason: string) => {
    await db
      .update(schema.botJobs)
      .set({ status: 'failed', error: reason.slice(0, 500), updatedAt: new Date() })
      .where(eq(schema.botJobs.id, jobId))
    return { posted: false, reason }
  }

  const loop = await checkLoop(db, {
    triggerPostId: job.postId,
    triggerAuthorId: job.requestedById,
    config,
  })
  if (!loop.allowed) {
    await db
      .update(schema.botJobs)
      .set({ status: 'skipped', error: loop.reason?.slice(0, 500), updatedAt: new Date() })
      .where(eq(schema.botJobs.id, jobId))
    return { posted: false, reason: loop.reason }
  }

  const limits = await checkLimits(job.requestedById, config)
  if (!limits.allowed) {
    await db
      .update(schema.botJobs)
      .set({ status: 'skipped', error: limits.reason?.slice(0, 500), updatedAt: new Date() })
      .where(eq(schema.botJobs.id, jobId))
    return { posted: false, reason: limits.reason }
  }

  const context = await buildContext(db, job.postId)
  if (!context) return fail('trigger post not found')

  let completion
  try {
    completion = await complete(config, context.userContent)
  } catch (err) {
    const message = err instanceof ProviderError ? err.message : 'provider error'
    return fail(message)
  }

  const allowed = new Set<string>()
  const reply = sanitizeBotReply(completion.text, config, allowed)
  if (!reply) {
    await db
      .update(schema.botJobs)
      .set({ status: 'skipped', error: 'reply empty or blocked', updatedAt: new Date() })
      .where(eq(schema.botJobs.id, jobId))
    return { posted: false, reason: 'reply empty or blocked' }
  }

  const postId = newId()
  await db.insert(schema.posts).values({
    id: postId,
    authorId: SMOSH_POST_AUTHOR_ID,
    body: reply,
    replyToId: job.postId,
    depth: context.depth + 1,
    isBotReply: true,
    createdAt: new Date(),
  })
  await db
    .update(schema.posts)
    .set({ replyCount: sql`${schema.posts.replyCount} + 1` })
    .where(eq(schema.posts.id, job.postId))
  await db.insert(schema.notifications).values({
    id: newId(),
    userId: job.requestedById,
    actorId: SMOSH_POST_AUTHOR_ID,
    type: 'bot_reply',
    postId,
  })
  // Count the call only once a reply actually exists, so a provider failure
  // does not consume the user's allowance.
  await rateConsume(job.requestedById)

  await db
    .update(schema.botJobs)
    .set({ status: 'done', provider: completion.provider, resultPostId: postId, updatedAt: new Date() })
    .where(eq(schema.botJobs.id, jobId))

  return { posted: true, postId }
}
