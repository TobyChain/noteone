CREATE TABLE "wechat_sessions" (
	"auth_key" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"cookies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nickname" text,
	"avatar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "wechat_sessions_expires_at_idx" ON "wechat_sessions" USING btree ("expires_at");