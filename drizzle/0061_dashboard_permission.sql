-- 角色权限清单新增「数据驾驶舱」（dashboard）目标类型。
-- 数据驾驶舱是只读看板，唯一能力是「查看」：校长（学部校长）默认勾选，其余角色写入空清单。
-- 目标类型清单的代码事实来源是 shared/management.ts 的 MANAGED_TARGET_TYPES，
-- 回退逻辑在 server/domain/capabilities.ts（未配置该键时只有学部校长具备查看能力）。
UPDATE "roles"
SET "permissions" = jsonb_set(
      jsonb_set("permissions", '{pages,dashboard}', '["view"]'::jsonb, true),
      '{records,dashboard}', '["view"]'::jsonb, true
    ),
    "updated_at" = now()
WHERE "code" = 'division_principal';--> statement-breakpoint
UPDATE "roles"
SET "permissions" = jsonb_set(
      jsonb_set("permissions", '{pages,dashboard}', '[]'::jsonb, true),
      '{records,dashboard}', '[]'::jsonb, true
    ),
    "updated_at" = now()
WHERE "code" <> 'division_principal';
