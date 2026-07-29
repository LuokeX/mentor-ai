-- Phase 0 Security Migration: add lifecycle fields, composite indexes, restrict cascade deletes
-- This migration is a trimmed version that only contains incremental ALTER/CREATE INDEX changes.
-- CREATE TABLE statements for pre-existing tables (module_resource_* tables, plan_feedback, plan_operation_events)
-- have been removed since those tables already exist in the database (created via drizzle-kit push).

-- ========== ALTER TABLE: add lifecycle fields ==========

ALTER TABLE "classes" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
ALTER TABLE "classes" ADD COLUMN IF NOT EXISTS "archived_by" uuid;

ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'active' NOT NULL;
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "archived_by" uuid;

ALTER TABLE "guardians" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
ALTER TABLE "guardians" ADD COLUMN IF NOT EXISTS "archived_by" uuid;

ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "archived_by" uuid;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "disabled_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "disabled_by" uuid;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "disabled_reason" text;

-- 既有关系先按学生所属学校回填，再收紧 NOT NULL，避免非空数据库迁移失败。
ALTER TABLE "student_guardians" ADD COLUMN IF NOT EXISTS "school_id" uuid;
UPDATE "student_guardians" AS sg
SET "school_id" = s."school_id"
FROM "students" AS s
WHERE s."id" = sg."student_id" AND sg."school_id" IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "student_guardians" WHERE "school_id" IS NULL) THEN
    RAISE EXCEPTION 'student_guardians.school_id backfill failed';
  END IF;
END $$;
ALTER TABLE "student_guardians" ALTER COLUMN "school_id" SET NOT NULL;
ALTER TABLE "student_guardians" ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'active' NOT NULL;

-- ========== ALTER TABLE: modify FK constraints (cascade → restrict) ==========

ALTER TABLE "chat_messages" DROP CONSTRAINT IF EXISTS "chat_messages_session_id_chat_sessions_id_fk";
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "plan_actions" DROP CONSTRAINT IF EXISTS "plan_actions_plan_id_plans_id_fk";
ALTER TABLE "plan_actions" ADD CONSTRAINT "plan_actions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "plan_reviews" DROP CONSTRAINT IF EXISTS "plan_reviews_plan_id_plans_id_fk";
ALTER TABLE "plan_reviews" ADD CONSTRAINT "plan_reviews_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_guardians" DROP CONSTRAINT IF EXISTS "student_guardians_student_id_students_id_fk";
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_guardians" DROP CONSTRAINT IF EXISTS "student_guardians_guardian_id_guardians_id_fk";
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE restrict ON UPDATE no action;

-- ========== ALTER TABLE: add new FKs for archive/disable references ==========

ALTER TABLE "classes" DROP CONSTRAINT IF EXISTS "classes_archived_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "communications" DROP CONSTRAINT IF EXISTS "communications_archived_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "guardians" DROP CONSTRAINT IF EXISTS "guardians_archived_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "students_archived_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_disabled_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_disabled_by_users_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "student_guardians" DROP CONSTRAINT IF EXISTS "student_guardians_school_id_schools_id_fk";--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

-- ========== CREATE INDEX: composite performance indexes ==========

CREATE INDEX IF NOT EXISTS "classes_school_owner_status_updated_idx" ON "classes" USING btree ("school_id","owner_user_id","status","updated_at");
CREATE INDEX IF NOT EXISTS "communications_school_owner_status_updated_idx" ON "communications" USING btree ("school_id","owner_user_id","status","updated_at");
CREATE INDEX IF NOT EXISTS "guardians_school_owner_status_updated_idx" ON "guardians" USING btree ("school_id","owner_user_id","status","updated_at");
CREATE INDEX IF NOT EXISTS "students_school_owner_status_updated_idx" ON "students" USING btree ("school_id","owner_user_id","status","updated_at");
CREATE INDEX IF NOT EXISTS "users_school_role_status_idx" ON "users" USING btree ("school_id","role","status");
CREATE INDEX IF NOT EXISTS "student_guardians_school_idx" ON "student_guardians" USING btree ("school_id");
