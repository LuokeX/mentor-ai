CREATE TABLE "record_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"target_type" varchar(40) NOT NULL,
	"target_id" uuid NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid NOT NULL,
	"assigned_by" uuid,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_assignments" ADD CONSTRAINT "record_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_assignments" ADD CONSTRAINT "record_assignments_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_assignments" ADD CONSTRAINT "record_assignments_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_assignments" ADD CONSTRAINT "record_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_assignments_school_created_idx" ON "record_assignments" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE INDEX "record_assignments_target_idx" ON "record_assignments" USING btree ("target_type","target_id","created_at");