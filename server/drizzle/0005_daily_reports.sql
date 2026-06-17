DO $$ BEGIN
 CREATE TYPE "public"."report_style" AS ENUM('minimal', 'academic', 'dashboard', 'handwritten');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "public"."report_depth" AS ENUM('brief', 'deep', 'action');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "public"."report_status" AS ENUM('generating', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "daily_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "date" text NOT NULL,
  "style" "report_style" NOT NULL DEFAULT 'minimal',
  "depth" "report_depth" NOT NULL DEFAULT 'brief',
  "status" "report_status" NOT NULL DEFAULT 'generating',
  "html_content" text,
  "source_note_ids" jsonb DEFAULT '[]',
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "daily_reports_user_id_idx" ON "daily_reports" ("user_id");
CREATE INDEX IF NOT EXISTS "daily_reports_date_idx" ON "daily_reports" ("date");
CREATE UNIQUE INDEX IF NOT EXISTS "daily_reports_user_date_uniq" ON "daily_reports" ("user_id", "date");
