ALTER TABLE "invitations" ADD COLUMN "phone" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" varchar(20);--> statement-breakpoint
CREATE INDEX "invitations_school_phone_idx" ON "invitations" USING btree ("school_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uidx" ON "users" USING btree ("phone");