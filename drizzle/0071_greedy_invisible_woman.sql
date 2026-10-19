CREATE TABLE "communication_guardians" (
	"communication_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_students" (
	"communication_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_event_students" (
	"event_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "source_chat_session_id" uuid;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "source_chat_message_id" uuid;--> statement-breakpoint
ALTER TABLE "student_events" ADD COLUMN "source_chat_session_id" uuid;--> statement-breakpoint
ALTER TABLE "student_events" ADD COLUMN "source_chat_message_id" uuid;--> statement-breakpoint
ALTER TABLE "communication_guardians" ADD CONSTRAINT "communication_guardians_communication_id_communications_id_fk" FOREIGN KEY ("communication_id") REFERENCES "public"."communications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_guardians" ADD CONSTRAINT "communication_guardians_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_guardians" ADD CONSTRAINT "communication_guardians_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_students" ADD CONSTRAINT "communication_students_communication_id_communications_id_fk" FOREIGN KEY ("communication_id") REFERENCES "public"."communications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_students" ADD CONSTRAINT "communication_students_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_students" ADD CONSTRAINT "communication_students_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_event_students" ADD CONSTRAINT "student_event_students_event_id_student_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."student_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_event_students" ADD CONSTRAINT "student_event_students_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_event_students" ADD CONSTRAINT "student_event_students_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "communication_guardian_uidx" ON "communication_guardians" USING btree ("communication_id","guardian_id");--> statement-breakpoint
CREATE INDEX "communication_guardians_guardian_idx" ON "communication_guardians" USING btree ("guardian_id");--> statement-breakpoint
CREATE INDEX "communication_guardians_school_idx" ON "communication_guardians" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_student_uidx" ON "communication_students" USING btree ("communication_id","student_id");--> statement-breakpoint
CREATE INDEX "communication_students_student_idx" ON "communication_students" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "communication_students_school_idx" ON "communication_students" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_event_student_uidx" ON "student_event_students" USING btree ("event_id","student_id");--> statement-breakpoint
CREATE INDEX "student_event_students_student_idx" ON "student_event_students" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_event_students_school_idx" ON "student_event_students" USING btree ("school_id");--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_source_chat_session_id_chat_sessions_id_fk" FOREIGN KEY ("source_chat_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_source_chat_message_id_chat_messages_id_fk" FOREIGN KEY ("source_chat_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_events" ADD CONSTRAINT "student_events_source_chat_session_id_chat_sessions_id_fk" FOREIGN KEY ("source_chat_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_events" ADD CONSTRAINT "student_events_source_chat_message_id_chat_messages_id_fk" FOREIGN KEY ("source_chat_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "communications_source_message_idx" ON "communications" USING btree ("source_chat_message_id");--> statement-breakpoint
CREATE INDEX "student_events_source_message_idx" ON "student_events" USING btree ("source_chat_message_id");