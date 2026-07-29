DROP INDEX IF EXISTS "department_member_uidx";--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "department_members" ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "student_events" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "student_events" ADD COLUMN IF NOT EXISTS "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "chat_sessions" DROP CONSTRAINT IF EXISTS "chat_sessions_archived_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" DROP CONSTRAINT IF EXISTS "departments_archived_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_events" DROP CONSTRAINT IF EXISTS "student_events_archived_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "student_events" ADD CONSTRAINT "student_events_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "department_member_uidx" ON "department_members" USING btree ("department_id","user_id","status");