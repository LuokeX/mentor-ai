type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

const fallbackText = (value?: string | null) => value || '—'

const labels = {
  module: {
    self_growth: '自我成长',
    class_system: '班级系统',
    home_school: '家校沟通',
    student_case: '学生个案',
    learning_problem: '学习问题'
  },
  libraryType: {
    assessment: '量表库',
    attribution: '归因库',
    tool: '工具库',
    output_template: '输出模板',
    keyword_route: '关键词路由'
  },
  resourceScope: {
    global: '平台默认',
    school: '校本覆盖'
  },
  resourceStatus: {
    draft: '草稿',
    published: '已发布',
    retired: '已停用',
    pending_review: '待验证',
    ready: '已就绪'
  },
  /** 学生个体问题·预警级别（student_case 评估等级，文档口径） */
  caseLevel: {
    '红色-紧急响应': '红色·紧急响应',
    '橙色-高响应': '橙色·高响应',
    '黄色-中响应': '黄色·中响应',
    '蓝色-低风险': '蓝色·低风险',
    '紫色-待观察': '紫色·待观察'
  },
  /** 个体问题解决方案状态（绿/黄/红点） */
  caseSolutionStatus: {
    unresolved: '未解决',
    in_progress: '进行中',
    resolved: '已解决'
  },
  /** 班级系统·四阶当前阶段（class_system 评估等级） */
  classStage: {
    '安全危机·立即上报': '安全危机·立即上报',
    '秩序奠基期': '秩序奠基期',
    '关系激活期': '关系激活期',
    '制度自转期': '制度自转期',
    '文化生成期': '文化生成期'
  },
  /** 学习问题·严重程度（learning_problem 评估等级，L1 最重 → L5 最轻） */
  learningLevel: {
    L1: 'L1·最重',
    L2: 'L2·重',
    L3: 'L3·中',
    L4: 'L4·轻',
    L5: 'L5·最轻'
  },
  /** 家校沟通·沟通风险等级（home_school 评估等级，五色口径） */
  commRiskLevel: {
    red: '红色·极重·危机',
    orange: '橙色·明显问题',
    yellow: '黄色·关注',
    blue: '蓝色·轻微',
    green: '绿色·平稳'
  },
  planStatus: {
    pending_acceptance: '待确认',
    accepted: '已接受',
    in_progress: '进行中',
    review_due: '待复盘',
    adjustment_needed: '需调整',
    escalated: '已升级',
    completed: '已完成',
    closed: '已关闭',
    archived: '已归档',
    active: '进行中'
  },
  actionStatus: {
    pending: '待开始',
    in_progress: '进行中',
    completed: '已完成',
    blocked: '受阻',
    skipped: '已跳过',
    cancelled: '已取消',
    done: '已完成'
  },
  assessmentStatus: {
    draft: '草稿',
    submitted: '已提交'
  },
  referralStatus: {
    created: '待确认',
    escalated: '已升级',
    acknowledged: '处理中',
    offline_handling: '线下处置',
    closed: '已关闭',
    handling_started: '开始处置'
  },
  priority: {
    critical: '紧急',
    urgent: '加急',
    normal: '普通',
    low: '低优先级'
  },
  severity: {
    critical: '危急',
    high: '高',
    medium: '中',
    low: '低'
  },
  accessStatus: {
    pending: '待审批',
    approved: '已批准',
    rejected: '已拒绝',
    revoked: '已撤销',
    expired: '已过期'
  },
  accountStatus: {
    active: '已激活',
    disabled: '已停用',
    invited: '待激活'
  },
  schoolStatus: {
    active: '启用',
    disabled: '停用'
  },
  targetType: {
    teacher_profile: '教师档案',
    assessment: '评估记录',
    conversation: 'AI 对话',
    student_case: '学生个案',
    guardian_communication: '家校沟通',
    plan: '干预方案',
    student: '学生',
    class: '班级',
    guardian: '家长',
    users: '用户',
    teachers: '教师',
    departments: '部门',
    classes: '班级',
    students: '学生',
    guardians: '家长',
    communication: '沟通记录',
    referral: '转介工单',
    safety_event: '安全事件',
    school: '学校',
    user: '用户',
    department: '部门',
    content_package: '内容包',
    module_resource_library: '三库资源',
    module_resource_version: '三库版本',
    module_resource_document: '资源文档',
    student_event: '学生事件'
  },
  reasonCategory: {
    risk_review: '风险复核',
    complaint_handling: '投诉处理',
    data_correction_verification: '数据订正核验',
    school_duty: '学校职责',
    other: '其他'
  },
  recordStatus: {
    active: '进行中',
    archived: '已归档',
    closed: '已关闭',
    disabled: '已停用',
    invited: '待激活',
    graduated: '已毕业',
    transferred: '已转出',
    open: '待处理',
    resolved: '已处置',
    completed: '已完成'
  },
  riskLevel: {
    crisis: '危机',
    high: '高风险',
    medium: '中风险',
    low: '低风险'
  },
  sourceType: {
    chat: 'AI 分诊',
    assessment: '量表评估',
    manual: '人工创建',
    local_rule: '本地规则',
    semantic: '语义识别'
  },
  parentType: {
    father: '父亲',
    mother: '母亲',
    guardian: '监护人',
    other: '其他'
  },
  attitudeType: {
    cooperative: '合作',
    neutral: '中立',
    resistant: '抵触'
  },
  reviewDecision: {
    continue_plan: '继续原方案',
    revise_plan: '调整方案',
    escalate: '升级协同',
    close_plan: '结束方案'
  },
  auditAction: {
    'auth.login': '登录',
    'auth.logout': '退出登录',
    'auth.account_activated': '账号激活',
    'school_admin.user.create': '创建校内账号',
    'school_admin.user.update': '更新校内账号',
    'school_admin.user.delete': '删除校内账号',
    'school_admin.department.create': '创建部门',
    'school_admin.department.update': '更新部门',
    'school_admin.department.member.add': '添加部门成员',
    'school_admin.department.member.remove': '移除部门成员',
    'school_admin.class.create': '创建班级',
    'school_admin.class.update': '更新班级',
    'school_admin.student.create': '创建学生',
    'school_admin.student.update': '更新学生',
    'school_admin.student.class.update': '调整学生班级',
    'school_admin.student.owner.update': '调整学生负责人',
    'school_admin.student_guardian.link': '关联学生家长',
    'school_admin.student_guardian.unlink': '解除学生家长关联',
    'school_admin.guardian.update': '更新家长',
    'school_admin.information.assign': '调整档案负责人',
    'school_admin.settings.update': '更新学校设置',
    'school_admin.import.commit': '提交批量导入',
    'platform_admin.school.create': '创建学校',
    'platform_admin.school_admin.invite': '邀请学校管理员',
    'platform_admin.delegated_management.request': '申请平台代管',
    'platform_admin.module_resource_library.create': '创建三库资源',
    'platform_admin.module_resource_version.create': '创建三库版本',
    'platform_admin.module_resource_document.import': '导入资源文档',
    'platform_admin.module_resource.import': '导入三库数据',
    'content.create': '创建内容包',
    'content.publish': '发布内容包',
    'content.retire': '停用内容包',
    'content.rollback': '回滚内容包',
    'admin_access.request.approved': '批准应急访问',
    'admin_access.request.rejected': '拒绝应急访问',
    'assessment.submit': '提交评估',
    'plan.status.update': '更新方案状态',
    'plan.acceptance.update': '更新方案确认',
    'plan.action.update': '更新行动项',
    'plan.review.create': '创建方案复盘',
    'plan.feedback.create': '提交方案反馈',
    'plan.ai_suggestion.confirm': '确认 AI 方案建议',
    'referral.reassign': '转派转介工单',
    'information.export': '导出信息档案',
    'information.student.update': '更新学生档案',
    'information.guardian.update': '更新家长档案',
    'information.student.communication.create': '新增学生沟通',
    'information.guardian.communication.create': '新增家长沟通',
    'information.student.guardian.link': '关联学生家长',
    'information.student.guardian.unlink': '解除学生家长关联',
    'information.guardian.student.link': '关联家长学生',
    'information.guardian.student.unlink': '解除家长学生关联',
    'student_event.create': '创建学生事件',
    'student_event.update': '更新学生事件',
    'student_event.delete': '删除学生事件',
    'chat.route.confirm': '确认分诊方向',
    'ai.full_context.consent': '确认 AI 数据授权',
    'safety.fuse.triggered': '触发安全熔断',
    read: '查看',
    print_attempt: '打印尝试',
    export_attempt: '导出尝试'
  }
} as const

