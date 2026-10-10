import type { AppRole } from '../../app/composables/useAuth'

export const ROLE_LABELS: Record<AppRole, string> = {
  teacher: '班主任', psychologist: '心理专员', school_admin: '学校管理员',
  division_principal: '学部校长', moral_education_director: '德育主任', grade_director: '年级主任',
  platform_admin: '平台管理员'
}
