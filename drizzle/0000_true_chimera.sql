CREATE TYPE "public"."job_status" AS ENUM('queued', 'processing', 'done', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('like', 'repost', 'reply', 'follow', 'mention', 'quote', 'bot_reply');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'harassment', 'hate', 'violence', 'self_harm', 'sexual', 'misinformation', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'reviewing', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"user_id" text NOT NULL,
	"post_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "bot_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"provider" text,
	"result_post_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"provider_order" jsonb DEFAULT '["groq","nvidia","ollama"]'::jsonb NOT NULL,
	"models" jsonb DEFAULT '{"groq":"llama-3.3-70b-versatile","nvidia":"nvidia/nemotron-3-super-120b-a12b","ollama":"llama3.3"}'::jsonb NOT NULL,
	"system_prompt" text NOT NULL,
	"temperature" integer DEFAULT 1 NOT NULL,
	"max_tokens" integer DEFAULT 300 NOT NULL,
	"per_user_hourly_limit" integer DEFAULT 5 NOT NULL,
	"global_hourly_limit" integer DEFAULT 200 NOT NULL,
	"global_daily_limit" integer DEFAULT 2000 NOT NULL,
	"max_depth" integer DEFAULT 2 NOT NULL,
	"blocked_words" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "bot_settings_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" text NOT NULL,
	"following_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_following_id_pk" PRIMARY KEY("follower_id","following_id")
);
--> statement-breakpoint
CREATE TABLE "likes" (
	"user_id" text NOT NULL,
	"post_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "likes_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mutes" (
	"muter_id" text NOT NULL,
	"muted_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutes_muter_id_muted_id_pk" PRIMARY KEY("muter_id","muted_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"actor_id" text,
	"type" "notification_type" NOT NULL,
	"post_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"reply_to_id" text,
	"quote_of_id" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"is_bot_reply" boolean DEFAULT false NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"repost_count" integer DEFAULT 0 NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"quote_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"scope" text NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_scope_bucket_pk" PRIMARY KEY("scope","bucket")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" text NOT NULL,
	"target_user_id" text,
	"target_post_id" text,
	"reason" "report_reason" NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reposts" (
	"user_id" text NOT NULL,
	"post_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reposts_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"csrf_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_seed" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_jobs" ADD CONSTRAINT "bot_jobs_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_jobs" ADD CONSTRAINT "bot_jobs_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_jobs" ADD CONSTRAINT "bot_jobs_result_post_id_posts_id_fk" FOREIGN KEY ("result_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_settings" ADD CONSTRAINT "bot_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_settings_audit" ADD CONSTRAINT "bot_settings_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_users_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_muter_id_users_id_fk" FOREIGN KEY ("muter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_muted_id_users_id_fk" FOREIGN KEY ("muted_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_post_id_posts_id_fk" FOREIGN KEY ("target_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "bookmarks_user_created_idx" ON "bookmarks" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "bot_jobs_post_id_key" ON "bot_jobs" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "bot_jobs_status_created_idx" ON "bot_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "bot_settings_audit_created_idx" ON "bot_settings_audit" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "follows_following_idx" ON "follows" USING btree ("following_id");--> statement-breakpoint
CREATE INDEX "likes_post_id_idx" ON "likes" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "login_attempts_scope_idx" ON "login_attempts" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "mutes_muted_idx" ON "mutes" USING btree ("muted_id");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "prt_token_hash_idx" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "prt_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "posts_author_created_idx" ON "posts" USING btree ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_created_at_idx" ON "posts" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_reply_to_idx" ON "posts" USING btree ("reply_to_id");--> statement-breakpoint
CREATE INDEX "posts_quote_of_idx" ON "posts" USING btree ("quote_of_id");--> statement-breakpoint
CREATE INDEX "posts_search_idx" ON "posts" USING gin ("search");--> statement-breakpoint
CREATE INDEX "rate_limits_expires_at_idx" ON "rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "reports_status_created_idx" ON "reports" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reports_target_user_idx" ON "reports" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "reposts_post_id_idx" ON "reposts" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "reposts_user_created_idx" ON "reposts" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_key" ON "users" USING btree (lower("handle"));--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");