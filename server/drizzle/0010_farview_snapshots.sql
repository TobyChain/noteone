CREATE TABLE IF NOT EXISTS "farview_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_through" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_message" text,
	CONSTRAINT "farview_snapshots_week_start_unique" UNIQUE("week_start")
);
--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN IF NOT EXISTS "first_seen_date" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "farview_snapshots_week_start_idx" ON "farview_snapshots" USING btree ("week_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "papers_first_seen_idx" ON "papers" USING btree ("first_seen_date");
