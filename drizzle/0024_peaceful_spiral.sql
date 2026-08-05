ALTER TABLE "module_cases" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "module_cases" CASCADE;--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "case_id";