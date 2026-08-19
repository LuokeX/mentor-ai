import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireSchoolManagement } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor: user, schoolId } = await requireSchoolManagement(event, ['assessments'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  // 评估 owner 是教师，schoolId 过滤即可隔离本校数据
  const [attempt] = await useDb(event).select().from(schema.assessmentAttempts)
    .where(and(eq(schema.assessmentAttempts.id, id), eq(schema.assessmentAttempts.schoolId, schoolId)))
    .limit(1)
  if (!attempt) throw createError({ statusCode: 404, message: '评估不存在' })
  await writeAudit(event, {
    schoolId, actorId: user.id, action: 'school_admin.assessment.read',
    targetType: 'assessment', targetId: id
  })
  return attempt
})