const colors: Record<string, Partial<Record<string, BadgeColor>>> = {
  resourceStatus: { published: 'success', draft: 'warning', retired: 'neutral', pending_review: 'info', ready: 'success' },
  planStatus: {
    pending_acceptance: 'warning',
    accepted: 'info',
    in_progress: 'info',
    review_due: 'warning',
    adjustment_needed: 'warning',
    escalated: 'error',
    completed: 'success',
    closed: 'neutral',
    archived: 'neutral',
    active: 'success'
  },
  actionStatus: {
    pending: 'warning',
    in_progress: 'info',
    completed: 'success',
    blocked: 'error',
    skipped: 'neutral',
    cancelled: 'neutral',
    done: 'success'
  },
  assessmentStatus: { submitted: 'success', draft: 'warning' },
  referralStatus: { created: 'error', escalated: 'warning', acknowledged: 'primary', offline_handling: 'warning', closed: 'neutral' },
  priority: { critical: 'error', urgent: 'warning', normal: 'neutral', low: 'neutral' },
  severity: { critical: 'error', high: 'warning', medium: 'primary', low: 'neutral' },
  accessStatus: { approved: 'success', rejected: 'error', revoked: 'neutral', expired: 'neutral', pending: 'warning' },
  accountStatus: { active: 'success', disabled: 'neutral', invited: 'warning' },
  schoolStatus: { active: 'success', disabled: 'neutral' },
  recordStatus: { active: 'success', archived: 'neutral', closed: 'neutral', disabled: 'neutral', invited: 'warning', graduated: 'neutral', transferred: 'warning', open: 'warning', resolved: 'success', completed: 'success' },
  riskLevel: { crisis: 'error', high: 'error', medium: 'warning', low: 'neutral' },
  caseLevel: {
    '红色-紧急响应': 'error',
    '橙色-高响应': 'warning',
    '黄色-中响应': 'warning',
    '蓝色-低风险': 'info',
    '紫色-待观察': 'neutral'
  },
  caseSolutionStatus: { unresolved: 'error', in_progress: 'warning', resolved: 'success' },
  classStage: {
    '安全危机·立即上报': 'error',
    '秩序奠基期': 'warning',
    '关系激活期': 'warning',
    '制度自转期': 'info',
    '文化生成期': 'success'
  },
  learningLevel: { L1: 'error', L2: 'error', L3: 'warning', L4: 'info', L5: 'neutral' },
  commRiskLevel: { red: 'error', orange: 'warning', yellow: 'warning', blue: 'info', green: 'success' }
}

