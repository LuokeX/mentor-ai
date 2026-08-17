import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core'

const vector1024 = customType<{ data: number[], driverData: string }>({
  dataType: () => 'vector(1024)',
  toDriver: value => `[${value.join(',')}]`,
  fromDriver: value => String(value).slice(1, -1).split(',').map(Number)
})

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}

export const schools = pgTable('schools', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 160 }).notNull(),
  code: varchar('code', { length: 40 }).notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  ...timestamps
}, table => [uniqueIndex('schools_code_uidx').on(table.code)])

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').references(() => schools.id, { onDelete: 'restrict' }),
  /** 登录账号（手机号），与统一身份平台的绑定字段并列 */
  phone: varchar('phone', { length: 40 }),
  name: varchar('name', { length: 120 }).notNull(),
  /** 本地账密登录哈希；仅 SSO 用户可为空 */
  passwordHash: text('password_hash'),
  /** 统一身份平台 subject，首次 SSO 登录时绑定；绑定后以它为准匹配账号 */
  oidcSubject: varchar('oidc_subject', { length: 255 }),
  role: varchar('role', { length: 30 }).notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  totpSecretEnc: text('totp_secret_enc'),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  disabledBy: uuid('disabled_by').references((): any => users.id),
  disabledReason: text('disabled_reason'),
  // ---- 教师业务档案（学校管理员维护）----
  employeeNo: varchar('employee_no', { length: 80 }),
  phoneEnc: text('phone_enc'),
  gender: varchar('gender', { length: 20 }),
  /** 任教年级 1-12，空数组表示不限 */
  teachingGrades: jsonb('teaching_grades').$type<number[]>().default([]).notNull(),
  subject: varchar('subject', { length: 80 }),
  isClassTeacher: boolean('is_class_teacher').default(false).notNull(),
  /** 班主任年限（年），教师身份画像必填项，学校管理员维护 */
  classTeacherYears: integer('class_teacher_years'),
  hiredAt: timestamp('hired_at', { withTimezone: true }),
  title: varchar('title', { length: 40 }),
  certNote: text('cert_note'),
  notesEnc: text('notes_enc'),
  // ---- 自我成长模块业务状态（评估提交时快照回写，管理员只读）----
  /** 最近一次自我状态评估等级（需转介/需关注/关注/良好），列表直接展示 */
  selfStatusLevel: varchar('self_status_level', { length: 40 }),
  /** 全量快照：五问维度分、心理资本四维分、命中归因、评估时间 */
  selfSnapshot: jsonb('self_snapshot').$type<Record<string, unknown>>().default({}).notNull(),
  /** 管理员手动修正（如修正状态等级），评估提交时以新评估为准并清除对应项 */
  overrides: jsonb('overrides').$type<Record<string, string>>().default({}).notNull(),
  ...timestamps
}, table => [
  uniqueIndex('users_phone_uidx').on(table.phone),
  uniqueIndex('users_oidc_subject_uidx').on(table.oidcSubject),
  index('users_school_role_idx').on(table.schoolId, table.role),
  index('users_school_role_status_idx').on(table.schoolId, table.role, table.status),
  uniqueIndex('users_school_employee_no_uidx').on(table.schoolId, table.employeeNo)
])

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  userAgent: text('user_agent'),
  ipAddress: varchar('ip_address', { length: 64 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('sessions_token_hash_uidx').on(table.tokenHash), index('sessions_user_idx').on(table.userId)])

