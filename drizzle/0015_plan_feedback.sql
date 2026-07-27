CREATE TABLE IF NOT EXISTS "plan_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"attribution_accuracy" integer NOT NULL,
	"tool_usability" integer NOT NULL,
	"script_naturalness" integer NOT NULL,
	"action_difficulty" integer NOT NULL,
	"review_usefulness" integer NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note_enc" text,
	"data_classification" varchar(30) DEFAULT 'sensitive' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_feedback" ADD CONSTRAINT "plan_feedback_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_feedback" ADD CONSTRAINT "plan_feedback_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_feedback" ADD CONSTRAINT "plan_feedback_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_feedback_plan_idx" ON "plan_feedback" USING btree ("plan_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_feedback_owner_idx" ON "plan_feedback" USING btree ("owner_user_id","created_at");
