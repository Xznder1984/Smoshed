/**
 * Loop-prevention and reply-sanitising tests for the Smosh AI bot.
 *
 * The bot answers posts. If it can answer its own answers, or a thread can keep
 * waking it, one mention becomes an unbounded loop that bills an API key until
 * a human notices. `checkLoop` is the only thing standing between a mention and
 * that loop, so each of its four conditions is proven here, plus the
 * sanitiser that decides what the model is allowed to publish.
 *
 * These call the real functions against the real database rather than going
 * through HTTP, because the interesting cases are thread shapes that are
 * awkward to build through the API and awkward to fake. No provider is called:
 * a loop that was going to loop is refused before the model is ever asked.
 *
 * Excluded from `npm test` because it needs DATABASE_URL and writes rows. Run it
 * with `npm run test:e2e`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { loadLocalEnv } from '../../scripts/load-env.js'

loadLocalEnv()

const missing = ['DATABASE_URL'].filter((name) => !process.env[name])
const describeOrSkip = missing.length > 0 ? describe.skip : describe

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)
  .toString(36)
  .padStart(3, '0')}`

describeOrSkip('bot loop prevention', () => {
  let checkLoop: typeof import('../../server/lib/bot/queue.js').checkLoop
  let DEFAULT_BOT_CONFIG: typeof import('../../server/lib/bot/config.js').DEFAULT_BOT_CONFIG
  let SMOSH_POST_AUTHOR_ID: string
  let getDb: typeof import('../../server/db/client.js').getDb
  let schema: typeof import('../../server/db/client.js').schema
  let db: ReturnType<typeof getDb>

  /** A real human author, so a trigger is not the bot answering itself. */
  let humanId = ''
  /** Every post this file inserts, so cleanup can find the bot's rows too. */
  const insertedPostIds: string[] = []

  const config = () => ({ ...DEFAULT_BOT_CONFIG })

  /** Inserts a post with an explicit shape, bypassing the API's own guards. */
  async function makePost(input: {
    id: string
    authorId: string
    body: string
    replyToId?: string | null
    depth?: number
    isBotReply?: boolean
  }): Promise<string> {
    await db.insert(schema.posts).values({
      id: input.id,
      authorId: input.authorId,
      body: input.body,
      replyToId: input.replyToId ?? null,
      depth: input.depth ?? 0,
      isBotReply: input.isBotReply ?? false,
      createdAt: new Date(),
    })
    insertedPostIds.push(input.id)
    return input.id
  }

  const postId = (name: string) => `botloop-${name}-${stamp}`.slice(0, 60)

  beforeAll(async () => {
    if (missing.length > 0) return
    const dbModule = await import('../../server/db/client.js')
    const queue = await import('../../server/lib/bot/queue.js')
    const configModule = await import('../../server/lib/bot/config.js')
    getDb = dbModule.getDb
    schema = dbModule.schema
    checkLoop = queue.checkLoop
    SMOSH_POST_AUTHOR_ID = queue.SMOSH_POST_AUTHOR_ID
    DEFAULT_BOT_CONFIG = configModule.DEFAULT_BOT_CONFIG
    db = getDb()

    // A throwaway author. Blocked relationships and chain shapes need real ids.
    // The password is a real Argon2id hash of a value nobody keeps, rather than
    // a placeholder string, so the fixture is indistinguishable from a real row.
    humanId = `botloop-human-${stamp}`.slice(0, 60)
    const { hashPassword, randomToken } = await import('../../server/lib/crypto.js')
    await db.insert(schema.users).values({
      id: humanId,
      handle: `botloop${stamp}`.slice(0, 20),
      displayName: 'Loop Tester',
      avatarSeed: 'botloop',
      email: `botloop-${stamp}@example.invalid`,
      passwordHash: await hashPassword(randomToken(24)),
      createdAt: new Date(),
    })
  })

  afterAll(async () => {
    if (missing.length > 0) return
    // Posts the bot "wrote" hang off no account we own, so they are removed by
    // id rather than relying on an account cascade.
    if (insertedPostIds.length > 0) {
      await db.delete(schema.posts).where(inArray(schema.posts.id, insertedPostIds))
    }
    await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, humanId))
    await db.delete(schema.users).where(eq(schema.users.id, humanId))
  })

  it('lets the bot answer a human post in a clean thread', async () => {
    const id = await makePost({ id: postId('clean'), authorId: humanId, body: 'hello bot' })
    const result = await checkLoop(db, { triggerPostId: id, triggerAuthorId: humanId, config: config() })
    expect(result).toEqual({ allowed: true })
  })

  it('refuses when the bot is switched off', async () => {
    const id = await makePost({ id: postId('off'), authorId: humanId, body: 'are you there' })
    const result = await checkLoop(db, {
      triggerPostId: id,
      triggerAuthorId: humanId,
      config: { ...config(), enabled: false },
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('bot disabled')
  })

  it('refuses a job the bot itself requested', async () => {
    // The requesting author is the bot, whatever the post looks like. This is
    // the guard that stops the bot queueing itself.
    const id = await makePost({ id: postId('self'), authorId: humanId, body: 'a human post' })
    const result = await checkLoop(db, {
      triggerPostId: id,
      triggerAuthorId: SMOSH_POST_AUTHOR_ID,
      config: config(),
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('trigger is from the bot')
  })

  it('refuses a post the bot wrote, even when a human requested it', async () => {
    const id = await makePost({
      id: postId('selfpost'),
      authorId: SMOSH_POST_AUTHOR_ID,
      body: 'my own words',
    })
    const result = await checkLoop(db, { triggerPostId: id, triggerAuthorId: humanId, config: config() })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('trigger is a bot reply')
  })

  it('refuses a post flagged as a bot reply', async () => {
    const id = await makePost({
      id: postId('flagged'),
      authorId: humanId,
      body: 'written by a human but flagged',
      isBotReply: true,
    })
    const result = await checkLoop(db, { triggerPostId: id, triggerAuthorId: humanId, config: config() })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('trigger is a bot reply')
  })

  it('refuses a trigger post that does not exist', async () => {
    const result = await checkLoop(db, {
      triggerPostId: postId('missing'),
      triggerAuthorId: humanId,
      config: config(),
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('trigger post missing')
  })

  it('refuses a user who blocked the bot', async () => {
    await db.insert(schema.blocks).values({
      blockerId: humanId,
      blockedId: SMOSH_POST_AUTHOR_ID,
      createdAt: new Date(),
    })
    const id = await makePost({ id: postId('blocked'), authorId: humanId, body: 'you are blocked' })
    const result = await checkLoop(db, { triggerPostId: id, triggerAuthorId: humanId, config: config() })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('user blocked the bot')

    await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, humanId))
  })

  it('refuses when the bot already replied further up the thread', async () => {
    // human root -> bot reply -> human reply. The last human post mentions the
    // bot again, which is exactly the ping-pong that must not continue.
    const root = await makePost({ id: postId('root'), authorId: humanId, body: 'root' })
    const botReply = await makePost({
      id: postId('botmid'),
      authorId: SMOSH_POST_AUTHOR_ID,
      body: 'the bot answered',
      replyToId: root,
      depth: 1,
      isBotReply: true,
    })
    const trigger = await makePost({
      id: postId('afterbot'),
      authorId: humanId,
      body: 'and again @smosh',
      replyToId: botReply,
      depth: 2,
    })

    const result = await checkLoop(db, { triggerPostId: trigger, triggerAuthorId: humanId, config: config() })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('bot already replied in this thread')
  })

  it('refuses a thread deeper than the configured limit', async () => {
    const root = await makePost({ id: postId('deep-root'), authorId: humanId, body: 'root' })
    const trigger = await makePost({
      id: postId('deep-trigger'),
      authorId: humanId,
      body: 'far down',
      replyToId: root,
      depth: 9,
    })

    const result = await checkLoop(db, {
      triggerPostId: trigger,
      triggerAuthorId: humanId,
      config: { ...config(), maxDepth: 3 },
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('thread depth limit reached')
  })

  it('survives a reply chain that loops back on itself', async () => {
    // Two posts pointing at each other cannot exist through the API, but a
    // corrupt row or a future migration could produce one. The walk must
    // terminate rather than spin.
    const a = postId('cycle-a')
    const b = postId('cycle-b')
    await db.insert(schema.posts).values({
      id: a,
      authorId: humanId,
      body: 'a',
      replyToId: b,
      depth: 0,
      createdAt: new Date(),
    })
    await db.insert(schema.posts).values({
      id: b,
      authorId: humanId,
      body: 'b',
      replyToId: a,
      depth: 1,
      createdAt: new Date(),
    })
    insertedPostIds.push(a, b)

    const trigger = await makePost({
      id: postId('cycle-trigger'),
      authorId: humanId,
      body: 'in the cycle',
      replyToId: a,
      depth: 2,
    })

    const result = await checkLoop(db, { triggerPostId: trigger, triggerAuthorId: humanId, config: config() })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('cycle in reply chain')
  })
})

describeOrSkip('bot reply sanitising', () => {
  let sanitizeBotReply: typeof import('../../server/lib/bot/queue.js').sanitizeBotReply
  let DEFAULT_BOT_CONFIG: typeof import('../../server/lib/bot/config.js').DEFAULT_BOT_CONFIG

  beforeAll(async () => {
    if (missing.length > 0) return
    sanitizeBotReply = (await import('../../server/lib/bot/queue.js')).sanitizeBotReply
    DEFAULT_BOT_CONFIG = (await import('../../server/lib/bot/config.js')).DEFAULT_BOT_CONFIG
  })

  const clean = (raw: string, blockedWords: string[] = [], allowed = new Set<string>()) =>
    sanitizeBotReply(raw, { ...DEFAULT_BOT_CONFIG, blockedWords }, allowed)

  it('strips code fences and assistant prefixes', () => {
    expect(clean('```\nplain answer\n```')).toBe('plain answer')
    expect(clean('Smosh: here you go')).toBe('here you go')
  })

  it('removes markup so a reply can only ever be plain text', () => {
    const out = clean('**bold** <script>alert(1)</script> and [link](x)')
    expect(out).not.toContain('<')
    expect(out).not.toContain('*')
  })

  it('neutralises links so a reply cannot drive traffic', () => {
    expect(clean('see https://evil.example/x now')).toContain('(link removed)')
  })

  it('keeps only the mentions the owner allowed', () => {
    const out = clean('hi @someone and @friend', [], new Set(['friend']))
    expect(out).toContain('@friend')
    expect(out).not.toContain('@someone')
  })

  it('drops the whole reply when it contains a blocked word', () => {
    expect(clean('this contains forbidden', ['forbidden'])).toBeNull()
  })

  it('drops a reply that pings the bot again', () => {
    expect(clean('hello @smosh')).toBeNull()
  })

  it('drops a reply that is empty once cleaned', () => {
    expect(clean('```\n\n```')).toBeNull()
    expect(clean('   ')).toBeNull()
  })
})
