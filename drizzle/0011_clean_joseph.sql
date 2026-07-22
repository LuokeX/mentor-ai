CREATE TABLE "department_members" (
	"department_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"member_role" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"parent_id" uuid,
	"leader_user_id" uuid,
	"name" varchar(120) NOT NULL,
	"code" varchar(80),
	"type" varchar(30) DEFAULT 'other' NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_leader_user_id_users_id_fk" FOREIGN KEY ("leader_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_member_uidx" ON "department_members" USING btree ("department_id","user_id");--> statement-breakpoint
CREATE INDEX "department_members_user_idx" ON "department_members" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE INDEX "departments_school_status_idx" ON "departments" USING btree ("school_id","status");--> statement-breakpoint
CREATE INDEX "departments_parent_idx" ON "departments" USING btree ("school_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_school_code_uidx" ON "departments" USING btree ("school_id","code");--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classes_department_idx" ON "classes" USING btree ("school_id","department_id");