ALTER TABLE "chat_messages" ADD COLUMN "question_category" varchar(40);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "question_category_source" varchar(20);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "question_category_confidence" integer;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "channel" varchar(20);--> statement-breakpoint
CREATE INDEX "chat_messages_school_category_idx" ON "chat_messages" USING btree ("school_id","question_category","created_at");
INSERT INTO "roles" ("code", "name", "description", "is_system", "permissions") VALUES ('division_principal', '学部校长', '学部校长：只读数据驾驶舱（本学部聚合看板），不参与统一管理框架', true, '{"records":{"class":[],"student":[],"guardian":[],"communication":[],"guardian_communication":[],"student_event":[],"class_event":[],"student_case":[],"department":[],"user":[],"school":[],"referral":[],"audit":[],"import":[],"plan_operation":[],"access_request":[],"assessment":[],"plan":[],"conversation":[]},"pages":{"class":[],"student":[],"guardian":[],"communication":[],"guardian_communication":[],"student_event":[],"class_event":[],"student_case":[],"department":[],"user":[],"school":[],"referral":[],"audit":[],"import":[],"plan_operation":[],"access_request":[],"assessment":[],"plan":[],"conversation":[]}}'::jsonb) ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
UPDATE "student_events" SET "event_type" = CASE "event_type"
	WHEN '违纪' THEN '行为规范类'
	WHEN '冲突' THEN '课堂秩序类'
	WHEN '异常行为' THEN '身心健康类'
	WHEN '学业波动' THEN '学业纪律类'
	ELSE "event_type" END
WHERE "event_type" IN ('违纪', '冲突', '异常行为', '学业波动');
