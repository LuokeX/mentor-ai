CREATE TABLE "class_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"event_type" varchar(30) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"occurred_at" timestamp with time zone,
	"resolution" text,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"data_classification" varchar(30) DEFAULT 'highly_sensitive' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "case_solution_status" varchar(20) DEFAULT 'unresolved' NOT NULL;--> statement-breakpoint
ALTER TABLE "class_events" ADD CONSTRAINT "class_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_events" ADD CONSTRAINT "class_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_events" ADD CONSTRAINT "class_events_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_events" ADD CONSTRAINT "class_events_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_events_class_idx" ON "class_events" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "class_events_owner_idx" ON "class_events" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "class_events_school_idx" ON "class_events" USING btree ("school_id","occurred_at");