import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('management migration safety', () => {
  it('backfills relationship school ownership before enforcing not-null', () => {
    const sql = readFileSync(new URL('../drizzle/0018_equal_shiva.sql', import.meta.url), 'utf8')
    const addNullable = sql.indexOf('ADD COLUMN IF NOT EXISTS "school_id" uuid;')
    const backfill = sql.indexOf('UPDATE "student_guardians" AS sg')
    const enforce = sql.indexOf('ALTER COLUMN "school_id" SET NOT NULL')
    expect(addNullable).toBeGreaterThan(-1)
    expect(backfill).toBeGreaterThan(addNullable)
    expect(enforce).toBeGreaterThan(backfill)
  })

  it('adds lifecycle columns and relationship status in a follow-up migration', () => {
    const sql = readFileSync(new URL('../drizzle/0019_lean_nightcrawler.sql', import.meta.url), 'utf8')
    expect(sql).toContain('ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "archived_at"')
    expect(sql).toContain('ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "archived_at"')
    expect(sql).toContain('ALTER TABLE "student_events" ADD COLUMN IF NOT EXISTS "archived_at"')
    expect(sql).toContain('ALTER TABLE "department_members" ADD COLUMN IF NOT EXISTS "status"')
    expect(sql).toContain('("department_id","user_id","status")')
  })

  it('protects open assessment groups from first-submit races', () => {
    const sql = readFileSync(new URL('../drizzle/0036_assessment_session_guards.sql', import.meta.url), 'utf8')
    expect(sql).toContain('assessment_sessions_open_chat_uidx')
    expect(sql).toContain('assessment_sessions_open_context_uidx')
    expect(sql).toContain('source_chat_session_id IS NOT NULL')
    expect(sql).toContain('context_id IS NOT NULL')
  })

  it('corrects snapshot names using source, school, then global scope', () => {
    const sql = readFileSync(new URL('../drizzle/0038_correct_instrument_snapshot_names.sql', import.meta.url), 'utf8')
    expect(sql).toContain('p.source_resource_version_ids ? version.id::text')
    expect(sql).toContain('library.school_id = p.school_id')
    expect(sql).toContain('library.school_id IS NULL')
    expect(sql).toContain('ORDER BY candidate.scope_priority')
  })

  it('backfills accepted plan actions before decision metrics are enabled', () => {
    const sql = readFileSync(new URL('../drizzle/0040_cynical_lilandra.sql', import.meta.url), 'utf8')
    const decisionColumn = sql.indexOf('ADD COLUMN "decision"')
    const acceptedBackfill = sql.indexOf('UPDATE "plan_actions" AS pa')
    const decisionIndex = sql.indexOf('CREATE INDEX "plan_actions_plan_decision_idx"')
    expect(decisionColumn).toBeGreaterThan(-1)
    expect(acceptedBackfill).toBeGreaterThan(decisionColumn)
    expect(sql).toContain("p.\"accepted_at\" IS NOT NULL")
    expect(decisionIndex).toBeGreaterThan(acceptedBackfill)
  })

  it('creates session object and record relation tables for multi-object support', () => {
    // 迁移 A：会话关联对象（主对象之外的其余对象，@ 多名学生）
    const sessionObjects = readFileSync(new URL('../drizzle/0070_next_mephistopheles.sql', import.meta.url), 'utf8')
    expect(sessionObjects).toContain('CREATE TABLE "chat_session_objects"')
    expect(sessionObjects).toContain('CREATE UNIQUE INDEX "chat_session_object_uidx"')
    expect(sessionObjects).toContain('ON DELETE cascade')
    // 迁移 B：学生事件关联学生 + 家校沟通关联学生/家长 + 记录来源列（AI 对话转存）
    const recordRelations = readFileSync(new URL('../drizzle/0071_greedy_invisible_woman.sql', import.meta.url), 'utf8')
    expect(recordRelations).toContain('CREATE TABLE "student_event_students"')
    expect(recordRelations).toContain('CREATE TABLE "communication_students"')
    expect(recordRelations).toContain('CREATE TABLE "communication_guardians"')
    expect(recordRelations).toContain('CREATE UNIQUE INDEX "student_event_student_uidx"')
    expect(recordRelations).toContain('CREATE UNIQUE INDEX "communication_student_uidx"')
    expect(recordRelations).toContain('CREATE UNIQUE INDEX "communication_guardian_uidx"')
    expect(recordRelations).toContain('ALTER TABLE "student_events" ADD COLUMN "source_chat_message_id" uuid')
    expect(recordRelations).toContain('ALTER TABLE "communications" ADD COLUMN "source_chat_session_id" uuid')
  })
})
