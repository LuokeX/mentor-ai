CREATE TABLE "assistant_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"rating" varchar(20) NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comment_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(40) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"target_type" varchar(40),
	"target_id" uuid,
	"deduplication_key" varchar(180) NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"detail" text NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid,
	"user_id" uuid,
	"event_name" varchar(80) NOT NULL,
	"target_type" varchar(40),
	"target_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"referral_id" uuid NOT NULL,
	"actor_id" uuid,
	"event_type" varchar(40) NOT NULL,
	"from_status" varchar(30),
	"to_status" varchar(30),
	"note_enc" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"import_type" varchar(30) NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"status" varchar(20) NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"created_rows" integer DEFAULT 0 NOT NULL,
	"updated_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"notice_version" varchar(50) NOT NULL,
	"data_mode" varchar(20) NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_model_calls" ADD COLUMN "data_mode" varchar(20);--> statement-breakpoint
ALTER TABLE "ai_model_calls" ADD COLUMN "context_type" varchar(30);--> statement-breakpoint
ALTER TABLE "ai_model_calls" ADD COLUMN "notice_version" varchar(50);--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "external_code" varchar(80);--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "external_ref_enc" text;--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "external_ref_search" varchar(64);--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "pending_password_hash" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "pending_totp_secret_enc" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "pending_recovery_code_hashes" jsonb;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "next_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "priority" varchar(20) DEFAULT 'urgent' NOT NULL;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "assigned_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "acknowledge_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "escalation_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "closure_reason" varchar(80);--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN "safety_contact_recipients" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN "ai_data_mode" varchar(20) DEFAULT 'redacted' NOT NULL;--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN "ai_approval_reference" text;--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN "ai_notice_version" varchar(50) DEFAULT 'pilot-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN "ai_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN "ai_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN "referral_ack_minutes" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN "referral_escalation_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "external_ref_enc" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "external_ref_search" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assistant_feedback" ADD CONSTRAINT "assistant_feedback_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_feedback" ADD CONSTRAINT "assistant_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_feedback" ADD CONSTRAINT "assistant_feedback_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_feedback" ADD CONSTRAINT "assistant_feedback_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_actions" ADD CONSTRAINT "plan_actions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_actions" ADD CONSTRAINT "plan_actions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_actions" ADD CONSTRAINT "plan_actions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_imports" ADD CONSTRAINT "school_imports_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_imports" ADD CONSTRAINT "school_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_feedback_user_message_uidx" ON "assistant_feedback" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_recovery_code_hash_uidx" ON "mfa_recovery_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "mfa_recovery_user_idx" ON "mfa_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uidx" ON "notifications" USING btree ("deduplication_key");--> statement-breakpoint
CREATE INDEX "notifications_user_read_created_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_actions_plan_sequence_uidx" ON "plan_actions" USING btree ("plan_id","sequence");--> statement-breakpoint
CREATE INDEX "plan_actions_owner_due_idx" ON "plan_actions" USING btree ("owner_user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "product_events_school_name_created_idx" ON "product_events" USING btree ("school_id","event_name","created_at");--> statement-breakpoint
CREATE INDEX "referral_events_referral_created_idx" ON "referral_events" USING btree ("referral_id","created_at");--> statement-breakpoint
CREATE INDEX "school_imports_school_created_idx" ON "school_imports" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_consents_user_notice_mode_uidx" ON "user_consents" USING btree ("user_id","notice_version","data_mode");--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_settings" ADD CONSTRAINT "school_settings_ai_approved_by_users_id_fk" FOREIGN KEY ("ai_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "classes_school_external_code_uidx" ON "classes" USING btree ("school_id","external_code");--> statement-breakpoint
CREATE UNIQUE INDEX "guardians_school_external_ref_uidx" ON "guardians" USING btree ("school_id","external_ref_search");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uidx" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_school_email_idx" ON "invitations" USING btree ("school_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "students_school_external_ref_uidx" ON "students" USING btree ("school_id","external_ref_search");