CREATE TABLE "module_resource_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"heading" varchar(300),
	"content" text NOT NULL,
	"token_estimate" integer NOT NULL,
	"embedding" vector(1024),
	"embedding_model" varchar(120),
	"embedded_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module_resource_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"source_type" varchar(30) NOT NULL,
	"original_filename" varchar(260),
	"mime_type" varchar(120),
	"checksum" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module_resource_libraries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid,
	"module" varchar(40) NOT NULL,
	"library_type" varchar(40) NOT NULL,
	"scope" varchar(20) DEFAULT 'global' NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module_resource_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" uuid NOT NULL,
	"version" varchar(40) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"source_content_package_id" uuid,
	"source_knowledge_base_id" uuid,
	"created_by" uuid NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "module_resource_chunks" ADD CONSTRAINT "module_resource_chunks_library_id_module_resource_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."module_resource_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_resource_chunks" ADD CONSTRAINT "module_resource_chunks_version_id_module_resource_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."module_resource_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_resource_chunks" ADD CONSTRAINT "module_resource_chunks_document_id_module_resource_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."module_resource_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_resource_documents" ADD CONSTRAINT "module_resource_documents_library_id_module_resource_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."module_resource_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_resource_documents" ADD CONSTRAINT "module_resource_documents_version_id_module_resource_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."module_resource_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_resource_documents" ADD CONSTRAINT "module_resource_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_resource_libraries" ADD CONSTRAINT "module_resource_libraries_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_resource_libraries" ADD CONSTRAINT "module_resource_libraries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_resource_versions" ADD CONSTRAINT "module_resource_versions_library_id_module_resource_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."module_resource_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_resource_versions" ADD CONSTRAINT "module_resource_versions_source_content_package_id_content_packages_id_fk" FOREIGN KEY ("source_content_package_id") REFERENCES "public"."content_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_resource_versions" ADD CONSTRAINT "module_resource_versions_source_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("source_knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_resource_versions" ADD CONSTRAINT "module_resource_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_resource_versions" ADD CONSTRAINT "module_resource_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "module_resource_chunks_document_index_uidx" ON "module_resource_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "module_resource_chunks_version_idx" ON "module_resource_chunks" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "module_resource_chunks_library_idx" ON "module_resource_chunks" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "module_resource_chunks_document_idx" ON "module_resource_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "module_resource_documents_version_checksum_uidx" ON "module_resource_documents" USING btree ("version_id","checksum");--> statement-breakpoint
CREATE INDEX "module_resource_documents_version_idx" ON "module_resource_documents" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "module_resource_documents_library_idx" ON "module_resource_documents" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "module_resource_libraries_lookup_idx" ON "module_resource_libraries" USING btree ("module","library_type","scope","school_id");--> statement-breakpoint
CREATE INDEX "module_resource_libraries_school_idx" ON "module_resource_libraries" USING btree ("school_id","module");--> statement-breakpoint
CREATE UNIQUE INDEX "module_resource_libraries_global_uidx" ON "module_resource_libraries" USING btree ("module","library_type") WHERE "scope" = 'global';--> statement-breakpoint
CREATE UNIQUE INDEX "module_resource_libraries_school_uidx" ON "module_resource_libraries" USING btree ("school_id","module","library_type") WHERE "scope" = 'school';--> statement-breakpoint
CREATE UNIQUE INDEX "module_resource_versions_library_version_uidx" ON "module_resource_versions" USING btree ("library_id","version");--> statement-breakpoint
CREATE INDEX "module_resource_versions_library_status_idx" ON "module_resource_versions" USING btree ("library_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "module_resource_versions_published_uidx" ON "module_resource_versions" USING btree ("library_id") WHERE "status" = 'published';--> statement-breakpoint
CREATE INDEX "module_resource_chunks_content_trgm_idx" ON "module_resource_chunks" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "module_resource_chunks_heading_trgm_idx" ON "module_resource_chunks" USING gin ("heading" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "module_resource_chunks_embedding_hnsw_idx" ON "module_resource_chunks" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;
