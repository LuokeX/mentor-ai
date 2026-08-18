import { describe, expect, it } from 'vitest'
import type { AuthUser } from '../app/composables/useAuth'
import { resolveCapabilities, resolvePageCapabilities } from '../server/domain/capabilities'

const teacher: AuthUser = {
  id: 'teacher-1',
  schoolId: 'school-1',
  phone: '13800000001',
  name: '李老师',
  role: 'teacher',
  roleLabel: '教师',
}
const schoolAdmin: AuthUser = {
  ...teacher,
  id: 'admin-1',
  phone: '13800000002',
  name: '学校管理员',
  role: 'school_admin',
  roleLabel: '学校管理员',
}
const platformAdmin: AuthUser = {
  ...schoolAdmin,
  id: 'platform-1',
  schoolId: null,
  role: 'platform_admin',
  roleLabel: '平台管理员',
}

describe('managed record capabilities', () => {
  it('keeps teacher records within school and owner boundaries', async () => {
    expect(await resolveCapabilities({
      user: teacher,
      recordSchoolId: 'school-1',
      recordOwnerUserId: 'teacher-1',
      recordStatus: 'active',
      targetType: 'student',
    })).toEqual(['view', 'edit', 'inline_edit'])
    expect(await resolveCapabilities({
      user: teacher,
      recordSchoolId: 'school-2',
      recordOwnerUserId: 'teacher-1',
      recordStatus: 'active',
      targetType: 'student',
    })).toEqual([])
    expect(await resolveCapabilities({
      user: teacher,
      recordSchoolId: 'school-1',
      recordOwnerUserId: 'teacher-2',
      recordStatus: 'active',
      targetType: 'student',
    })).toEqual([])
  })

  it('does not let teachers archive school-owned students or classes', async () => {
    expect(await resolveCapabilities({
      user: teacher,
      recordSchoolId: 'school-1',
      recordOwnerUserId: 'teacher-1',
      recordStatus: 'active',
      targetType: 'student',
    })).not.toContain('archive')
    expect(await resolveCapabilities({
      user: teacher,
      recordSchoolId: 'school-1',
      recordOwnerUserId: 'teacher-1',
      recordStatus: 'active',
      targetType: 'class',
    })).toEqual(['view'])
  })

  it('exposes archive and restore according to school record lifecycle', async () => {
    const active = await resolveCapabilities({
      user: schoolAdmin,
      recordSchoolId: 'school-1',
      recordStatus: 'active',
      targetType: 'department',
    })
    expect(active).toContain('archive')
    expect(active).not.toContain('restore')

    const archived = await resolveCapabilities({
      user: schoolAdmin,
      recordSchoolId: 'school-1',
      recordStatus: 'archived',
      targetType: 'department',
    })
    expect(archived).toContain('restore')
    expect(archived).not.toContain('archive')
  })

  it('only permits deletion for never-activated invitations', async () => {
    expect(await resolveCapabilities({
      user: schoolAdmin,
      recordSchoolId: 'school-1',
      recordStatus: 'invited',
      activatedAt: null,
      targetType: 'user',
    })).toContain('delete')
    expect(await resolveCapabilities({
      user: schoolAdmin,
      recordSchoolId: 'school-1',
      recordStatus: 'invited',
      activatedAt: new Date(),
      targetType: 'user',
    })).not.toContain('delete')
  })

  it('grants platform admins direct account management and read-only view of other school records', async () => {
    const account = await resolveCapabilities({
      user: platformAdmin,
      recordSchoolId: 'school-1',
      recordStatus: 'active',
      targetType: 'user',
    })
    expect(account).toContain('view')
    expect(account).toContain('edit')
    expect(account).toContain('disable')
    expect(await resolveCapabilities({
      user: platformAdmin,
      recordSchoolId: 'school-1',
      recordStatus: 'active',
      targetType: 'student',
    })).toEqual(['view'])
    expect(await resolvePageCapabilities(platformAdmin, 'user')).toEqual(['view', 'create'])
  })

  it('only exposes referral transfer before acknowledgement', async () => {
    expect(await resolveCapabilities({
      user: schoolAdmin,
      recordSchoolId: 'school-1',
      recordStatus: 'created',
      targetType: 'referral',
    })).toEqual(['view', 'transfer'])
    expect(await resolveCapabilities({
      user: schoolAdmin,
      recordSchoolId: 'school-1',
      recordStatus: 'acknowledged',
      targetType: 'referral',
    })).toEqual(['view'])
    expect(await resolveCapabilities({
      user: schoolAdmin,
      recordSchoolId: 'school-2',
      recordStatus: 'created',
      targetType: 'referral',
    })).toEqual([])
  })
})