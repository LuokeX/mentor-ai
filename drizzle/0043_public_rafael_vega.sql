DROP TABLE "mfa_recovery_codes" CASCADE;--> statement-breakpoint
ALTER TABLE "invitations" DROP COLUMN "pending_totp_secret_enc";--> statement-breakpoint
ALTER TABLE "invitations" DROP COLUMN "pending_recovery_code_hashes";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "totp_secret_enc";