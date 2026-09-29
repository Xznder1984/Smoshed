-- Add a server-side record of when the account password was last confirmed.
-- Sensitive changes (saving bot settings, deleting an account) require this
-- value to be within the last 10 minutes.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "reauthenticated_at" timestamp with time zone;
--> statement-breakpoint
-- Seed the built-in @smosh account. Bot posts reference this id through
-- posts.author_id, so the row must exist before the bot can post anything.
--
-- The password hash is a real Argon2id digest of a random value that was
-- discarded immediately, so it can never match any input. The .invalid TLD
-- guarantees the address can never receive mail.
INSERT INTO "users" (
  "id",
  "email",
  "handle",
  "display_name",
  "bio",
  "avatar_seed",
  "password_hash",
  "is_bot",
  "is_admin",
  "email_verified_at"
)
VALUES (
  'smosh-bot',
  'bot@smoshed.invalid',
  'smosh',
  'Smosh',
  'The Smoshed bot. Mention me and I will say something.',
  'smosh',
  '$argon2id$v=19$m=19456,t=2,p=1$9NVrSFvmvBKv/7jDmO9Uyg$AAYJk5D8MCRO+Gwb9rFlMMnYJ6ojBuJIQ1WD6VBkb/k',
  true,
  true,
  now()
)
ON CONFLICT ("id") DO NOTHING;
