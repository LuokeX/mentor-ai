import { describe, expect, it } from 'vitest'
import {
  moduleResourceLibraryCreateSchema,
  moduleResourceFileImportSchema,
  moduleResourceVersionActionSchema,
  moduleToolPayloadSchema
} from '../shared/contracts'
import XLSX from 'xlsx'
import { parseModuleResourceFile } from '../server/domain/module-resource-file-import'
import { filterVisiblePublishedLibraries } from '../server/domain/module-resources'
import { selectEffectiveCrossRefPayloads } from '../server/domain/module-resource-cross-ref-runner'
import { projectModuleResourcePayload } from '../server/domain/module-resource-projection'
import { previewModuleResourcePayload, validateModuleResourcePayload } from '../server/domain/module-resource-validation'

describe('module resource contracts', () => {
  it('requires a school id for school-scoped libraries', () => {
    expect(moduleResourceLibraryCreateSchema.safeParse({
      module: 'home_school',
      libraryType: 'tool',
      scope: 'school',
      name: '家校工具库'
    }).success).toBe(false)
    expect(moduleResourceLibraryCreateSchema.safeParse({
      module: 'home_school',
      libraryType: 'tool',
      scope: 'school',
      schoolId: 'd9c4988e-e585-4a69-8e83-a87b79b88827',
      name: '家校工具库'
    }).success).toBe(true)
  })

  it('validates structured tool cards', () => {
    const parsed = moduleToolPayloadSchema.parse({
      title: '高情绪家长三步降温',
      scenario: '家长表达强烈不满，但尚未出现威胁或公开扩散。',
      steps: ['先接住情绪', '再澄清事实', '最后约定下一步'],
      relatedModule: 'home_school',
      version: '1.0.0'
    })
    expect(parsed.doNot).toEqual([])
    expect(parsed.sourceRefs).toEqual([])
  })

  it('supports publish, rollback and retire lifecycle actions', () => {
    expect(moduleResourceVersionActionSchema.safeParse({ action: 'publish' }).success).toBe(true)
    expect(moduleResourceVersionActionSchema.safeParse({ action: 'rollback' }).success).toBe(true)
    expect(moduleResourceVersionActionSchema.safeParse({ action: 'retire' }).success).toBe(true)
    expect(moduleResourceVersionActionSchema.safeParse({ action: 'delete' }).success).toBe(false)
  })

  it('requires an explicit no-personal-data confirmation for file imports', () => {
    expect(moduleResourceFileImportSchema.safeParse({
      module: 'home_school',
      libraryType: 'tool',
      scope: 'global',
      libraryName: '家校工具库',
      version: '1.0.0',
      filename: 'tool.xlsx',
      contentBase64: Buffer.from('empty').toString('base64'),
      confirmNoPersonalData: false
    }).success).toBe(false)
    expect(moduleResourceFileImportSchema.safeParse({
      module: 'home_school',
      libraryType: 'tool',
      scope: 'global',
      libraryName: '家校工具库',
      version: '1.0.0',
      filename: 'tool.xlsx',
      contentBase64: Buffer.from('empty').toString('base64'),
      confirmNoPersonalData: true
    }).success).toBe(true)
  })
})

