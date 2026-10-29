import { eq } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { schoolSectionOfOrganization } from '../../../../../shared/school-section'

/**
 * 教师端「批量添加信息」的模板描述。
 *
 * 组织模型里学部即学校，因此不用教师手选学部：小学部/初中部学校下发对应学部的
 * 「学生+家长」信息表模板，其它学校（含高中部，模板待定）沿用通用简易学生模板。
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const [school] = await useDb(event)
    .select({ name: schema.schools.name, code: schema.schools.code })
    .from(schema.schools)
    .where(eq(schema.schools.id, user.schoolId))
    .limit(1)
  const section = school ? schoolSectionOfOrganization(school) : null
  if (section === 'primary' || section === 'junior') {
    return {
      section,
      templateUrl: `/templates/student-family-${section}.xlsx`,
      previewUrl: '/api/v1/information/student-family/import-preview',
      commitUrl: '/api/v1/information/student-family/import-commit',
      sampleFields: ['studentName', 'className', 'guardians', 'action'],
    }
  }
  return {
    section: null,
    templateUrl: '/api/v1/information/students/import-template',
    previewUrl: '/api/v1/information/students/import-preview',
    commitUrl: '/api/v1/information/students/import-commit',
    sampleFields: ['name', 'className'],
  }
})
