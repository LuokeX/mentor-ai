ALTER TABLE "assessment_attempts" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "archived_previous_status" varchar(30);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "archived_previous_status" varchar(30);--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;