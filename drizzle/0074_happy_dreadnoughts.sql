ALTER TABLE "students" ADD COLUMN "id_card_enc" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "id_card_search" varchar(64);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "extra_enc" text;--> statement-breakpoint
CREATE INDEX "students_school_id_card_idx" ON "students" USING btree ("school_id","id_card_search");