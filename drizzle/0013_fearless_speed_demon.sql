CREATE TABLE "student_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"event_type" varchar(30) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"occurred_at" timestamp with time zone,
	"resolution" text,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"data_classification" varchar(30) DEFAULT 'highly_sensitive' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_events" ADD CONSTRAINT "student_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "student_events" ADD CONSTRAINT "student_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "student_events" ADD CONSTRAINT "student_events_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "student_events_student_idx" ON "student_events" USING btree ("student_id");
--> statement-breakpoint
CREATE INDEX "student_events_owner_idx" ON "student_events" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX "student_events_school_idx" ON "student_events" USING btree ("school_id","occurred_at");