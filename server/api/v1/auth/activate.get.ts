import { z } from 'zod'
import { findValidInvitation } from '../../../domain/invitations'

export default defineEventHandler(async (event) => {
  const token = z.string().min(20).max(200).parse(getQuery(event).token)
  const invitation = await findValidInvitation(event, token)
  if (!invitation) throw createError({ statusCode: 410, message: '激活链接无效或已过期' })
  return {
    name: invitation.name,
    phone: invitation.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'),
    role: invitation.role,
    expiresAt: invitation.expiresAt
  }
})