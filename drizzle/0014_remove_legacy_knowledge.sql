ALTER TABLE "module_resource_versions" DROP CONSTRAINT IF EXISTS "module_resource_versions_source_knowledge_base_id_knowledge_bases_id_fk";
--> statement-breakpoint
ALTER TABLE "module_resource_versions" DROP COLUMN IF EXISTS "source_knowledge_base_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "knowledge_chunks";
--> statement-breakpoint
DROP TABLE IF EXISTS "knowledge_documents";
--> statement-breakpoint
DROP TABLE IF EXISTS "knowledge_bases";
