CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_model" varchar(120);--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;
