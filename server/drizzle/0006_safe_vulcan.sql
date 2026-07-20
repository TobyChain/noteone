CREATE TYPE "public"."report_depth" AS ENUM('brief', 'deep', 'action');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('generating', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_style" AS ENUM('minimal', 'academic', 'dashboard', 'handwritten');--> statement-breakpoint
CREATE TABLE "daily_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"style" "report_style" DEFAULT 'minimal' NOT NULL,
	"depth" "report_depth" DEFAULT 'brief' NOT NULL,
	"status" "report_status" DEFAULT 'generating' NOT NULL,
	"html_content" text,
	"source_note_ids" jsonb DEFAULT '[]'::jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"cron_expression" text NOT NULL,
	"action" text NOT NULL,
	"action_params" jsonb DEFAULT '{}'::jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "tool_calls" jsonb;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "tool_call_id" text;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_reports_user_id_idx" ON "daily_reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "daily_reports_date_idx" ON "daily_reports" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reports_user_date_uniq" ON "daily_reports" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "scheduled_tasks_user_id_idx" ON "scheduled_tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scheduled_tasks_enabled_idx" ON "scheduled_tasks" USING btree ("enabled");