describe('module resource validation · instrument role orchestration (③d)', () => {
  const baseInstrument = (code: string, over: Record<string, unknown> = {}) => ({
    code,
    title: code,
    estimatedMinutes: 3,
    questions: [{ id: 'q1', text: '题1', dimension: 'D', options: [{ label: '少', value: 1 }, { label: '多', value: 5 }] }],
    ...over
  })
  const validate = (instruments: Array<Record<string, unknown>>) => validateModuleResourcePayload({
    module: 'self_growth',
    libraryType: 'assessment',
    payload: { instruments }
  })

  it('warns instead of failing when a multi-instrument library has no roles yet', () => {
    const result = validate([baseInstrument('SG_A'), baseInstrument('SG_B')])
    expect(result.ok).toBe(true)
    expect(result.warnings.map(issue => issue.message).join('；')).toContain('量表角色')
  })

  it('requires exactly one screening instrument once roles are used', () => {
    const none = validate([
      baseInstrument('SG_A', { instrumentRole: 'deep_dive', triggerCondition: '量表[SG_B].总分 >= 4', prerequisiteCodes: ['SG_B'] }),
      baseInstrument('SG_B', { instrumentRole: 'situational', triggerCondition: '量表[SG_A].总分 >= 4' })
    ])
    expect(none.ok).toBe(false)
    expect(none.errors.map(issue => issue.message).join('；')).toContain('没有任何一张「入口筛查」')

    const two = validate([
      baseInstrument('SG_A', { instrumentRole: 'screening', isRequired: true }),
      baseInstrument('SG_B', { instrumentRole: 'screening', isRequired: true })
    ])
    expect(two.ok).toBe(false)
    expect(two.errors.map(issue => issue.message).join('；')).toContain('超过一张')
  })

  it('requires trigger conditions on non-screening roles', () => {
    const result = validate([
      baseInstrument('SG_A', { instrumentRole: 'screening', isRequired: true }),
      baseInstrument('SG_B', { instrumentRole: 'deep_dive' })
    ])
    expect(result.ok).toBe(false)
    expect(result.errors.map(issue => issue.message).join('；')).toContain('未填「触发条件」')
  })

  it('accepts a compliant orchestration', () => {
    const result = validate([
      baseInstrument('SG_A', { instrumentRole: 'screening', isRequired: true }),
      baseInstrument('SG_B', { instrumentRole: 'deep_dive', triggerCondition: '量表[SG_A].总分 >= 4', prerequisiteCodes: ['SG_A'] })
    ])
    expect(result.errors).toEqual([])
  })

  it('rejects unknown role values instead of silently dropping them', () => {
    const result = validate([
      baseInstrument('SG_A', { instrumentRole: '入口卷' }),
      baseInstrument('SG_B', { instrumentRole: 'screening', isRequired: true })
    ])
    expect(result.ok).toBe(false)
    expect(result.errors.map(issue => issue.message).join('；')).toContain('量表角色值无效')
  })
})

describe('module resource visibility', () => {
  it('uses school resources before global resources for the same library type', () => {
    const libraries = [
      { id: 'global-tool', libraryType: 'tool', scope: 'global', schoolId: null },
      { id: 'school-tool', libraryType: 'tool', scope: 'school', schoolId: 'school-1' },
      { id: 'global-attribution', libraryType: 'attribution', scope: 'global', schoolId: null },
      { id: 'other-school-attribution', libraryType: 'attribution', scope: 'school', schoolId: 'school-2' }
    ]
    expect(filterVisiblePublishedLibraries(libraries, 'school-1').map(item => item.id)).toEqual(['school-tool', 'global-attribution'])
  })

  it('uses school payloads before global payloads during cross-reference checks', () => {
    const effective = selectEffectiveCrossRefPayloads([
      { libraryType: 'assessment', scope: 'global', schoolId: null, payload: { source: 'global-assessment' } },
      { libraryType: 'assessment', scope: 'school', schoolId: 'school-1', payload: { source: 'school-assessment' } },
      { libraryType: 'tool', scope: 'global', schoolId: null, payload: { source: 'global-tool' } },
      { libraryType: 'tool', scope: 'school', schoolId: 'school-2', payload: { source: 'other-school-tool' } },
      { libraryType: 'attribution', scope: 'global', schoolId: null, payload: { source: 'global-attribution' } }
    ], 'school-1')

    expect(effective.payloads.get('assessment')).toEqual({ source: 'school-assessment' })
    expect(effective.payloads.get('tool')).toEqual({ source: 'global-tool' })
    expect(effective.payloads.get('attribution')).toEqual({ source: 'global-attribution' })
    expect(effective.libraries.map(item => item.libraryType)).toEqual(['assessment', 'attribution', 'tool'])
  })
})

