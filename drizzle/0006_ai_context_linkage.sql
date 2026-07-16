ALTER TABLE "chat_sessions" ADD COLUMN "context_type" varchar(30) DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "context_id" uuid;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "student_id" uuid;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "class_id" uuid;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "guardian_id" uuid;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "source_chat_session_id" uuid;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "source_assessment_attempt_id" uuid;
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_source_chat_session_id_chat_sessions_id_fk" FOREIGN KEY ("source_chat_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_source_assessment_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("source_assessment_attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "chat_sessions_context_idx" ON "chat_sessions" USING btree ("context_type","context_id");
--> statement-breakpoint
CREATE INDEX "plans_student_idx" ON "plans" USING btree ("student_id");
--> statement-breakpoint
CREATE INDEX "plans_class_idx" ON "plans" USING btree ("class_id");
--> statement-breakpoint
CREATE INDEX "plans_guardian_idx" ON "plans" USING btree ("guardian_id");
--> statement-breakpoint
CREATE INDEX "plans_source_chat_idx" ON "plans" USING btree ("source_chat_session_id");
--> statement-breakpoint
