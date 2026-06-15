-- Convert all timestamp columns from `timestamp without time zone` to `timestamptz`.
--
-- Existing rows were written by now() into naive columns while BOTH the DB session and
-- the Node process ran in Asia/Shanghai, so the stored wall-clock is Shanghai local time.
-- postgres-js currently reads those naive values by interpreting them as the process-local
-- zone (also Asia/Shanghai), which is why the app shows correct times today — but only by
-- coincidence of matching zones. The explicit `USING "col" AT TIME ZONE 'Asia/Shanghai'`
-- reinterprets each naive value with that exact same zone, so the absolute instants are
-- preserved 1:1 (no visible change now) while making future reads/writes zone-independent.
--
-- NOTE: if this app's history was ever written under a different DB/Node zone, adjust the
-- zone below to whatever was in effect when those rows were created.
ALTER TABLE "chat_messages" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'Asia/Shanghai';--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "chat_sessions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'Asia/Shanghai';--> statement-breakpoint
ALTER TABLE "chat_sessions" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "chat_sessions" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'Asia/Shanghai';--> statement-breakpoint
ALTER TABLE "chat_sessions" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "deleted_at" SET DATA TYPE timestamp with time zone USING "deleted_at" AT TIME ZONE 'Asia/Shanghai';--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'Asia/Shanghai';--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'Asia/Shanghai';--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "tags" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'Asia/Shanghai';--> statement-breakpoint
ALTER TABLE "tags" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'Asia/Shanghai';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'Asia/Shanghai';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DEFAULT now();
