/**
 * 业务填写向导的代入试算（v4 模板 ⑪ 全链路推演的交互版）。
 *
 * 请求带完整的 WizardInput + 每张量表每维度的 1..5 强度，
 * 服务端走「编译 → 解析 → 规则引擎」真实链路，返回每张量表会判成什么。
 * 前端预检（wizard-preview）已经保证 canImport，试算单独调这个端点。
 */
import { z } from 'zod'
import { wizardInputSchema } from '../../../../../shared/business-wizard'
import { simulateWizardRun } from '../../../../domain/business-wizard-simulate'
import { requireUser } from '../../../../utils/auth'

const bodySchema = z.object({
  input: wizardInputSchema,
  /** 量表名 → 维度名 → 1..5 强度 */
  answers: z.record(z.string(), z.record(z.string(), z.number().min(1).max(5))),
  /** 逐题覆盖（可选）：量表名 → 题号 qN → 选项原始分值，覆盖维度强度 */
  perQuestion: z.record(z.string(), z.record(z.string(), z.number())).optional()
})

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const body = bodySchema.safeParse(await readBody(event))
  if (!body.success) {
    const issue = body.error.issues[0]
    throw createError({
      statusCode: 400,
      message: `试算参数不完整：${issue?.path.join('.') || ''} ${issue?.message || ''}`
    })
  }
  try {
    return simulateWizardRun(body.data.input, body.data.answers, { perQuestion: body.data.perQuestion })
  } catch (error: any) {
    throw createError({ statusCode: 400, message: error?.message || '试算失败' })
  }
})