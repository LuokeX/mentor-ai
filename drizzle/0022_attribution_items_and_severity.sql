CREATE TABLE IF NOT EXISTS "module_resource_attribution_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"module" varchar(40) NOT NULL,
	"scope" varchar(20) NOT NULL,
	"school_id" uuid,
	"attribution_code" varchar(80) NOT NULL,
	"attribution_name" varchar(120) NOT NULL,
	"base_weight" real DEFAULT 1 NOT NULL,
	"tool_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"assessment_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- 投影表是从 module_resource_versions.payload 派生的，发布时整表重建。
-- 首次迁移时必须先清空，否则 NOT NULL 新列在已有行上加不上去；
-- 但 severity 已存在说明迁移跑过了，此时不能再清——否则重复执行会把
-- 已经投影好的数据静默删掉，运营台的分级规则列表会变空。
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='module_resource_attribution_rules'
                   AND column_name='severity') THEN
    DELETE FROM "module_resource_attribution_rules";
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "module_resource_attribution_rules" ADD COLUMN IF NOT EXISTS "severity" varchar(20);--> statement-breakpoint
-- 只有在不存在 NULL 值时才能设 NOT NULL；重复执行是幂等的
UPDATE "module_resource_attribution_rules" SET "severity" = 'medium' WHERE "severity" IS NULL;--> statement-breakpoint
ALTER TABLE "module_resource_attribution_rules" ALTER COLUMN "severity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "module_resource_attribution_rules" ADD COLUMN IF NOT EXISTS "assessment_code" varchar(40);--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'module_resource_attribution_items_library_id_module_resource_libraries_id_fk') THEN
    ALTER TABLE "module_resource_attribution_items" ADD CONSTRAINT "module_resource_attribution_items_library_id_module_resource_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."module_resource_libraries"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'module_resource_attribution_items_version_id_module_resource_versions_id_fk') THEN
    ALTER TABLE "module_resource_attribution_items" ADD CONSTRAINT "module_resource_attribution_items_version_id_module_resource_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."module_resource_versions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'module_resource_attribution_items_school_id_schools_id_fk') THEN
    ALTER TABLE "module_resource_attribution_items" ADD CONSTRAINT "module_resource_attribution_items_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_resource_attribution_items_version_code_uidx" ON "module_resource_attribution_items" USING btree ("version_id","attribution_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_resource_attribution_items_lookup_idx" ON "module_resource_attribution_items" USING btree ("module","scope","school_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_resource_attribution_items_library_idx" ON "module_resource_attribution_items" USING btree ("library_id");