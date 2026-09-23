ALTER TABLE "feeds" ADD COLUMN "show_thumbnail" boolean;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "show_thumbnail" boolean DEFAULT true NOT NULL;