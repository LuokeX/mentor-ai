-- 教师界面文案红线：不得出现「危机 / 红线 / 预警 / 立即 / 110 / 120」字样。
-- 存量通知与短信文案（心理专员、学校管理员、短信接收人）按同口径统一替换。
UPDATE "notifications"
SET "title" = replace(replace(replace(replace("title", '危机', '安全'), '红线', '安全底线'), '预警', '关注提示'), '立即', '尽快')
WHERE "title" ~ '危机|红线|预警|立即';--> statement-breakpoint
UPDATE "notifications"
SET "body" = replace(replace(replace(replace("body", '危机', '安全'), '红线', '安全底线'), '预警', '关注提示'), '立即', '尽快')
WHERE "body" ~ '危机|红线|预警|立即';--> statement-breakpoint
UPDATE "notification_outbox"
SET "payload" = jsonb_set("payload", '{message}', to_jsonb(replace(replace(replace(replace("payload"->>'message', '危机', '安全'), '红线', '安全底线'), '预警', '关注提示'), '立即', '尽快')))
WHERE "payload"->>'message' ~ '危机|红线|预警|立即';
