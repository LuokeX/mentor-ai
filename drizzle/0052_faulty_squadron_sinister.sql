ALTER TABLE "ai_model_calls" ADD COLUMN "cache_hit_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_model_calls" ADD COLUMN "cache_miss_tokens" integer;