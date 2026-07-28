ALTER TABLE "module_resource_chunks" ALTER COLUMN "library_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "module_resource_chunks" ALTER COLUMN "version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "module_resource_documents" ALTER COLUMN "library_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "module_resource_documents" ALTER COLUMN "version_id" DROP NOT NULL;