export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').references(() => schools.id),
  phone: varchar('phone', { length: 40 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  role: varchar('role', { length: 30 }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  pendingPasswordHash: text('pending_password_hash'),
  pendingTotpSecretEnc: text('pending_totp_secret_enc'),
  pendingRecoveryCodeHashes: jsonb('pending_recovery_code_hashes').$type<string[]>(),
  invitedBy: uuid('invited_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('invitations_token_hash_uidx').on(table.tokenHash),
  index('invitations_school_phone_idx').on(table.schoolId, table.phone)
])

export const mfaRecoveryCodes = pgTable('mfa_recovery_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash: varchar('code_hash', { length: 64 }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('mfa_recovery_code_hash_uidx').on(table.codeHash), index('mfa_recovery_user_idx').on(table.userId)])

export const schoolSettings = pgTable('school_settings', {
  schoolId: uuid('school_id').primaryKey().references(() => schools.id, { onDelete: 'cascade' }),
  helpPhone: varchar('help_phone', { length: 40 }),
  smsRecipients: jsonb('sms_recipients').$type<string[]>().default([]).notNull(),
  referralPsychologistId: uuid('referral_psychologist_id').references(() => users.id),
  crisisGuide: text('crisis_guide').default('请立即联系校内心理专员；如存在即时危险，请拨打 110 或 120。').notNull(),
  safetyContactRecipients: jsonb('safety_contact_recipients').$type<string[]>().default([]).notNull(),
  aiDataMode: varchar('ai_data_mode', { length: 20 }).default('redacted').notNull(),
  aiApprovalReference: text('ai_approval_reference'),
  aiNoticeVersion: varchar('ai_notice_version', { length: 50 }).default('pilot-v1').notNull(),
  aiApprovedBy: uuid('ai_approved_by').references(() => users.id),
  aiApprovedAt: timestamp('ai_approved_at', { withTimezone: true }),
  referralAckMinutes: integer('referral_ack_minutes').default(5).notNull(),
  referralEscalationMinutes: integer('referral_escalation_minutes').default(15).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
})

export const adminAccessRequests = pgTable('admin_access_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  requesterId: uuid('requester_id').notNull().references(() => users.id),
  targetType: varchar('target_type', { length: 40 }).notNull(),
  targetId: uuid('target_id').notNull(),
  reasonCategory: varchar('reason_category', { length: 50 }).notNull(),
  reasonText: text('reason_text').notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  reviewerId: uuid('reviewer_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('access_requests_school_status_idx').on(table.schoolId, table.status)])

export const adminAccessGrants = pgTable('admin_access_grants', {
  id: uuid('id').defaultRandom().primaryKey(),
  requestId: uuid('request_id').notNull().references(() => adminAccessRequests.id, { onDelete: 'cascade' }),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  targetType: varchar('target_type', { length: 40 }).notNull(),
  targetId: uuid('target_id').notNull(),
  scope: jsonb('scope').$type<string[]>().default(['read']).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('access_grants_lookup_idx').on(table.userId, table.targetType, table.targetId)])

export const adminAccessEvents = pgTable('admin_access_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  actorId: uuid('actor_id').notNull().references(() => users.id),
  grantId: uuid('grant_id').references(() => adminAccessGrants.id),
  targetType: varchar('target_type', { length: 40 }).notNull(),
  targetId: uuid('target_id').notNull(),
  action: varchar('action', { length: 40 }).notNull(),
  path: text('path'),
  fields: jsonb('fields').$type<string[]>().default([]).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('access_events_school_created_idx').on(table.schoolId, table.createdAt)])

export const delegatedManagementGrants = pgTable('delegated_management_grants', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  requesterId: uuid('requester_id').notNull().references(() => users.id),
  reviewerId: uuid('reviewer_id').references(() => users.id),
  scopes: jsonb('scopes').$type<string[]>().default([]).notNull(),
  reason: text('reason').notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps
}, table => [
  index('delegated_management_school_status_idx').on(table.schoolId, table.status),
  index('delegated_management_requester_idx').on(table.requesterId, table.status)
])

export const departments = pgTable('departments', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'restrict' }),
  parentId: uuid('parent_id'),
  leaderUserId: uuid('leader_user_id').references(() => users.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 120 }).notNull(),
  code: varchar('code', { length: 80 }),
  type: varchar('type', { length: 30 }).default('other').notNull(),
  description: text('description'),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  // ---- 部门业务档案 ----
  shortName: varchar('short_name', { length: 40 }),
  /** 分管领域：grade_group 年级组 / subject_group 学科组 / moral_edu 德育 / psych_support 心理支持中心 / admin 行政后勤 / other */
  scope: varchar('scope', { length: 40 }).default('other').notNull(),
  leaderTitle: varchar('leader_title', { length: 80 }),
  location: varchar('location', { length: 200 }),
  phone: varchar('phone', { length: 40 }),
  headcountLimit: integer('headcount_limit'),
  sortOrder: integer('sort_order').default(0).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: uuid('archived_by').references(() => users.id),
  ...timestamps
}, table => [
  index('departments_school_status_idx').on(table.schoolId, table.status),
  index('departments_parent_idx').on(table.schoolId, table.parentId),
  uniqueIndex('departments_school_code_uidx').on(table.schoolId, table.code)
])

export const departmentMembers = pgTable('department_members', {
  departmentId: uuid('department_id').notNull().references(() => departments.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'restrict' }),
  memberRole: varchar('member_role', { length: 80 }),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('department_member_uidx').on(table.departmentId, table.userId, table.status),
  index('department_members_user_idx').on(table.schoolId, table.userId)
])

export const recordAssignments = pgTable('record_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  targetType: varchar('target_type', { length: 40 }).notNull(),
  targetId: uuid('target_id').notNull(),
  fromUserId: uuid('from_user_id').references(() => users.id),
  toUserId: uuid('to_user_id').notNull().references(() => users.id),
  assignedBy: uuid('assigned_by').references(() => users.id),
  reason: text('reason'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  index('record_assignments_school_created_idx').on(table.schoolId, table.createdAt),
  index('record_assignments_target_idx').on(table.targetType, table.targetId, table.createdAt)
])

export const classes = pgTable('classes', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
  // 语义：当前负责教师。保留 owner_user_id 列名是为了兼容既有迁移和接口。
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  name: varchar('name', { length: 120 }).notNull(),
  externalCode: varchar('external_code', { length: 80 }),
  grade: integer('grade').notNull(),
  studentCount: integer('student_count').default(0).notNull(),
  establishedAt: timestamp('established_at', { withTimezone: true }),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  dataClassification: varchar('data_classification', { length: 30 }).default('sensitive').notNull(),
  // ---- 班级业务档案（服务 class_system 模块）----
  section: varchar('section', { length: 20 }),
  classType: varchar('class_type', { length: 30 }).default('admin').notNull(),
  deputyOwnerUserId: uuid('deputy_owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  location: varchar('location', { length: 200 }),
  schoolYear: varchar('school_year', { length: 30 }),
  notesEnc: text('notes_enc'),
  // ---- 班级系统建设模块业务状态（评估提交时快照回写）----
  /** 能量场阶段：生存期/规范期/稳定期/未评估，列表直接展示 */
  energyStage: varchar('energy_stage', { length: 40 }),
  /** 全量快照：三能量分、五系统分、命中归因、评估时间 */
  classSnapshot: jsonb('class_snapshot').$type<Record<string, unknown>>().default({}).notNull(),
  /** 管理员手动修正（如修正能量场阶段），评估提交时以新评估为准并清除对应项 */
  overrides: jsonb('overrides').$type<Record<string, string>>().default({}).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: uuid('archived_by').references(() => users.id),
  ...timestamps
}, table => [
  index('classes_department_idx').on(table.schoolId, table.departmentId),
  index('classes_owner_idx').on(table.ownerUserId),
  index('classes_school_owner_status_updated_idx').on(table.schoolId, table.ownerUserId, table.status, table.updatedAt),
  uniqueIndex('classes_school_external_code_uidx').on(table.schoolId, table.externalCode)
])

