ALTER TABLE "plan_actions" ADD COLUMN "decision" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_actions" ADD COLUMN "decision_reason" varchar(40);--> statement-breakpoint
ALTER TABLE "plan_actions" ADD COLUMN "decision_note_enc" text;--> statement-breakpoint
ALTER TABLE "plan_actions" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
UPDATE "plan_actions" AS pa
SET "decision" = 'included',
    "decided_at" = COALESCE(p."accepted_at", p."updated_at")
FROM "plans" AS p
WHERE pa."plan_id" = p."id"
  AND (
    p."accepted_at" IS NOT NULL
    OR p."status" IN ('accepted', 'in_progress', 'review_due', 'completed', 'closed')
  );--> statement-breakpoint
CREATE INDEX "plan_actions_plan_decision_idx" ON "plan_actions" USING btree ("plan_id","decision");
