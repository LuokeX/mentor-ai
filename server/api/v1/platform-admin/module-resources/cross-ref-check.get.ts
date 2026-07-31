import { moduleIdSchema } from '../../../../../shared/contracts'
import { runCrossRefCheck } from '../../../../domain/module-resource-cross-ref-runner'
import { requireUser } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const query = getQuery(event)
  const module = moduleIdSchema.parse(query.module)
  const versionId = typeof query.versionId === 'string' && query.versionId.length > 0 ? query.versionId : undefined
  // payload 组装逻辑见 module-resource-cross-ref-runner，导入预检与发布共用同一份
  return runCrossRefCheck(event, module, versionId ? { kind: 'byVersion', versionId } : undefined)
})