export const students = pgTable('students', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  // 语义：当前负责教师。学生档案归属学校，可由学校管理员移交。
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  classId: uuid('class_id').references(() => classes.id, { onDelete: 'set null' }),
  nameEnc: text('name_enc').notNull(),
  nameSearch: varchar('name_search', { length: 64 }).notNull(),
  gender: varchar('gender', { length: 20 }),
  profileEnc: text('profile_enc'),
  notesEnc: text('notes_enc'),
  externalRefEnc: text('external_ref_enc'),
  externalRefSearch: varchar('external_ref_search', { length: 64 }),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  // ---- 学生业务档案（服务 student_case / learning_problem / home_school 模块）----
  birthDate: timestamp('birth_date', { withTimezone: true }),
  studentNoEnc: text('student_no_enc'),
  studentNoSearch: varchar('student_no_search', { length: 64 }),
  ethnicity: varchar('ethnicity', { length: 40 }),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }),
  boardingType: varchar('boarding_type', { length: 20 }),
  addressEnc: text('address_enc'),
  // ---- 学生个体/学习问题模块业务状态（评估提交时快照回写）----
  /** 最近一次个体支持等级：L3 专业会商/L2 年级协同/L1 教师关注 */
  caseLevel: varchar('case_level', { length: 40 }),
  /** 最近一次学习问题等级：LP0 危机转介/LP3 系统干预/LP2 深入诊断 */
  learningLevel: varchar('learning_level', { length: 40 }),
  /** 个体问题解决方案状态：unresolved 未解决（红点）/ in_progress 进行中（黄点）/ resolved 已解决（绿点） */
  caseSolutionStatus: varchar('case_solution_status', { length: 20 }).default('unresolved').notNull(),
  /** 全量快照：筛查维度分、三层诊断分、命中归因、评估时间 */
  studentSnapshot: jsonb('student_snapshot').$type<Record<string, unknown>>().default({}).notNull(),
  /** 管理员手动修正，评估提交时以新评估为准并清除对应项 */
  overrides: jsonb('overrides').$type<Record<string, string>>().default({}).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: uuid('archived_by').references(() => users.id),
  ...timestamps
}, table => [
  index('students_owner_idx').on(table.ownerUserId),
  index('students_name_search_idx').on(table.nameSearch),
  index('students_school_owner_status_updated_idx').on(table.schoolId, table.ownerUserId, table.status, table.updatedAt),
  uniqueIndex('students_school_external_ref_uidx').on(table.schoolId, table.externalRefSearch)
])

export const guardians = pgTable('guardians', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  // 语义：当前负责教师。家长档案归属学校，可随学生/班级移交。
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  nameEnc: text('name_enc').notNull(),
  nameSearch: varchar('name_search', { length: 64 }).notNull(),
  phoneEnc: text('phone_enc'),
  externalRefEnc: text('external_ref_enc'),
  externalRefSearch: varchar('external_ref_search', { length: 64 }),
  relation: varchar('relation', { length: 40 }),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  // ---- 家长业务档案（服务 home_school 模块）----
  occupation: varchar('occupation', { length: 80 }),
  workUnit: varchar('work_unit', { length: 200 }),
  contactEnc: text('contact_enc'),
  isPrimary: boolean('is_primary').default(false).notNull(),
  notesEnc: text('notes_enc'),
  /** 家校关系档案（jsonb 加密）：家长分型 P1-P5、家校关系等级 A-E、二期关联信息（工作坊/家长会/线上家长课/家长会商） */
  profileEnc: text('profile_enc'),
  // ---- 家校沟通模块业务状态（评估提交时快照回写）----
  /** 最近一次沟通风险等级：E 级保护通道/D 级高冲突/C 级需谨慎/无 */
  commRiskLevel: varchar('comm_risk_level', { length: 40 }),
  /** 全量快照：双维速查分、家长分型维度分、命中归因、评估时间 */
  guardianSnapshot: jsonb('guardian_snapshot').$type<Record<string, unknown>>().default({}).notNull(),
  /** 管理员手动修正，评估提交时以新评估为准并清除对应项 */
  overrides: jsonb('overrides').$type<Record<string, string>>().default({}).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: uuid('archived_by').references(() => users.id),
  ...timestamps
}, table => [
  index('guardians_owner_idx').on(table.ownerUserId),
  index('guardians_school_owner_status_updated_idx').on(table.schoolId, table.ownerUserId, table.status, table.updatedAt),
  uniqueIndex('guardians_school_external_ref_uidx').on(table.schoolId, table.externalRefSearch)
])

export const studentGuardians = pgTable('student_guardians', {
  studentId: uuid('student_id').notNull().references(() => students.id, { onDelete: 'restrict' }),
  guardianId: uuid('guardian_id').notNull().references(() => guardians.id, { onDelete: 'restrict' }),
  schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'restrict' }),
  /** 该家长对这个学生的关系（如：爸爸/叔叔），同一家长对不同学生可有不同关系 */
  relation: varchar('relation', { length: 40 }),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('student_guardian_uidx').on(table.studentId, table.guardianId),
  index('student_guardians_school_idx').on(table.schoolId)
])

