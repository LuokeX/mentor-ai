CREATE TABLE "plan_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"review_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effect_score" integer NOT NULL,
	"progress_note" text NOT NULL,
	"next_action" text NOT NULL,
	"data_classification" varchar(30) DEFAULT 'highly_sensitive' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "report" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_reviews" ADD CONSTRAINT "plan_reviews_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_reviews" ADD CONSTRAINT "plan_reviews_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_reviews" ADD CONSTRAINT "plan_reviews_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_reviews_plan_created_idx" ON "plan_reviews" USING btree ("plan_id","created_at");--> statement-breakpoint
CREATE INDEX "plan_reviews_owner_idx" ON "plan_reviews" USING btree ("owner_user_id","review_at");