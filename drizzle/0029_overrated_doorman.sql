ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "oidc_subject" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX "users_oidc_subject_uidx" ON "users" USING btree ("oidc_subject");