export const chatSessions = pgTable('chat_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  title: varchar('title', { length: 200 }).default('新对话').notNull(),
  contextType: varchar('context_type', { length: 30 }).default('none').notNull(),
  contextId: uuid('context_id'),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: uuid('archived_by').references(() => users.id),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
}, table => [
  index('chat_sessions_owner_idx').on(table.ownerUserId),
  index('chat_sessions_context_idx').on(table.contextType, table.contextId)
])

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  sessionId: uuid('session_id').notNull().references(() => chatSessions.id, { onDelete: 'restrict' }),
  role: varchar('role', { length: 20 }).notNull(),
  contentEnc: text('content_enc').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('chat_messages_session_idx').on(table.sessionId, table.createdAt)])

export const routingDecisions = pgTable('routing_decisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  sessionId: uuid('session_id').notNull().references(() => chatSessions.id),
  primaryModule: varchar('primary_module', { length: 40 }).notNull(),
  secondaryModules: jsonb('secondary_modules').$type<Array<{ module: string, confidence: number }>>().default([]).notNull(),
  confidence: integer('confidence').notNull(),
  rationale: text('rationale').notNull(),
  confirmedModule: varchar('confirmed_module', { length: 40 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
})

export const assessmentAttempts = pgTable('assessment_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  module: varchar('module', { length: 40 }).notNull(),
  assessmentCode: varchar('assessment_code', { length: 80 }).notNull(),
  definitionVersion: varchar('definition_version', { length: 30 }).notNull(),
  status: varchar('status', { length: 20 }).default('draft').notNull(),
  answers: jsonb('answers').$type<Record<string, number | string | boolean>>().default({}).notNull(),
  result: jsonb('result').$type<Record<string, unknown>>(),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  ...timestamps
}, table => [index('assessment_owner_module_idx').on(table.ownerUserId, table.module)])

/**
 * 评估组：同一业务问题（同一次 AI 对话或同一咨询上下文）下连续评估过程的聚合载体。
 * 教师在该组内完成多张量表后，方案按提交顺序汇总展示（见 plan_assessment_attempts）。
 */
export const assessmentSessions = pgTable('assessment_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  module: varchar('module', { length: 40 }).notNull(),
  // assistant_dialogue | direct_assessment
  sourceType: varchar('source_type', { length: 30 }).notNull(),
  sourceChatSessionId: uuid('source_chat_session_id').references(() => chatSessions.id, { onDelete: 'set null' }),
  contextType: varchar('context_type', { length: 30 }).default('none').notNull(),
  contextId: uuid('context_id'),
  // open | completed
  status: varchar('status', { length: 20 }).default('open').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...timestamps
}, table => [
  index('assessment_sessions_owner_module_idx').on(table.ownerUserId, table.module),
  index('assessment_sessions_source_chat_idx').on(table.sourceChatSessionId)
])

/** 评估组内的量表提交记录，sequence 保证展示顺序稳定（先提交在前）。 */
export const assessmentSessionAttempts = pgTable('assessment_session_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  assessmentSessionId: uuid('assessment_session_id').notNull().references(() => assessmentSessions.id, { onDelete: 'cascade' }),
  assessmentAttemptId: uuid('assessment_attempt_id').notNull().references(() => assessmentAttempts.id, { onDelete: 'cascade' }).unique(),
  sequence: integer('sequence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('assessment_session_attempts_seq_uidx').on(table.assessmentSessionId, table.sequence),
  index('assessment_session_attempts_attempt_idx').on(table.assessmentAttemptId)
])

export const studentEvents = pgTable('student_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  studentId: uuid('student_id').notNull().references(() => students.id),
  eventType: varchar('event_type', { length: 30 }).notNull(), // 违纪/冲突/异常行为/学业波动/其他
  severity: varchar('severity', { length: 20 }).notNull(), // 低/中/高/严重
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  resolution: text('resolution'),
  status: varchar('status', { length: 20 }).default('open').notNull(), // open/resolved/closed
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: uuid('archived_by').references(() => users.id),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  ...timestamps
}, table => [
  index('student_events_student_idx').on(table.studentId),
  index('student_events_owner_idx').on(table.ownerUserId),
  index('student_events_school_idx').on(table.schoolId, table.occurredAt)
])