function labelFrom(group: keyof typeof labels, value?: string | null) {
  return (labels[group] as Record<string, string>)[value || ''] || fallbackText(value)
}

function colorFrom(group: keyof typeof colors, value?: string | null, fallback: BadgeColor = 'neutral') {
  return colors[group]?.[value || ''] || fallback
}

export function useDisplayLabels() {
  return {
    moduleLabel: (value?: string | null) => labelFrom('module', value),
    libraryTypeLabel: (value?: string | null) => labelFrom('libraryType', value),
    resourceScopeLabel: (value?: string | null) => labelFrom('resourceScope', value),
    resourceStatusLabel: (value?: string | null) => labelFrom('resourceStatus', value),
    resourceStatusColor: (value?: string | null) => colorFrom('resourceStatus', value),
    planStatusLabel: (value?: string | null) => labelFrom('planStatus', value),
    planStatusColor: (value?: string | null) => colorFrom('planStatus', value),
    actionStatusLabel: (value?: string | null) => labelFrom('actionStatus', value),
    actionStatusColor: (value?: string | null) => colorFrom('actionStatus', value),
    assessmentStatusLabel: (value?: string | null) => labelFrom('assessmentStatus', value),
    assessmentStatusColor: (value?: string | null) => colorFrom('assessmentStatus', value),
    referralStatusLabel: (value?: string | null) => labelFrom('referralStatus', value),
    referralStatusColor: (value?: string | null) => colorFrom('referralStatus', value),
    priorityLabel: (value?: string | null) => labelFrom('priority', value),
    priorityColor: (value?: string | null) => colorFrom('priority', value),
    severityLabel: (value?: string | null) => labelFrom('severity', value),
    severityColor: (value?: string | null) => colorFrom('severity', value),
    accessStatusLabel: (value?: string | null) => labelFrom('accessStatus', value),
    accessStatusColor: (value?: string | null) => colorFrom('accessStatus', value),
    caseLevelLabel: (value?: string | null) => labelFrom('caseLevel', value),
    caseLevelColor: (value?: string | null) => colorFrom('caseLevel', value),
    caseSolutionStatusLabel: (value?: string | null) => labelFrom('caseSolutionStatus', value),
    caseSolutionStatusColor: (value?: string | null) => colorFrom('caseSolutionStatus', value),
    classStageLabel: (value?: string | null) => labelFrom('classStage', value),
    classStageColor: (value?: string | null) => colorFrom('classStage', value),
    learningLevelLabel: (value?: string | null) => labelFrom('learningLevel', value),
    learningLevelColor: (value?: string | null) => colorFrom('learningLevel', value),
    commRiskLevelLabel: (value?: string | null) => labelFrom('commRiskLevel', value),
    commRiskLevelColor: (value?: string | null) => colorFrom('commRiskLevel', value),
    accountStatusLabel: (value?: string | null) => labelFrom('accountStatus', value),
    accountStatusColor: (value?: string | null) => colorFrom('accountStatus', value),
    schoolStatusLabel: (value?: string | null) => labelFrom('schoolStatus', value),
    schoolStatusColor: (value?: string | null) => colorFrom('schoolStatus', value),
    targetTypeLabel: (value?: string | null) => labelFrom('targetType', value),
    reasonCategoryLabel: (value?: string | null) => labelFrom('reasonCategory', value),
    recordStatusLabel: (value?: string | null) => labelFrom('recordStatus', value),
    recordStatusColor: (value?: string | null) => colorFrom('recordStatus', value),
    riskLevelLabel: (value?: string | null) => labelFrom('riskLevel', value),
    riskLevelColor: (value?: string | null) => colorFrom('riskLevel', value),
    sourceTypeLabel: (value?: string | null) => labelFrom('sourceType', value),
    parentTypeLabel: (value?: string | null) => labelFrom('parentType', value),
    attitudeTypeLabel: (value?: string | null) => labelFrom('attitudeType', value),
    reviewDecisionLabel: (value?: string | null) => labelFrom('reviewDecision', value),
    auditActionLabel: (value?: string | null) => labelFrom('auditAction', value)
  }
}
