import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core'

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
  email: varchar('email', { length: 254 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 30 }).notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  totpSecretEnc: text('totp_secret_enc'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('users_email_uidx').on(table.email),
  index('users_school_role_idx').on(table.schoolId, table.role)
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
  email: varchar('email', { length: 254 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  role: varchar('role', { length: 30 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  invitedBy: uuid('invited_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
})

export const schoolSettings = pgTable('school_settings', {
  schoolId: uuid('school_id').primaryKey().references(() => schools.id, { onDelete: 'cascade' }),
  helpPhone: varchar('help_phone', { length: 40 }),
  smsRecipients: jsonb('sms_recipients').$type<string[]>().default([]).notNull(),
  referralPsychologistId: uuid('referral_psychologist_id').references(() => users.id),
  crisisGuide: text('crisis_guide').default('请立即联系校内心理专员；如存在即时危险，请拨打 110 或 120。').notNull(),
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

export const classes = pgTable('classes', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  name: varchar('name', { length: 120 }).notNull(),
  grade: integer('grade').notNull(),
  studentCount: integer('student_count').default(0).notNull(),
  establishedAt: timestamp('established_at', { withTimezone: true }),
  dataClassification: varchar('data_classification', { length: 30 }).default('sensitive').notNull(),
  ...timestamps
}, table => [index('classes_owner_idx').on(table.ownerUserId)])

export const students = pgTable('students', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  classId: uuid('class_id').references(() => classes.id, { onDelete: 'set null' }),
  nameEnc: text('name_enc').notNull(),
  nameSearch: varchar('name_search', { length: 64 }).notNull(),
  gender: varchar('gender', { length: 20 }),
  notesEnc: text('notes_enc'),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  ...timestamps
}, table => [index('students_owner_idx').on(table.ownerUserId), index('students_name_search_idx').on(table.nameSearch)])

export const guardians = pgTable('guardians', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  nameEnc: text('name_enc').notNull(),
  nameSearch: varchar('name_search', { length: 64 }).notNull(),
  phoneEnc: text('phone_enc'),
  relation: varchar('relation', { length: 40 }),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  ...timestamps
}, table => [index('guardians_owner_idx').on(table.ownerUserId)])

export const studentGuardians = pgTable('student_guardians', {
  studentId: uuid('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  guardianId: uuid('guardian_id').notNull().references(() => guardians.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('student_guardian_uidx').on(table.studentId, table.guardianId)])

export const chatSessions = pgTable('chat_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  title: varchar('title', { length: 200 }).default('新对话').notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  ...timestamps
}, table => [index('chat_sessions_owner_idx').on(table.ownerUserId)])

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  sessionId: uuid('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
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

export const moduleCases = pgTable('module_cases', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  module: varchar('module', { length: 40 }).notNull(),
  subjectType: varchar('subject_type', { length: 30 }),
  subjectId: uuid('subject_id'),
  title: varchar('title', { length: 200 }).notNull(),
  descriptionEnc: text('description_enc'),
  classification: jsonb('classification').$type<Record<string, unknown>>().default({}).notNull(),
  status: varchar('status', { length: 30 }).default('active').notNull(),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  ...timestamps
}, table => [index('module_cases_owner_idx').on(table.ownerUserId, table.module)])

export const plans = pgTable('plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  caseId: uuid('case_id').references(() => moduleCases.id, { onDelete: 'set null' }),
  module: varchar('module', { length: 40 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  summaryEnc: text('summary_enc').notNull(),
  actions: jsonb('actions').$type<Array<{ title: string, detail: string, status: string }>>().default([]).notNull(),
  tools: jsonb('tools').$type<Array<{ title: string, content: string }>>().default([]).notNull(),
  sourceVersions: jsonb('source_versions').$type<string[]>().default([]).notNull(),
  status: varchar('status', { length: 30 }).default('in_progress').notNull(),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  ...timestamps
}, table => [index('plans_owner_idx').on(table.ownerUserId, table.module)])

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
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  dataClassification: varchar('data_classification', { length: 30 }).default('highly_sensitive').notNull(),
  ...timestamps
})

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

export const knowledgeBases = pgTable('knowledge_bases', {
  id: uuid('id').defaultRandom().primaryKey(),
  schoolId: uuid('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 160 }).notNull(),
  description: text('description'),
  scope: varchar('scope', { length: 20 }).default('global').notNull(),
  status: varchar('status', { length: 20 }).default('draft').notNull(),
  version: integer('version').default(1).notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  publishedBy: uuid('published_by').references(() => users.id),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  ...timestamps
}, table => [
  index('knowledge_bases_scope_status_idx').on(table.scope, table.status),
  index('knowledge_bases_school_status_idx').on(table.schoolId, table.status)
])

export const knowledgeDocuments = pgTable('knowledge_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBases.id, { onDelete: 'cascade' }),
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
  uniqueIndex('knowledge_documents_base_checksum_uidx').on(table.knowledgeBaseId, table.checksum),
  index('knowledge_documents_base_idx').on(table.knowledgeBaseId)
])

export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: uuid('id').defaultRandom().primaryKey(),
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  heading: varchar('heading', { length: 300 }),
  content: text('content').notNull(),
  tokenEstimate: integer('token_estimate').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('knowledge_chunks_document_index_uidx').on(table.documentId, table.chunkIndex),
  index('knowledge_chunks_base_idx').on(table.knowledgeBaseId),
  index('knowledge_chunks_document_idx').on(table.documentId)
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
  status: varchar('status', { length: 30 }).default('created').notNull(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  handlingNoteEnc: text('handling_note_enc'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('referral_psych_status_idx').on(table.psychologistId, table.status)])

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
