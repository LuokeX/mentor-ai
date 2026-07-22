import { and, desc, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { managedRecordStatusSchema } from '../../../../../shared/contracts'
import { countSql, offsetFrom, requireSchoolManagement } from '../../../../domain/school-management'
import { decryptSensitive, searchableHash } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { schoolId } = await requireSchoolManagement(event, ['guardians'])
  const parsed = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(120).optional(),
    status: managedRecordStatusSchema.or(z.literal('all')).default('all'),
    ownerUserId: z.string().uuid().or(z.literal('all')).default('all')
  }).parse(getQuery(event))
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const conditions = [eq(schema.guardians.schoolId, schoolId)]
  if (parsed.status !== 'all') conditions.push(eq(schema.guardians.status, parsed.status))
  if (parsed.ownerUserId !== 'all') conditions.push(eq(schema.guardians.ownerUserId, parsed.ownerUserId))
  if (parsed.q) {
    const hash = searchableHash(parsed.q, secret)
    conditions.push(or(eq(schema.guardians.nameSearch, hash), eq(schema.guardians.externalRefSearch, hash))!)
  }
  const [rows, [total], relations, studentsRaw] = await Promise.all([
    db.select({
      id: schema.guardians.id,
      ownerUserId: schema.guardians.ownerUserId,
      ownerName: schema.users.name,
      nameEnc: schema.guardians.nameEnc,
      phoneEnc: schema.guardians.phoneEnc,
      relation: schema.guardians.relation,
      externalRefEnc: schema.guardians.externalRefEnc,
      status: schema.guardians.status,
      createdAt: schema.guardians.createdAt,
      updatedAt: schema.guardians.updatedAt
    })
      .from(schema.guardians)
      .innerJoin(schema.users, eq(schema.users.id, schema.guardians.ownerUserId))
      .where(and(...conditions))
      .orderBy(desc(schema.guardians.updatedAt))
      .limit(parsed.pageSize)
      .offset(offsetFrom(parsed.page, parsed.pageSize)),
    db.select({ value: countSql }).from(schema.guardians).where(and(...conditions)),
    db.select().from(schema.studentGuardians),
    db.select({ id: schema.students.id, nameEnc: schema.students.nameEnc, classId: schema.students.classId }).from(schema.students).where(eq(schema.students.schoolId, schoolId))
  ])
  const studentById = new Map(studentsRaw.map(student => [student.id, student]))
  return {
    rows: rows.map(row => ({
      ...row,
      name: decryptSensitive(row.nameEnc, secret),
      phone: decryptSensitive(row.phoneEnc, secret),
      externalRef: decryptSensitive(row.externalRefEnc, secret),
      linkedStudents: relations.filter(relation => relation.guardianId === row.id).map(relation => studentById.get(relation.studentId)).filter(Boolean).map(student => ({
        id: student!.id,
        name: decryptSensitive(student!.nameEnc, secret),
        classId: student!.classId
      })),
      nameEnc: undefined,
      phoneEnc: undefined,
      externalRefEnc: undefined
    })),
    page: parsed.page,
    pageSize: parsed.pageSize,
    total: total?.value || 0
  }
})
