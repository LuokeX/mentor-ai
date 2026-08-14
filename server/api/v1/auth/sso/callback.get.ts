import { eq } from 'drizzle-orm'
import { clearSsoCookies, completeSsoLogin, ssoConfig } from '../../../../domain/sso'
import { writeAudit } from '../../../../utils/audit'
import { createSession } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  try {
    const user = await completeSsoLogin(event)
    await createSession(event, user.id)
    await useDb(event).update(schema.users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.users.id, user.id))
    await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'auth.sso.login' })
    clearSsoCookies(event)
    return sendRedirect(event, '/')
  } catch (err) {
    clearSsoCookies(event)
    let idp = ''
    try { idp = ssoConfig(event).issuer } catch { /* 未配置时留空 */ }
    await writeAudit(event, {
      action: 'auth.sso.login',
      result: 'denied',
      metadata: { idp }
    }).catch(() => { /* 审计失败不阻断重定向 */ })
    return sendRedirect(event, '/login?error=sso')
  }
})