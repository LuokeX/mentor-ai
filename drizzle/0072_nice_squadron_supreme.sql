DROP INDEX "user_roles_user_role_uidx";--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "kind" varchar(20) DEFAULT 'school' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_school_id" uuid;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "school_id" uuid;--> statement-breakpoint
UPDATE "user_roles" ur
SET "school_id" = u."school_id"
FROM "users" u
WHERE ur."user_id" = u."id" AND ur."school_id" IS NULL;--> statement-breakpoint
INSERT INTO "schools" ("id", "name", "code", "kind", "status")
SELECT gen_random_uuid(), '班主任智能体 C 端', 'cend', 'cend', 'active'
WHERE NOT EXISTS (SELECT 1 FROM "schools" WHERE "code" = 'cend');--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_school_id_schools_id_fk" FOREIGN KEY ("active_school_id") REFERENCES "public"."schools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schools_kind_idx" ON "schools" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "sessions_active_school_idx" ON "sessions" USING btree ("active_school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_user_school_role_uidx" ON "user_roles" USING btree ("user_id","school_id","role_code");--> statement-breakpoint
CREATE INDEX "user_roles_school_role_idx" ON "user_roles" USING btree ("school_id","role_code");