export const plans = pgTable('plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  // 语义：当前负责教师。方案报告归属学校业务档案，可移交给后续负责教师。
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  studentId: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
  classId: uuid('class_id').references(() => classes.id, { onDelete: 'set null' }),
  guardianId: uuid('guardian_id').references(() => guardians.id, { onDelete: 'set null' }),
  sourceChatSessionId: uuid('source_chat_session_id').references(() => chatSessions.id, { onDelete: 'set null' }),
  sourceAssessmentAttemptId: uuid('source_assessment_attempt_id').references(() => assessmentAttempts.id, { onDelete: 'set null' }),
  module: varchar('module', { length: 40 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  // ---- 方案来源与展示快照（生成时固化，不依赖三库当前发布版本）----
  // assistant_dialogue | direct_assessment；迁移按 source_chat_session_id 是否为空回填
  sourceType: varchar('source_type', { length: 30 }),
  /** AI 来源的脱敏提问首句（varchar 200，生成时截断） */
  sourceQuestionSummary: varchar('source_question_summary', { length: 200 }),
  /** 标题全文，列表 tooltip 展示；title 是 200 截断的展示值 */
  titleFull: text('title_full'),
  /** 归因关键词按序去重快照（生成时取前 5） */
  attributionKeywords: jsonb('attribution_keywords').$type<string[]>().default([]).notNull(),
  /** 量表快照 [{ code, name, version, sequence }]，列表/详情直接投影 */
  instrumentSnapshots: jsonb('instrument_snapshots').$type<Array<{ code: string, name: string, version: string, sequence: number }>>().default([]).notNull(),
  summaryEnc: text('summary_enc').notNull(),
  actions: jsonb('actions').$type<Array<{ title: string, detail: string, status: string }>>().default([]).notNull(),
  tools: jsonb('tools').$type<Array<{ title: string, content: string }>>().default([]).notNull(),
  report: jsonb('report').$type<Record<string, unknown>>().default({}).notNull(),
  sourceVersions: jsonb('source_versions').$type<string[]>().default([]).notNull(),
  status: varchar('status', { length: 30 }).default('in_progress').notNull(),
  acceptanceDecision: varchar('acceptance_decision', { length: 30 }),
  acceptanceReasonEnc: text('acceptance_reason_enc'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  matchedRuleIds: jsonb('matched_rule_ids').$type<string[]>().default([]).notNull(),
  matchedToolCodes: jsonb('matched_tool_codes').$type<string[]>().default([]).notNull(),
  sourceResourceVersionIds: jsonb('source_resource_version_ids').$type<string[]>().default([]).notNull(),
  nextReviewAt: timestamp('next_review_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  ...timestamps
}, table => [
  index('plans_owner_idx').on(table.ownerUserId, table.module),
  index('plans_student_idx').on(table.studentId),
  index('plans_class_idx').on(table.classId),
  index('plans_guardian_idx').on(table.guardianId),
  index('plans_source_chat_idx').on(table.sourceChatSessionId)
])

/** 方案与评估提交的多对多关系（一次方案可汇总多张量表，按 sequence 保序）。 */
export const planAssessmentAttempts = pgTable('plan_assessment_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  assessmentAttemptId: uuid('assessment_attempt_id').notNull().references(() => assessmentAttempts.id, { onDelete: 'cascade' }).unique(),
  sequence: integer('sequence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('plan_assessment_attempts_seq_uidx').on(table.planId, table.sequence),
  index('plan_assessment_attempts_attempt_idx').on(table.assessmentAttemptId)
])

export const planActions = pgTable('plan_actions', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  sequence: integer('sequence').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  detail: text('detail').notNull(),
  status: varchar('status', { length: 30 }).default('pending').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  executionNote: text('execution_note'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  blockedAt: timestamp('blocked_at', { withTimezone: true }),
  blockReason: varchar('block_reason', { length: 40 }),
  blockNoteEnc: text('block_note_enc'),
  evidenceType: varchar('evidence_type', { length: 40 }).default('none').notNull(),
  evidenceSummaryEnc: text('evidence_summary_enc'),
  teacherConfidence: integer('teacher_confidence'),
  ...timestamps
}, table => [
  uniqueIndex('plan_actions_plan_sequence_uidx').on(table.planId, table.sequence),
  index('plan_actions_owner_due_idx').on(table.ownerUserId, table.status, table.dueAt)
])

export const planReviews = pgTable('plan_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  reviewAt: timestamp('review_at', { withTimezone: true }).defaultNow().notNull(),
  effectScore: integer('effect_score').notNull(),
  progressNote: text('progress_note').notNull(),
  nextAction: text('next_action').notNull(),
  decision: varchar('decision', { length: 40 }).default('continue_plan').notNull(),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  index('plan_reviews_plan_created_idx').on(table.planId, table.createdAt),
  index('plan_reviews_owner_idx').on(table.ownerUserId, table.reviewAt)
])

export const planFeedback = pgTable('plan_feedback', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  actionId: uuid('action_id').references(() => planActions.id, { onDelete: 'set null' }),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  module: varchar('module', { length: 40 }),
  ruleIds: jsonb('rule_ids').$type<string[]>().default([]).notNull(),
  toolCodes: jsonb('tool_codes').$type<string[]>().default([]).notNull(),
  sourceResourceVersionIds: jsonb('source_resource_version_ids').$type<string[]>().default([]).notNull(),
  attributionAccuracy: integer('attribution_accuracy').notNull(),
  toolUsability: integer('tool_usability').notNull(),
  scriptNaturalness: integer('script_naturalness').notNull(),
  actionDifficulty: integer('action_difficulty').notNull(),
  reviewUsefulness: integer('review_usefulness').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]).notNull(),
  noteEnc: text('note_enc'),
  dataClassification: varchar('data_classification', { length: 30 }).default('sensitive').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  index('plan_feedback_plan_idx').on(table.planId, table.createdAt),
  index('plan_feedback_owner_idx').on(table.ownerUserId, table.createdAt),
  index('plan_feedback_module_idx').on(table.schoolId, table.module, table.createdAt)
])

export const planOperationEvents = pgTable('plan_operation_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  actionId: uuid('action_id').references(() => planActions.id, { onDelete: 'set null' }),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  eventType: varchar('event_type', { length: 60 }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, string | number | boolean | null>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  index('plan_operation_events_school_type_idx').on(table.schoolId, table.eventType, table.createdAt),
  index('plan_operation_events_plan_idx').on(table.planId, table.createdAt)
])

