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
        branches: [{
          pri: 1,
          when: 'conflict >= 4',
          level: 'high',
          blocked: false,
          ruleId: 'hs-high',
          primaryAttribution: '家校沟通冲突升级',
          reasons: ['冲突题项偏高'],
          toolTags: ['home_school', 'conflict']
        }]
      }
    })
    expect(result.ok).toBe(false)
    expect(result.errors.map(issue => issue.message).join('；')).toContain('兜底规则')
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
          steps: ['确认情绪', '澄清事实', '约定下一步']
        }]
      }
    })
    expect(result.ok).toBe(true)
    expect(result.warnings.length).toBeGreaterThanOrEqual(2)
  })

  it('previews attribution results with default answers', () => {
    const preview = previewModuleResourcePayload({
      module: 'home_school',
      libraryType: 'attribution',
      payload: {
        module: 'home_school',
        version: '1.0.0',
        computed: { conflict: 'MAX(scores)' },
        branches: [{
          pri: 100,
          level: 'stable',
          blocked: false,
          ruleId: 'hs-default',
          primaryAttribution: '沟通结构待澄清',
          reasons: ['进入常规维护'],
          toolTags: ['home_school', 'stable']
        }]
      }
    })
    expect(preview.type).toBe('attribution')
    expect((preview as any).defaultPreview.primaryAttribution).toBe('沟通结构待澄清')
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
      branches: [{
        pri: 10,
        when: 'conflict >= 4',
        level: 'high',
        blocked: false,
        ruleId: 'hs-conflict-high',
        primaryAttribution: '家校沟通冲突升级',
        secondaryAttributions: ['信息不同步'],
        reasons: ['冲突题项偏高'],
        toolTags: ['conflict', 'script']
      }, {
        pri: 100,
        level: 'stable',
        blocked: false,
        ruleId: 'hs-default',
        primaryAttribution: '沟通结构待澄清',
        reasons: ['进入常规维护'],
        toolTags: ['stable']
      }]
    })
    expect(projection.attributionRules.map(rule => rule.ruleId)).toEqual(['hs-conflict-high', 'hs-default'])
    expect(projection.attributionRules[0]).toMatchObject({
      priority: 10,
      level: 'high',
      hasCondition: true,
      primaryAttribution: '家校沟通冲突升级',
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
        primaryAttribution: '家校沟通冲突升级',
        tags: ['沟通'],
        toolTags: ['conflict', 'script'],
        dimensions: ['事实聚焦'],
        steps: ['接住情绪', '澄清事实', '约定下一步'],
        scripts: '我理解您现在很着急。',
        prohibitions: '不承诺未核实事项'
      }]
    })
    expect(projection.tools).toHaveLength(1)
    expect(projection.tools[0]).toMatchObject({
      toolCode: 'HS-T1',
      level: 'high',
      primaryAttribution: '家校沟通冲突升级',
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
          ['module', 'version', 'priority', 'when', 'level', 'blocked', 'ruleId', 'primaryAttribution', 'reasons', 'toolTags'],
          ['home_school', '1.0.0', '10', 'conflict >= 4', 'high', '是', 'hs-high', '家校沟通冲突升级', '冲突题项偏高', 'conflict;script'],
          ['home_school', '1.0.0', '100', '', 'stable', '否', 'hs-default', '沟通结构待澄清', '进入常规维护', 'stable']
        ]
      }])
    })
    const validation = validateModuleResourcePayload({ module: 'home_school', libraryType: 'attribution', payload })
    expect(validation.ok).toBe(true)
    expect((payload.branches as any[]).map(branch => branch.ruleId)).toEqual(['hs-high', 'hs-default'])
  })

  it('parses standard tool Excel uploads into publishable payloads', () => {
    const payload = parseModuleResourceFile({
      module: 'home_school',
      libraryType: 'tool',
      filename: 'tool.xlsx',
      contentBase64: encodeWorkbook([{
        name: '工具库',
        rows: [
          ['工具编码', '工具名称', '工具形式', '适用症状/场景', '主归因', '工具标签', '操作步骤', '关键话术', '禁忌条件', '预期效果'],
          ['HS-T1', '三步降温沟通卡', '话术卡', '家长情绪激烈但未触发红线', '家校沟通冲突升级', 'conflict;script', '接住情绪;澄清事实;约定下一步', '我理解您现在很着急。', '不承诺未核实事项', '完成事实澄清和下一步约定']
        ]
      }])
    })
    const validation = validateModuleResourcePayload({ module: 'home_school', libraryType: 'tool', payload })
    expect(validation.ok).toBe(true)
    expect((payload.tools as any[])[0]?.steps).toEqual(['接住情绪', '澄清事实', '约定下一步'])
  })
})
