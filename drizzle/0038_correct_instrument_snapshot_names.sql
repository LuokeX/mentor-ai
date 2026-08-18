-- 0035 只按量表编码取任意已发布标题，学校自定义同编码量表可能被跨校名称覆盖。
-- 本迁移按方案逐条重算：方案明确来源版本 > 本校发布版本 > 平台全局版本。
WITH corrected AS (
  SELECT
    p.id AS plan_id,
    jsonb_agg(
      jsonb_build_object(
        'code', snapshot.item->>'code',
        'name', COALESCE(resolved.title, snapshot.item->>'name', snapshot.item->>'code'),
        'version', snapshot.item->>'version',
        'sequence', COALESCE((snapshot.item->>'sequence')::integer, snapshot.ordinality::integer - 1)
      ) ORDER BY snapshot.ordinality
    ) AS snapshots
  FROM plans p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.instrument_snapshots) = 'array'
      THEN p.instrument_snapshots ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS snapshot(item, ordinality)
  LEFT JOIN LATERAL (
    SELECT candidate.title
    FROM (
      SELECT
        instrument.title,
        CASE
          WHEN p.source_resource_version_ids ? version.id::text THEN 0
          WHEN library.school_id = p.school_id THEN 1
          ELSE 2
        END AS scope_priority,
        CASE WHEN version.version = snapshot.item->>'version' THEN 0 ELSE 1 END AS version_priority,
        version.published_at
      FROM module_resource_versions version
      INNER JOIN module_resource_libraries library ON library.id = version.library_id
      CROSS JOIN LATERAL (
        SELECT version.payload->>'code' AS code, version.payload->>'title' AS title
        WHERE version.payload->>'code' IS NOT NULL
        UNION ALL
        SELECT item->>'code' AS code, item->>'title' AS title
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(version.payload->'instruments') = 'array'
            THEN version.payload->'instruments' ELSE '[]'::jsonb END
        ) AS item
      ) AS instrument
      WHERE version.status = 'published'
        AND library.library_type = 'assessment'
        AND library.module = p.module
        AND (library.school_id = p.school_id OR library.school_id IS NULL)
        AND instrument.code = snapshot.item->>'code'
        AND instrument.title IS NOT NULL
    ) AS candidate
    ORDER BY candidate.scope_priority, candidate.version_priority, candidate.published_at DESC NULLS LAST
    LIMIT 1
  ) AS resolved ON true
  GROUP BY p.id
)
UPDATE plans p
SET instrument_snapshots = corrected.snapshots
FROM corrected
WHERE p.id = corrected.plan_id
  AND corrected.snapshots IS NOT NULL;