export const communications = pgTable('communications', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  guardianId: uuid('guardian_id').references(() => guardians.id, { onDelete: 'set null' }),
  studentId: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
  summaryEnc: text('summary_enc').notNull(),
  parentType: varchar('parent_type', { length: 20 }),
  attitudeType: varchar('attitude_type', { length: 20 }),
  containerLevel: integer('container_level'),
  riskLevel: varchar('risk_level', { length: 20 }),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: uuid('archived_by').references(() => users.id),
  ...timestamps
}, table => [
  index('communications_school_owner_status_updated_idx').on(table.schoolId, table.ownerUserId, table.status, table.updatedAt)
])

export const contentPackages = pgTable('content_packages', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 80 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  version: varchar('version', { length: 40 }).notNull(),
  type: varchar('type', { length: 40 }).notNull(),
  status: varchar('status', { length: 20 }).default('draft').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}).notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  publishedBy: uuid('published_by').references(() => users.id),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  ...timestamps
}, table => [uniqueIndex('content_package_code_version_uidx').on(table.code, table.version)])

export const moduleResourceLibraries = pgTable('module_resource_libraries', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  module: varchar('module', { length: 40 }).notNull(),
  libraryType: varchar('library_type', { length: 40 }).notNull(),
  scope: varchar('scope', { length: 20 }).default('global').notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  description: text('description'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  ...timestamps
}, table => [
  index('module_resource_libraries_lookup_idx').on(table.module, table.libraryType, table.scope, table.schoolId),
  index('module_resource_libraries_school_idx').on(table.schoolId, table.module)
])

export const moduleResourceVersions = pgTable('module_resource_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  libraryId: uuid('library_id').notNull().references(() => moduleResourceLibraries.id, { onDelete: 'cascade' }),
  version: varchar('version', { length: 40 }).notNull(),
  status: varchar('status', { length: 20 }).default('draft').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}).notNull(),
  notes: text('notes'),
  sourceContentPackageId: uuid('source_content_package_id').references(() => contentPackages.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  publishedBy: uuid('published_by').references(() => users.id),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('module_resource_versions_library_version_uidx').on(table.libraryId, table.version),
  index('module_resource_versions_library_status_idx').on(table.libraryId, table.status)
])

export const moduleResourceDocuments = pgTable('module_resource_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  libraryId: uuid('library_id').references(() => moduleResourceLibraries.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').references(() => moduleResourceVersions.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull(),
  sourceType: varchar('source_type', { length: 30 }).notNull(),
  originalFilename: varchar('original_filename', { length: 260 }),
  mimeType: varchar('mime_type', { length: 120 }),
  checksum: varchar('checksum', { length: 64 }).notNull(),
  status: varchar('status', { length: 20 }).default('draft').notNull(),
  content: text('content').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  ...timestamps
}, table => [
  uniqueIndex('module_resource_documents_version_checksum_uidx').on(table.versionId, table.checksum),
  index('module_resource_documents_version_idx').on(table.versionId),
  index('module_resource_documents_library_idx').on(table.libraryId)
])

