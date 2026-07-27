ALTER TABLE "plans" ADD COLUMN "acceptance_decision" varchar(30);
ALTER TABLE "plans" ADD COLUMN "acceptance_reason_enc" text;
ALTER TABLE "plans" ADD COLUMN "accepted_at" timestamp with time zone;
ALTER TABLE "plans" ADD COLUMN "matched_rule_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "plans" ADD COLUMN "matched_tool_codes" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "plans" ADD COLUMN "source_resource_version_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE "plan_actions" ADD COLUMN "started_at" timestamp with time zone;
ALTER TABLE "plan_actions" ADD COLUMN "blocked_at" timestamp with time zone;
ALTER TABLE "plan_actions" ADD COLUMN "block_reason" varchar(40);
ALTER TABLE "plan_actions" ADD COLUMN "block_note_enc" text;
ALTER TABLE "plan_actions" ADD COLUMN "evidence_type" varchar(40) DEFAULT 'none' NOT NULL;
ALTER TABLE "plan_actions" ADD COLUMN "evidence_summary_enc" text;
ALTER TABLE "plan_actions" ADD COLUMN "teacher_confidence" integer;

ALTER TABLE "plan_reviews" ADD COLUMN "decision" varchar(40) DEFAULT 'continue_plan' NOT NULL;

ALTER TABLE "plan_feedback" ADD COLUMN "action_id" uuid;
ALTER TABLE "plan_feedback" ADD COLUMN "module" varchar(40);
ALTER TABLE "plan_feedback" ADD COLUMN "rule_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "plan_feedback" ADD COLUMN "tool_codes" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "plan_feedback" ADD COLUMN "source_resource_version_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;

CREATE TABLE "plan_operation_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "action_id" uuid,
  "owner_user_id" uuid NOT NULL,
  "event_type" varchar(60) NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "plan_feedback" ADD CONSTRAINT "plan_feedback_action_id_plan_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "plan_actions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "plan_operation_events" ADD CONSTRAINT "plan_operation_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "plan_operation_events" ADD CONSTRAINT "plan_operation_events_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "plan_operation_events" ADD CONSTRAINT "plan_operation_events_action_id_plan_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "plan_actions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "plan_operation_events" ADD CONSTRAINT "plan_operation_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "plan_feedback_module_idx" ON "plan_feedback" USING btree ("school_id","module","created_at");
CREATE INDEX "plan_operation_events_school_type_idx" ON "plan_operation_events" USING btree ("school_id","event_type","created_at");
CREATE INDEX "plan_operation_events_plan_idx" ON "plan_operation_events" USING btree ("plan_id","created_at");
