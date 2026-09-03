ALTER TABLE "guardians" ADD COLUMN "id_card_enc" text;--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "id_card_search" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "guardians_school_id_card_uidx" ON "guardians" USING btree ("school_id","id_card_search");