export const moduleResourceChunks = pgTable('module_resource_chunks', {
  id: uuid('id').defaultRandom().primaryKey(),
  libraryId: uuid('library_id').references(() => moduleResourceLibraries.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').references(() => moduleResourceVersions.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => moduleResourceDocuments.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  heading: varchar('heading', { length: 300 }),
  content: text('content').notNull(),
  tokenEstimate: integer('token_estimate').notNull(),
  embedding: vector1024('embedding'),
  embeddingModel: varchar('embedding_model', { length: 120 }),
  embeddedAt: timestamp('embedded_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('module_resource_chunks_document_index_uidx').on(table.documentId, table.chunkIndex),
  index('module_resource_chunks_version_idx').on(table.versionId),
  index('module_resource_chunks_library_idx').on(table.libraryId),
  index('module_resource_chunks_document_idx').on(table.documentId)
])

export const moduleResourceAssessmentItems = pgTable('module_resource_assessment_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  libraryId: uuid('library_id').notNull().references(() => moduleResourceLibraries.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => moduleResourceVersions.id, { onDelete: 'cascade' }),
  module: varchar('module', { length: 40 }).notNull(),
  scope: varchar('scope', { length: 20 }).notNull(),
  schoolId: uuid('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  instrumentCode: varchar('instrument_code', { length: 80 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  questionCount: integer('question_count').default(0).notNull(),
  dimensions: jsonb('dimensions').$type<string[]>().default([]).notNull(),
  scoringKeys: jsonb('scoring_keys').$type<string[]>().default([]).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('module_resource_assessment_items_version_code_uidx').on(table.versionId, table.instrumentCode),
  index('module_resource_assessment_items_lookup_idx').on(table.module, table.scope, table.schoolId),
  index('module_resource_assessment_items_library_idx').on(table.libraryId)
])

export const moduleResourceAttributionRules = pgTable('module_resource_attribution_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  libraryId: uuid('library_id').notNull().references(() => moduleResourceLibraries.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => moduleResourceVersions.id, { onDelete: 'cascade' }),
  module: varchar('module', { length: 40 }).notNull(),
  scope: varchar('scope', { length: 20 }).notNull(),
  schoolId: uuid('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  ruleId: varchar('rule_id', { length: 120 }).notNull(),
  priority: integer('priority').notNull(),
  level: varchar('level', { length: 80 }).notNull(),
  blocked: boolean('blocked').default(false).notNull(),
  hasCondition: boolean('has_condition').default(false).notNull(),
  severity: varchar('severity', { length: 20 }).notNull(),
  assessmentCode: varchar('assessment_code', { length: 40 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('module_resource_attribution_rules_version_rule_uidx').on(table.versionId, table.ruleId),
  index('module_resource_attribution_rules_lookup_idx').on(table.module, table.scope, table.schoolId),
  index('module_resource_attribution_rules_level_idx').on(table.level, table.blocked),
  index('module_resource_attribution_rules_library_idx').on(table.libraryId)
])

/** 归因项投影。运营台按归因检索工具、核对证据覆盖的入口。 */
export const moduleResourceAttributionItems = pgTable('module_resource_attribution_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  libraryId: uuid('library_id').notNull().references(() => moduleResourceLibraries.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => moduleResourceVersions.id, { onDelete: 'cascade' }),
  module: varchar('module', { length: 40 }).notNull(),
  scope: varchar('scope', { length: 20 }).notNull(),
  schoolId: uuid('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  attributionCode: varchar('attribution_code', { length: 80 }).notNull(),
  attributionName: varchar('attribution_name', { length: 120 }).notNull(),
  baseWeight: real('base_weight').default(1).notNull(),
  toolTags: jsonb('tool_tags').$type<string[]>().default([]).notNull(),
  evidenceCount: integer('evidence_count').default(0).notNull(),
  assessmentCodes: jsonb('assessment_codes').$type<string[]>().default([]).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('module_resource_attribution_items_version_code_uidx').on(table.versionId, table.attributionCode),
  index('module_resource_attribution_items_lookup_idx').on(table.module, table.scope, table.schoolId),
  index('module_resource_attribution_items_library_idx').on(table.libraryId)
])

export const moduleResourceToolItems = pgTable('module_resource_tool_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  libraryId: uuid('library_id').notNull().references(() => moduleResourceLibraries.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => moduleResourceVersions.id, { onDelete: 'cascade' }),
  module: varchar('module', { length: 40 }).notNull(),
  scope: varchar('scope', { length: 20 }).notNull(),
  schoolId: uuid('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  toolCode: varchar('tool_code', { length: 80 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  form: varchar('form', { length: 100 }).notNull(),
  severity: varchar('severity', { length: 40 }),
  level: varchar('level', { length: 40 }),
  primaryAttribution: varchar('primary_attribution', { length: 120 }),
  attributions: jsonb('attributions').$type<string[]>().default([]).notNull(),
  tags: jsonb('tags').$type<string[]>().default([]).notNull(),
  toolTags: jsonb('tool_tags').$type<string[]>().default([]).notNull(),
  dimensions: jsonb('dimensions').$type<string[]>().default([]).notNull(),
  stepCount: integer('step_count').default(0).notNull(),
  hasScript: boolean('has_script').default(false).notNull(),
  hasProhibitions: boolean('has_prohibitions').default(false).notNull(),
  hasExpectedEffect: boolean('has_expected_effect').default(false).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('module_resource_tool_items_version_code_uidx').on(table.versionId, table.toolCode),
  index('module_resource_tool_items_lookup_idx').on(table.module, table.scope, table.schoolId),
  index('module_resource_tool_items_match_idx').on(table.form, table.severity, table.level),
  index('module_resource_tool_items_library_idx').on(table.libraryId)
])

export const aiModelCalls = pgTable('ai_model_calls', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').references(() => schools.id),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  sessionId: uuid('session_id').references(() => chatSessions.id, { onDelete: 'set null' }),
  provider: varchar('provider', { length: 40 }).notNull(),
  model: varchar('model', { length: 120 }).notNull(),
  purpose: varchar('purpose', { length: 50 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  latencyMs: integer('latency_ms'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  errorCode: varchar('error_code', { length: 80 }),
  dataMode: varchar('data_mode', { length: 20 }),
  contextType: varchar('context_type', { length: 30 }),
  noticeVersion: varchar('notice_version', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('ai_model_calls_school_created_idx').on(table.schoolId, table.createdAt)])

export const safetyEvents = pgTable('safety_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  sourceType: varchar('source_type', { length: 40 }).notNull(),
  sourceId: uuid('source_id'),
  severity: varchar('severity', { length: 20 }).notNull(),
  matchedRules: jsonb('matched_rules').$type<string[]>().default([]).notNull(),
  summaryEnc: text('summary_enc').notNull(),
  status: varchar('status', { length: 30 }).default('open').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('safety_school_status_idx').on(table.schoolId, table.status)])

export const referrals = pgTable('referrals', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  safetyEventId: uuid('safety_event_id').notNull().references(() => safetyEvents.id),
  psychologistId: uuid('psychologist_id').references(() => users.id),
  priority: varchar('priority', { length: 20 }).default('urgent').notNull(),
  status: varchar('status', { length: 30 }).default('created').notNull(),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  // 兼容迁移前工单；新建工单必须写入两个 SLA 时间点。
  acknowledgeDueAt: timestamp('acknowledge_due_at', { withTimezone: true }),
  escalationDueAt: timestamp('escalation_due_at', { withTimezone: true }),
  escalatedAt: timestamp('escalated_at', { withTimezone: true }),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  handlingNoteEnc: text('handling_note_enc'),
  closureReason: varchar('closure_reason', { length: 80 }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('referral_psych_status_idx').on(table.psychologistId, table.status)])

export const referralEvents = pgTable('referral_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  referralId: uuid('referral_id').notNull().references(() => referrals.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id),
  eventType: varchar('event_type', { length: 40 }).notNull(),
  fromStatus: varchar('from_status', { length: 30 }),
  toStatus: varchar('to_status', { length: 30 }),
  noteEnc: text('note_enc'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('referral_events_referral_created_idx').on(table.referralId, table.createdAt)])

export const userConsents = pgTable('user_consents', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  noticeVersion: varchar('notice_version', { length: 50 }).notNull(),
  dataMode: varchar('data_mode', { length: 20 }).notNull(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('user_consents_user_notice_mode_uidx').on(table.userId, table.noticeVersion, table.dataMode)])

export const schoolImports = pgTable('school_imports', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  importType: varchar('import_type', { length: 30 }).notNull(),
  checksum: varchar('checksum', { length: 64 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  totalRows: integer('total_rows').default(0).notNull(),
  createdRows: integer('created_rows').default(0).notNull(),
  updatedRows: integer('updated_rows').default(0).notNull(),
  skippedRows: integer('skipped_rows').default(0).notNull(),
  errorCount: integer('error_count').default(0).notNull(),
  errors: jsonb('errors').$type<Array<{ row: number, code: string }>>().default([]).notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('school_imports_school_created_idx').on(table.schoolId, table.createdAt)])

export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 40 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  body: text('body').notNull(),
  targetType: varchar('target_type', { length: 40 }),
  targetId: uuid('target_id'),
  deduplicationKey: varchar('deduplication_key', { length: 180 }).notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('notifications_dedupe_uidx').on(table.deduplicationKey),
  index('notifications_user_read_created_idx').on(table.userId, table.readAt, table.createdAt)
])

export const assistantFeedback = pgTable('assistant_feedback', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  sessionId: uuid('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').notNull().references(() => chatMessages.id, { onDelete: 'cascade' }),
  rating: varchar('rating', { length: 20 }).notNull(),
  reasons: jsonb('reasons').$type<string[]>().default([]).notNull(),
  commentEnc: text('comment_enc'),
  ...timestamps
}, table => [uniqueIndex('assistant_feedback_user_message_uidx').on(table.userId, table.messageId)])

export const productEvents = pgTable('product_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').references(() => schools.id),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  eventName: varchar('event_name', { length: 80 }).notNull(),
  targetType: varchar('target_type', { length: 40 }),
  targetId: uuid('target_id'),
  metadata: jsonb('metadata').$type<Record<string, string | number | boolean | null>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('product_events_school_name_created_idx').on(table.schoolId, table.eventName, table.createdAt)])

export const notificationOutbox = pgTable('notification_outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  deduplicationKey: varchar('deduplication_key', { length: 160 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('notification_dedupe_uidx').on(table.deduplicationKey),
  index('notification_pending_idx').on(table.status, table.nextAttemptAt)
])

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').references(() => schools.id),
  actorId: uuid('actor_id').references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  targetType: varchar('target_type', { length: 50 }),
  targetId: uuid('target_id'),
  result: varchar('result', { length: 20 }).default('success').notNull(),
  ipAddress: varchar('ip_address', { length: 64 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('audit_school_created_idx').on(table.schoolId, table.createdAt)])

/**
 * AI 提示词模板库（AI 管理中心）。
 * 每个 code 一行：template 为草稿/编辑中内容，published 为已发布生效内容。
 * published 为 null 时运行时使用代码内置提示词（PROMPT_BUILTINS），行为与未启用管理前一致。
 */
export const aiPromptTemplates = pgTable('ai_prompt_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 80 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  template: text('template').notNull(),
  published: text('published'),
  placeholders: jsonb('placeholders').$type<Array<{ key: string, label: string, description?: string }>>().default([]).notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  publishedBy: uuid('published_by').references(() => users.id),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  ...timestamps
}, table => [uniqueIndex('ai_prompt_templates_code_uidx').on(table.code)])

