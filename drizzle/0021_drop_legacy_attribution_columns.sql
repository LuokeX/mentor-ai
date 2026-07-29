-- 幂等化：若列存在才删除
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='module_resource_attribution_rules' AND column_name='primary_attribution') THEN
    ALTER TABLE "module_resource_attribution_rules" DROP COLUMN "primary_attribution";
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='module_resource_attribution_rules' AND column_name='secondary_attributions') THEN
    ALTER TABLE "module_resource_attribution_rules" DROP COLUMN "secondary_attributions";
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='module_resource_attribution_rules' AND column_name='tool_tags') THEN
    ALTER TABLE "module_resource_attribution_rules" DROP COLUMN "tool_tags";
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='module_resource_attribution_rules' AND column_name='reason_count') THEN
    ALTER TABLE "module_resource_attribution_rules" DROP COLUMN "reason_count";
  END IF;
END $$;