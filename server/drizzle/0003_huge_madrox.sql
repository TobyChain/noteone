ALTER TYPE "public"."note_status" ADD VALUE 'failed';--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_tags_note_tag_uniq" ON "note_tags" USING btree ("note_id","tag_id");--> statement-breakpoint
CREATE INDEX "tags_user_id_idx" ON "tags" USING btree ("user_id");