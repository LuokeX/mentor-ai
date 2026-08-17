-- 数据修复：0034 回填量表快照时只有 assessment_code 可用，name 被写成了编码。
-- 这里从已发布的 assessment 版本（module_resource_versions.payload）按 code 匹配真实标题；
-- 匹配不到的项（如已下架量表）保留原值，等待运营后续补录。
WITH "instrument_names" AS (
  SELECT DISTINCT ON (code) code, title
  FROM (
    SELECT payload->>'code' AS code, payload->>'title' AS title
    FROM "module_resource_versions"
    WHERE "status" = 'published'
      AND payload->>'code' IS NOT NULL
      AND payload->>'title' IS NOT NULL
    UNION ALL
    SELECT inst->>'code' AS code, inst->>'title' AS title
    FROM "module_resource_versions"
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(payload->'instruments') = 'array' THEN payload->'instruments' ELSE '[]'::jsonb END
    ) AS inst
    WHERE "status" = 'published'
      AND inst->>'code' IS NOT NULL
      AND inst->>'title' IS NOT NULL
  ) AS merged
  WHERE code IS NOT NULL AND title IS NOT NULL
  ORDER BY code
)
UPDATE "plans" p
SET "instrument_snapshots" = COALESCE(
  (
    SELECT jsonb_agg(jsonb_build_object(
      'code', s->>'code',
      'name', CASE WHEN s->>'name' = s->>'code' THEN COALESCE(n.title, s->>'name') ELSE s->>'name' END,
      'version', s->>'version',
      'sequence', (s->>'sequence')::int
    ))
    FROM jsonb_array_elements(p."instrument_snapshots") AS s
    LEFT JOIN "instrument_names" n ON n.code = s->>'code'
  ),
  p."instrument_snapshots"
)
WHERE jsonb_array_length(p."instrument_snapshots") > 0;