/** AI 运行时配置（AI 管理中心）。单行记录，字段为 NULL 时回落环境变量默认值。 */
export const aiRuntimeSettings = pgTable('ai_runtime_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  routerModel: varchar('router_model', { length: 80 }),
  generatorModel: varchar('generator_model', { length: 80 }),
  timeoutMs: integer('timeout_ms'),
  embeddingModel: varchar('embedding_model', { length: 80 }),
  embeddingEnabled: boolean('embedding_enabled'),
  updatedBy: uuid('updated_by').references(() => users.id),
  ...timestamps
})

/**
 * 班级事件（服务 class_system 模块）：德育或班级重点事件。
 * 与 student_events 并列：学生事件挂在学生上，班级事件挂在班级上。
 */
export const classEvents = pgTable('class_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  classId: uuid('class_id').notNull().references(() => classes.id),
  eventType: varchar('event_type', { length: 30 }).notNull(), // 德育活动/班级冲突/集体异常/班级建设/其他
  severity: varchar('severity', { length: 20 }).notNull(), // 低/中/高/严重
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  resolution: text('resolution'),
  status: varchar('status', { length: 20 }).default('open').notNull(), // open/resolved/closed
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: uuid('archived_by').references(() => users.id),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  ...timestamps
}, table => [
  index('class_events_class_idx').on(table.classId),
  index('class_events_owner_idx').on(table.ownerUserId),
  index('class_events_school_idx').on(table.schoolId, table.occurredAt)
])