describe('module resource validation', () => {
  it('requires attribution fallback branches before publishing', () => {
    const result = validateModuleResourcePayload({
      module: 'home_school',
      libraryType: 'attribution',
      payload: {
        module: 'home_school',
        version: '1.0.0',
        computed: { conflict: 'MAX(scores)' },
        attributionItems: [{ code: 'HS_AT_CONFLICT', name: '家校沟通冲突升级', module: 'home_school', toolTags: ['home_school', 'conflict'] }],
        evidences: [{ attributionCode: 'HS_AT_CONFLICT', assessmentCode: 'HS_A1', evidenceCode: 'HS_EV_01', condition: 'conflict >= 4', description: '冲突题项偏高' }],
        gradingRules: [{ pri: 1, when: 'conflict >= 4', level: 'high', severity: 'high', blocked: false, ruleId: 'hs-high' }]
      }
    })
    expect(result.ok).toBe(false)
    expect(result.errors.map(issue => issue.message).join('；')).toContain('兜底规则')
  })

  it('rejects a fallback grading rule whose priority is not the maximum', () => {
    // 业务的直觉是「兜底=第0条」，但引擎按 pri 升序首条命中即停，
    // pri 最小的无条件规则会吃掉全部作答，让其余规则永远不可达。
    const result = validateModuleResourcePayload({
      module: 'home_school',
      libraryType: 'attribution',
      payload: {
        module: 'home_school',
        version: '1.0.0',
        computed: { conflict: 'MAX(scores)' },
        attributionItems: [{ code: 'HS_AT_CONFLICT', name: '家校沟通冲突升级', module: 'home_school', toolTags: ['conflict'] }],
        evidences: [{ attributionCode: 'HS_AT_CONFLICT', assessmentCode: 'HS_A1', evidenceCode: 'HS_EV_01', condition: 'conflict >= 4', description: '冲突题项偏高' }],
        gradingRules: [
          { pri: 0, level: 'stable', severity: 'low', blocked: false, ruleId: 'hs-default' },
          { pri: 10, when: 'conflict >= 4', level: 'high', severity: 'high', blocked: true, ruleId: 'hs-high' }
        ]
      }
    })
    expect(result.ok).toBe(false)
    expect(result.errors.map(issue => issue.message).join('；')).toContain('不是最大值')
  })

  it('rejects an attribution item that has no evidence rule', () => {
    const result = validateModuleResourcePayload({
      module: 'home_school',
      libraryType: 'attribution',
      payload: {
        module: 'home_school',
        version: '1.0.0',
        attributionItems: [
          { code: 'HS_AT_A', name: '有证据的归因', module: 'home_school', toolTags: ['a'] },
          { code: 'HS_AT_B', name: '没有证据的归因', module: 'home_school', toolTags: ['b'] }
        ],
        evidences: [{ attributionCode: 'HS_AT_A', assessmentCode: 'HS_A1', evidenceCode: 'HS_EV_01', condition: 'SUM(scores) >= 4', description: '示例' }],
        gradingRules: [{ pri: 999, level: 'stable', severity: 'low', blocked: true, ruleId: 'hs-default' }]
      }
    })
    expect(result.ok).toBe(false)
    expect(result.errors.map(issue => issue.message).join('；')).toContain('没有任何证据规则')
  })

  it('warns when tool entries lack prohibitions and match hints', () => {
    const result = validateModuleResourcePayload({
      module: 'home_school',
      libraryType: 'tool',
      payload: {
        tools: [{
          code: 'HS-001',
          name: '先跟后带',
          form: '话术卡',
          symptoms: '家长有情绪但未升级',
          attributionCode: 'HS_AT_CONFLICT',
          steps: ['确认情绪', '澄清事实', '约定下一步']
        }]
      }
    })
    expect(result.ok).toBe(true)
    expect(result.warnings.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects a tool that has no attribution code at all', () => {
    // 归因编码是工具匹配的主通路，缺了它这个工具永远不会被推出来
    const result = validateModuleResourcePayload({
      module: 'home_school',
      libraryType: 'tool',
      payload: {
        tools: [{
          code: 'HS-002',
          name: '无归因工具',
          form: '话术卡',
          symptoms: '任意场景',
          steps: ['第一步']
        }]
      }
    })
    expect(result.ok).toBe(false)
    expect(result.errors.map(issue => issue.message).join('；')).toContain('未填对应归因编码')
  })

  it('previews attribution results with default answers', () => {
    const preview = previewModuleResourcePayload({
      module: 'home_school',
      libraryType: 'attribution',
      payload: {
        module: 'home_school',
        version: '1.0.0',
        computed: { conflict: 'MAX(scores)' },
        attributionItems: [{ code: 'HS_AT_STRUCTURE', name: '沟通结构待澄清', module: 'home_school', toolTags: ['home_school', 'stable'] }],
        evidences: [{ attributionCode: 'HS_AT_STRUCTURE', assessmentCode: 'home-school-container', evidenceCode: 'HS_EV_01', condition: 'conflict >= 1', description: '进入常规维护' }],
        gradingRules: [{ pri: 100, level: 'stable', severity: 'low', blocked: true, ruleId: 'hs-default' }]
      }
    })
    expect(preview.type).toBe('attribution')
    expect((preview as any).attributionItemCount).toBe(1)
    expect((preview as any).gradingRuleCount).toBe(1)
  })
})

describe('module resource projection', () => {
  const base = {
    libraryId: '7a2b7c6f-7321-4b35-b26c-42a7eddf37b7',
    versionId: '6a6f71d9-4d0c-4c4f-9dd7-76230cb6307b',
    module: 'home_school' as const,
    scope: 'global' as const,
    schoolId: null
  }

  it('projects assessment instruments into searchable metadata rows', () => {
    const projection = projectModuleResourcePayload({
      ...base,
      libraryType: 'assessment'
    }, {
      instruments: [{
        code: 'HS-A1',
        title: '家校沟通量表',
        questions: [
          { id: 'q1', text: '家长近期沟通是否频繁', dimension: '沟通频率', options: [{ label: '低', value: 1 }, { label: '高', value: 5 }] },
          { id: 'q2', text: '沟通是否聚焦事实', dimension: '事实聚焦', options: [{ label: '否', value: 1 }, { label: '是', value: 5 }] }
        ],
        scoring: { communication: 'AVG(q1,q2)' }
      }]
    })
    expect(projection.assessments).toHaveLength(1)
    expect(projection.assessments[0]).toMatchObject({
      instrumentCode: 'HS-A1',
      questionCount: 2,
      dimensions: ['沟通频率', '事实聚焦'],
      scoringKeys: ['communication']
    })
  })

  it('projects attribution branches into rule governance rows', () => {
    const projection = projectModuleResourcePayload({
      ...base,
      libraryType: 'attribution'
    }, {
      module: 'home_school',
      version: '1.0.0',
      computed: { conflict: 'MAX(scores)' },
      attributionItems: [
        { code: 'HS_AT_CONFLICT', name: '家校沟通冲突升级', module: 'home_school', baseWeight: 1.5, toolTags: ['conflict', 'script'] },
        { code: 'HS_AT_SYNC', name: '信息不同步', module: 'home_school', toolTags: ['sync'] }
      ],
      evidences: [
        { attributionCode: 'HS_AT_CONFLICT', assessmentCode: 'HS_A1', evidenceCode: 'HS_EV_01', condition: 'conflict >= 4', description: '冲突题项偏高' },
        { attributionCode: 'HS_AT_CONFLICT', assessmentCode: 'HS_A2', evidenceCode: 'HS_EV_02', condition: 'conflict >= 3', description: '冲突题项偏高（次级）' },
        { attributionCode: 'HS_AT_SYNC', assessmentCode: 'HS_A1', evidenceCode: 'HS_EV_03', condition: 'conflict >= 2', description: '信息同步不足' }
      ],
      gradingRules: [
        { pri: 10, when: 'conflict >= 4', level: 'high', severity: 'high', blocked: false, ruleId: 'hs-conflict-high' },
        { pri: 100, level: 'stable', severity: 'low', blocked: true, ruleId: 'hs-default' }
      ]
    })
    expect(projection.attributionRules.map(rule => rule.ruleId)).toEqual(['hs-conflict-high', 'hs-default'])
    expect(projection.attributionRules[0]).toMatchObject({
      priority: 10,
      level: 'high',
      hasCondition: true,
      severity: 'high'
    })
    // 归因项投影带上证据条数和覆盖的量表，运营台据此核对覆盖情况
    expect(projection.attributionItems.map(item => item.attributionCode)).toEqual(['HS_AT_CONFLICT', 'HS_AT_SYNC'])
    expect(projection.attributionItems[0]).toMatchObject({
      attributionName: '家校沟通冲突升级',
      baseWeight: 1.5,
      evidenceCount: 2,
      assessmentCodes: ['HS_A1', 'HS_A2'],
      toolTags: ['conflict', 'script']
    })
  })

  it('projects tools into matchable tool rows', () => {
    const projection = projectModuleResourcePayload({
      ...base,
      libraryType: 'tool'
    }, {
      tools: [{
        code: 'HS-T1',
        name: '三步降温沟通卡',
        form: '话术卡',
        symptoms: '家长情绪激烈但未触发红线',
        expectedEffect: '完成事实澄清和下一步约定',
        level: 'high',
        severity: 'high',
        attributionCode: 'HS_AT_CONFLICT',
        attributionLabel: '家校沟通冲突升级',
        tags: ['沟通'],
        toolTags: ['conflict', 'script'],
        dimensions: ['HS_D_FACT'],
        steps: ['接住情绪', '澄清事实', '约定下一步'],
        scripts: '我理解您现在很着急。',
        prohibitions: '不承诺未核实事项'
      }]
    })
    expect(projection.tools).toHaveLength(1)
    expect(projection.tools[0]).toMatchObject({
      toolCode: 'HS-T1',
      level: 'high',
      severity: 'high',
      primaryAttribution: 'HS_AT_CONFLICT',
      stepCount: 3,
      hasScript: true,
      hasProhibitions: true,
      hasExpectedEffect: true
    })
  })
})

describe('module resource file import parser', () => {
  function encodeWorkbook(sheets: Array<{ name: string, rows: unknown[][] }>) {
    const workbook = XLSX.utils.book_new()
    for (const sheet of sheets) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name)
    }
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    return buffer.toString('base64')
  }

  it('parses standard assessment Excel uploads into publishable payloads', () => {
    const payload = parseModuleResourceFile({
      module: 'home_school',
      libraryType: 'assessment',
      filename: 'assessment.xlsx',
      contentBase64: encodeWorkbook([{
        name: '评估库',
        rows: [
          ['评估编码', '评估名称', '评估维度', '评分锚点'],
          ['HS-A1', '家校沟通观察表', '沟通结构', '1=低;5=高'],
          ['HS-A2', '家长情绪容器观察表', '情绪容器', '1=低;5=高']
        ]
      }])
    })
    const validation = validateModuleResourcePayload({ module: 'home_school', libraryType: 'assessment', payload })
    expect(validation.ok).toBe(true)
    expect((payload.instruments as any[])[0]?.questions).toHaveLength(2)
  })

  it('parses standard attribution Excel uploads into publishable payloads', () => {
    const payload = parseModuleResourceFile({
      module: 'home_school',
      libraryType: 'attribution',
      filename: 'attribution.xlsx',
      contentBase64: encodeWorkbook([{
        name: '归因规则',
        rows: [
          ['module', 'version', '归因编码', '归因名称', 'toolTags',
            '证据编码', '证据归因编码', '证据依据量表编码', '证据触发条件', '证据说明',
            'priority', 'when', 'level', 'severity', 'blocked', 'ruleId'],
          ['home_school', '1.0.0', 'HS_AT_CONFLICT', '家校沟通冲突升级', 'conflict;script',
            'HS_EV_01', 'HS_AT_CONFLICT', 'HS_A1', 'conflict >= 4', '冲突题项偏高',
            '10', 'conflict >= 4', 'high', 'high', '是', 'hs-high'],
          ['home_school', '1.0.0', '', '', '',
            '', '', '', '', '',
            '999', '', 'stable', 'low', '否', 'hs-default']
        ]
      }])
    })
    const validation = validateModuleResourcePayload({ module: 'home_school', libraryType: 'attribution', payload })
    expect(validation.errors).toEqual([])
    expect(validation.ok).toBe(true)
    expect((payload.attributionItems as any[]).map(item => item.code)).toEqual(['HS_AT_CONFLICT'])
    expect((payload.evidences as any[]).map(e => e.evidenceCode)).toEqual(['HS_EV_01'])
    expect((payload.gradingRules as any[]).map(rule => rule.ruleId)).toEqual(['hs-high', 'hs-default'])
  })

  it('parses standard tool Excel uploads into publishable payloads', () => {
    const payload = parseModuleResourceFile({
      module: 'home_school',
      libraryType: 'tool',
      filename: 'tool.xlsx',
      contentBase64: encodeWorkbook([{
        name: '工具库',
        rows: [
          ['工具编码', '工具名称', '工具形式', '适用症状/场景', '对应归因编码', '严重度', '工具标签', '操作步骤', '关键话术', '禁忌条件', '预期效果'],
          ['HS-T1', '三步降温沟通卡', '话术卡', '家长情绪激烈但未触发红线', 'HS_AT_CONFLICT', 'high', 'conflict;script', '接住情绪;澄清事实;约定下一步', '我理解您现在很着急。', '不承诺未核实事项', '完成事实澄清和下一步约定']
        ]
      }])
    })
    const validation = validateModuleResourcePayload({ module: 'home_school', libraryType: 'tool', payload })
    expect(validation.ok).toBe(true)
    expect((payload.tools as any[])[0]?.steps).toEqual(['接住情绪', '澄清事实', '约定下一步'])
  })
})
