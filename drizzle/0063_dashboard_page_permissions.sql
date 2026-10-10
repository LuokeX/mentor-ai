-- 角色权限清单新增数据驾驶舱的三个二级页面目标类型：
--   dashboard_ai_questions（AI 问答分析）、dashboard_plans（量表与方案）、dashboard_alerts（预警看板）。
-- dashboard 保留为入口与「数据总览」页。平台后台「角色权限配置」可按角色逐页勾选「查看」。
-- 目标类型清单的代码事实来源是 shared/management.ts 的 MANAGED_TARGET_TYPES，
-- 默认勾选与回退规则见 server/domain/roles.ts 与 server/domain/capabilities.ts。
UPDATE "roles"
SET "permissions" = jsonb_set(
      jsonb_set(
        "permissions",
        '{pages}',
        COALESCE("permissions"->'pages', '{}'::jsonb) || '{"dashboard_ai_questions": ["view"], "dashboard_plans": ["view"], "dashboard_alerts": ["view"]}'::jsonb,
        true
      ),
      '{records}',
      COALESCE("permissions"->'records', '{}'::jsonb) || '{"dashboard_ai_questions": ["view"], "dashboard_plans": ["view"], "dashboard_alerts": ["view"]}'::jsonb,
      true
    ),
    "updated_at" = now()
WHERE "code" IN ('division_principal', 'moral_education_director', 'grade_director');--> statement-breakpoint

-- 其余角色显式写空数组（与 dashboard 键的既有写法一致）：既可数据化回退，也避免前端勾选清单出现空键。
UPDATE "roles"
SET "permissions" = jsonb_set(
      jsonb_set(
        "permissions",
        '{pages}',
        COALESCE("permissions"->'pages', '{}'::jsonb) || '{"dashboard_ai_questions": [], "dashboard_plans": [], "dashboard_alerts": []}'::jsonb,
        true
      ),
      '{records}',
      COALESCE("permissions"->'records', '{}'::jsonb) || '{"dashboard_ai_questions": [], "dashboard_plans": [], "dashboard_alerts": []}'::jsonb,
      true
    ),
    "updated_at" = now()
WHERE "code" NOT IN ('division_principal', 'moral_education_director', 'grade_director');
