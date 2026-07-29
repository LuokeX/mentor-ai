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
})
