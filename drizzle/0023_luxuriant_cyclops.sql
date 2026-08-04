ALTER TABLE "classes" ADD COLUMN "section" varchar(20);--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "class_type" varchar(30) DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "deputy_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "location" varchar(200);--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "school_year" varchar(30);--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "notes_enc" text;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "energy_stage" varchar(40);--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "class_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "short_name" varchar(40);--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "scope" varchar(40) DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "leader_title" varchar(80);--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "location" varchar(200);--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "phone" varchar(40);--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "headcount_limit" integer;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "occupation" varchar(80);--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "work_unit" varchar(200);--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "contact_enc" text;--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "notes_enc" text;--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "comm_risk_level" varchar(40);--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "guardian_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD COLUMN "relation" varchar(40);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "birth_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "student_no_enc" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "student_no_search" varchar(64);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ethnicity" varchar(40);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "enrolled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "boarding_type" varchar(20);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "address_enc" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "case_level" varchar(40);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "learning_level" varchar(40);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "student_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "employee_no" varchar(80);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gender" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "teaching_grades" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subject" varchar(80);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_class_teacher" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "title" varchar(40);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cert_note" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notes_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "self_status_level" varchar(40);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "self_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_deputy_owner_user_id_users_id_fk" FOREIGN KEY ("deputy_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_school_employee_no_uidx" ON "users" USING btree ("school_id","employee_no");