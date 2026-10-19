CREATE TABLE "chat_session_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"object_type" varchar(30) NOT NULL,
	"object_id" uuid NOT NULL,
	"label" varchar(120),
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_session_objects" ADD CONSTRAINT "chat_session_objects_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session_objects" ADD CONSTRAINT "chat_session_objects_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_session_object_uidx" ON "chat_session_objects" USING btree ("session_id","object_type","object_id");--> statement-breakpoint
CREATE INDEX "chat_session_objects_session_idx" ON "chat_session_objects" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX "chat_session_objects_object_idx" ON "chat_session_objects" USING btree ("object_type","object_id");