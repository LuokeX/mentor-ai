ALTER TABLE "invitations" ALTER COLUMN "phone" SET DATA TYPE varchar(40);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "phone" SET DATA TYPE varchar(40);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
-- phone_enc 在早期迁移已存在，此处仅在缺失时补建（幂等）
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_enc" text;