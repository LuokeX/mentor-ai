CREATE TABLE "assessment_session_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_session_id" uuid NOT NULL,
	"assessment_attempt_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_session_attempts_assessment_attempt_id_unique" UNIQUE("assessment_attempt_id")
);
--> statement-breakpoint
CREATE TABLE "assessment_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"module" varchar(40) NOT NULL,
	"source_type" varchar(30) NOT NULL,
	"source_chat_session_id" uuid,
	"context_type" varchar(30) DEFAULT 'none' NOT NULL,
	"context_id" uuid,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_assessment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"assessment_attempt_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_assessment_attempts_assessment_attempt_id_unique" UNIQUE("assessment_attempt_id")
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "source_type" varchar(30);--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "source_question_summary" varchar(200);--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "title_full" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "attribution_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "instrument_snapshots" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_session_attempts" ADD CONSTRAINT "assessment_session_attempts_assessment_session_id_assessment_sessions_id_fk" FOREIGN KEY ("assessment_session_id") REFERENCES "public"."assessment_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_session_attempts" ADD CONSTRAINT "assessment_session_attempts_assessment_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("assessment_attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_source_chat_session_id_chat_sessions_id_fk" FOREIGN KEY ("source_chat_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assessment_attempts" ADD CONSTRAINT "plan_assessment_attempts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assessment_attempts" ADD CONSTRAINT "plan_assessment_attempts_assessment_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("assessment_attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_session_attempts_seq_uidx" ON "assessment_session_attempts" USING btree ("assessment_session_id","sequence");--> statement-breakpoint
CREATE INDEX "assessment_session_attempts_attempt_idx" ON "assessment_session_attempts" USING btree ("assessment_attempt_id");--> statement-breakpoint
CREATE INDEX "assessment_sessions_owner_module_idx" ON "assessment_sessions" USING btree ("owner_user_id","module");--> statement-breakpoint
CREATE INDEX "assessment_sessions_source_chat_idx" ON "assessment_sessions" USING btree ("source_chat_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_assessment_attempts_seq_uidx" ON "plan_assessment_attempts" USING btree ("plan_id","sequence");--> statement-breakpoint
CREATE INDEX "plan_assessment_attempts_attempt_idx" ON "plan_assessment_attempts" USING btree ("assessment_attempt_id");--> statement-breakpoint
-- 历史数据回填：来源类型按是否来自对话判定；旧方案的单量表关系与量表快照一并补齐，
-- 保证详情页多量表展示对既有方案同样生效。
UPDATE "plans" SET "source_type" = CASE
  WHEN "source_chat_session_id" IS NOT NULL THEN 'assistant_dialogue'
  ELSE 'direct_assessment'
END WHERE "source_type" IS NULL;--> statement-breakpoint
INSERT INTO "plan_assessment_attempts" ("plan_id", "assessment_attempt_id", "sequence")
SELECT "id", "source_assessment_attempt_id", 0
FROM "plans"
WHERE "source_assessment_attempt_id" IS NOT NULL
ON CONFLICT ("assessment_attempt_id") DO NOTHING;--> statement-breakpoint
UPDATE "plans" SET "instrument_snapshots" = jsonb_build_array(
  jsonb_build_object(
    'code', a."assessment_code",
    'name', a."assessment_code",
    'version', a."definition_version",
    'sequence', 0
  )
)
FROM "assessment_attempts" a
WHERE a."id" = "plans"."source_assessment_attempt_id"
  AND jsonb_array_length("plans"."instrument_snapshots") = 0;