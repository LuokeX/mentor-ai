import { ssoAuthorizeUrl } from '../../../../domain/sso'

export default defineEventHandler(async (event) => {
  const url = await ssoAuthorizeUrl(event)
  return sendRedirect(event, url)
})