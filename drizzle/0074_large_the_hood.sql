CREATE TABLE "chat_sandbox_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"session_id" uuid,
	"provider_workspace_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_sandbox_workspaces" ADD CONSTRAINT "chat_sandbox_workspaces_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sandbox_workspaces" ADD CONSTRAINT "chat_sandbox_workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sandbox_workspaces" ADD CONSTRAINT "chat_sandbox_workspaces_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_sandbox_workspaces_provider_uidx" ON "chat_sandbox_workspaces" USING btree ("provider_workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_sandbox_workspaces_active_session_uidx" ON "chat_sandbox_workspaces" USING btree ("session_id") WHERE "chat_sandbox_workspaces"."status" = 'active' AND "chat_sandbox_workspaces"."session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_sandbox_workspaces_owner_idx" ON "chat_sandbox_workspaces" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "chat_sandbox_workspaces_expiry_idx" ON "chat_sandbox_workspaces" USING btree ("expires_at");