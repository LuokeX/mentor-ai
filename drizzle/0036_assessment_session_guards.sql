-- 同一对话或明确业务对象只能有一个开放评估组。
-- 先关闭历史并发产生的重复组，再建立数据库级并发保护。
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY school_id, owner_user_id, module, source_chat_session_id
    ORDER BY created_at DESC, id DESC
  ) AS rn
  FROM assessment_sessions
  WHERE status = 'open'
    AND source_type = 'assistant_dialogue'
    AND source_chat_session_id IS NOT NULL
)
UPDATE assessment_sessions s
SET status = 'completed', completed_at = now(), updated_at = now()
FROM ranked r
WHERE s.id = r.id AND r.rn > 1;
--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY school_id, owner_user_id, module, context_type, context_id
    ORDER BY created_at DESC, id DESC
  ) AS rn
  FROM assessment_sessions
  WHERE status = 'open'
    AND source_type = 'direct_assessment'
    AND context_id IS NOT NULL
)
UPDATE assessment_sessions s
SET status = 'completed', completed_at = now(), updated_at = now()
FROM ranked r
WHERE s.id = r.id AND r.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_sessions_open_chat_uidx"
ON "assessment_sessions" ("school_id", "owner_user_id", "module", "source_chat_session_id")
WHERE "status" = 'open' AND "source_type" = 'assistant_dialogue' AND "source_chat_session_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_sessions_open_context_uidx"
ON "assessment_sessions" ("school_id", "owner_user_id", "module", "context_type", "context_id")
WHERE "status" = 'open' AND "source_type" = 'direct_assessment' AND "context_id" IS NOT NULL;
