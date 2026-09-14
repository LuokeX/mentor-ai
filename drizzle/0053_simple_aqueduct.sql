ALTER TABLE "chat_sessions" ADD COLUMN "context_summary_enc" text;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "context_summary_upto_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "context_summary_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "context_summary_tokens" integer;