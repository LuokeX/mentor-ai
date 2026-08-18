CREATE TABLE "plan_action_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "kind" varchar(20) NOT NULL,
  "filename" varchar(180) NOT NULL,
  "mime_type" varchar(80) NOT NULL,
  "byte_size" integer NOT NULL,
  "checksum" varchar(64) NOT NULL,
  "content_enc" text,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_action_evidence" ADD CONSTRAINT "plan_action_evidence_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plan_action_evidence" ADD CONSTRAINT "plan_action_evidence_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plan_action_evidence" ADD CONSTRAINT "plan_action_evidence_action_id_plan_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."plan_actions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plan_action_evidence" ADD CONSTRAINT "plan_action_evidence_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "plan_action_evidence_action_idx" ON "plan_action_evidence" ("action_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "plan_action_evidence_owner_idx" ON "plan_action_evidence" ("owner_user_id", "created_at");
