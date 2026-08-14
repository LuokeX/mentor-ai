DROP INDEX "invitations_school_email_idx";--> statement-breakpoint
DROP INDEX "users_email_uidx";--> statement-breakpoint
-- 邀请手机号回填：优先取关联用户登录手机号；无关联的 pending 邀请置空串占位，由管理员重发（见 backfill-phone 报告）
UPDATE "invitations" SET "phone" = "users"."phone" FROM "users" WHERE "invitations"."user_id" = "users"."id" AND "invitations"."phone" IS NULL;--> statement-breakpoint
UPDATE "invitations" SET "phone" = '' WHERE "phone" IS NULL;--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "phone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "email";