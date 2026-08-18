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
})
