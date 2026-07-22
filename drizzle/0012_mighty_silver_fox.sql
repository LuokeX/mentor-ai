ALTER TABLE "plan_actions" ADD COLUMN "executed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_actions" ADD COLUMN "execution_note" text;