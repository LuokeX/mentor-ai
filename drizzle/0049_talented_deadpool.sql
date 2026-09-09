ALTER TABLE "ai_runtime_settings" ADD COLUMN "agent_enabled" boolean;--> statement-breakpoint
ALTER TABLE "ai_runtime_settings" ADD COLUMN "agent_max_rounds" integer;--> statement-breakpoint
ALTER TABLE "ai_runtime_settings" ADD COLUMN "agent_temperature" real;--> statement-breakpoint
ALTER TABLE "ai_runtime_settings" ADD COLUMN "agent_tools" jsonb;--> statement-breakpoint
ALTER TABLE "ai_runtime_settings" ADD COLUMN "agent_behavior_notes" text;