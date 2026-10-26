import { requireUser } from '../../../utils/auth'
import { listUserTenants } from '../../../domain/user-roles'
import { useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const tenants = await listUserTenants(useDb(event), user.id)
  return { ...user, tenants }
})
