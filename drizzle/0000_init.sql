CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"ping_role_id" text,
	"ping" boolean DEFAULT true NOT NULL,
	"note" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"source" text NOT NULL,
	"github_repo_id" bigint,
	"channel_id" text NOT NULL,
	"ping_role_id" text,
	"include_prereleases" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"paused_reason" text,
	"baseline_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_repos" (
	"id" bigint PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"owner_avatar_url" text,
	"etag" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_privacy_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" text PRIMARY KEY NOT NULL,
	"default_channel_id" text,
	"default_ping_role_id" text,
	"auto_publish" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"feed_id" uuid,
	"kind" text NOT NULL,
	"release_key" text NOT NULL,
	"note" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"ping_role_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_github_repo_id_github_repos_id_fk" FOREIGN KEY ("github_repo_id") REFERENCES "public"."github_repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drafts_expires" ON "drafts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feeds_guild_repo_channel" ON "feeds" USING btree ("guild_id","github_repo_id","channel_id");--> statement-breakpoint
CREATE INDEX "feeds_github_repo" ON "feeds" USING btree ("github_repo_id");--> statement-breakpoint
CREATE INDEX "feeds_channel" ON "feeds" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "github_repos_next_poll" ON "github_repos" USING btree ("next_poll_at");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_feed_release" ON "posts" USING btree ("feed_id","release_key");--> statement-breakpoint
CREATE INDEX "posts_release_key" ON "posts" USING btree ("release_key");--> statement-breakpoint
CREATE INDEX "posts_message" ON "posts" USING btree ("message_id");