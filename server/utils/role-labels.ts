import type { AppRole } from '../../app/composables/useAuth'

export const ROLE_LABELS: Record<AppRole, string> = {
  teacher: '班主任', psychologist: '心理专员', school_admin: '学校管理员', platform_admin: '平台管理员'
}