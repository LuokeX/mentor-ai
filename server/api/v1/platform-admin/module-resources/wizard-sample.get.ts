/**
 * 向导的「填入示例」。
 *
 * 业务不是技术人员，给一份填满的真实内容照着改，比给空表格加说明有效得多。
 * 内容与 tests/fixtures/wizard-sample.ts 同源，那份同时是回归测试的输入——
 * 也就是说这份示例永远是能编译通过、能跑出方案的。
 */
import { WIZARD_SAMPLE } from '../../../../../tests/fixtures/wizard-sample'
import { requireUser } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  return WIZARD_SAMPLE
})
