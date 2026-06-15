ALTER TYPE "public"."note_status" ADD VALUE 'trashed';--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "deleted_at" timestamp;