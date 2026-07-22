import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { managedRecordStatusSchema } from '../../../../../shared/contracts'
import { countSql, offsetFrom, requireSchoolManagement } from '../../../../domain/school-management'
import { decryptSensitive, searchableHash } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { schoolId } = await requireSchoolManagement(event, ['students'])
  const parsed = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(120).optional(),
    status: managedRecordStatusSchema.or(z.literal('all')).default('all'),
    classId: z.string().uuid().or(z.literal('all')).or(z.literal('none')).default('all'),
    ownerUserId: z.string().uuid().or(z.literal('all')).default('all')
  }).parse(getQuery(event))
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const conditions = [eq(schema.students.schoolId, schoolId)]
  if (parsed.status !== 'all') conditions.push(eq(schema.students.status, parsed.status))
  if (parsed.classId === 'none') conditions.push(isNull(schema.students.classId))
  else if (parsed.classId !== 'all') conditions.push(eq(schema.students.classId, parsed.classId))
  if (parsed.ownerUserId !== 'all') conditions.push(eq(schema.students.ownerUserId, parsed.ownerUserId))
  if (parsed.q) {
    const hash = searchableHash(parsed.q, secret)
    conditions.push(or(eq(schema.students.nameSearch, hash), eq(schema.students.externalRefSearch, hash))!)
  }
  const [rows, [total]] = await Promise.all([
    db.select({
      id: schema.students.id,
      ownerUserId: schema.students.ownerUserId,
      ownerName: schema.users.name,
      classId: schema.students.classId,
      className: schema.classes.name,
      departmentId: schema.classes.departmentId,
      departmentName: schema.departments.name,
      nameEnc: schema.students.nameEnc,
      gender: schema.students.gender,
      profileEnc: schema.students.profileEnc,
      notesEnc: schema.students.notesEnc,
      externalRefEnc: schema.students.externalRefEnc,
      status: schema.students.status,
      createdAt: schema.students.createdAt,
      updatedAt: schema.students.updatedAt
    })
      .from(schema.students)
      .innerJoin(schema.users, eq(schema.users.id, schema.students.ownerUserId))
      .leftJoin(schema.classes, eq(schema.classes.id, schema.students.classId))
      .leftJoin(schema.departments, eq(schema.departments.id, schema.classes.departmentId))
      .where(and(...conditions))
      .orderBy(desc(schema.students.updatedAt))
      .limit(parsed.pageSize)
      .offset(offsetFrom(parsed.page, parsed.pageSize)),
    db.select({ value: countSql }).from(schema.students).where(and(...conditions))
  ])
  return {
    rows: rows.map(row => ({
      ...row,
      name: decryptSensitive(row.nameEnc, secret),
      profile: safeJson(decryptSensitive(row.profileEnc, secret)),
      notes: decryptSensitive(row.notesEnc, secret),
      externalRef: decryptSensitive(row.externalRefEnc, secret),
      nameEnc: undefined,
      profileEnc: undefined,
      notesEnc: undefined,
      externalRefEnc: undefined
    })),
    page: parsed.page,
    pageSize: parsed.pageSize,
    total: total?.value || 0
  }
})

function safeJson(value: string) {
  if (!value) return {}
  try { return JSON.parse(value) } catch { return { text: value } }
}
