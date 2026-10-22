import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_MODULE_IDS, knowledgeModuleIdSchema, moduleIdSchema } from '../shared/contracts'
import { parseKnowledgeSheets } from '../server/domain/module-resource-file-import'

/**
 * 德育是知识库专用的第六个分类，不是第六业务模块：
 * - knowledgeModuleIdSchema 接受 moral_education；
 * - moduleIdSchema 仍只接受五个业务模块，业务记录不能写入德育。
 */
describe('知识库德育分类', () => {
  it('knowledgeModuleIdSchema 接受五个业务模块与德育', () => {
    for (const id of KNOWLEDGE_MODULE_IDS) {
      expect(knowledgeModuleIdSchema.parse(id)).toBe(id)
    }
    expect(knowledgeModuleIdSchema.parse('moral_education')).toBe('moral_education')
  })

  it('业务模块 schema 不接受德育', () => {
    expect(moduleIdSchema.safeParse('moral_education').success).toBe(false)
    expect(moduleIdSchema.safeParse('class_system').success).toBe(true)
  })

  it('知识库导入按行读取 moral_education', () => {
    const entries = parseKnowledgeSheets([{
      name: '知识文档',
      rows: [{
        文档标题: '中小学生守则',
        所属模块: 'moral_education',
        文档内容: '# 中小学生守则\n\n九条全文。'
      }]
    }], 'self_growth')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.module).toBe('moral_education')
  })

  it('知识库导入兼容中文「德育」别名', () => {
    const entries = parseKnowledgeSheets([{
      name: '知识文档',
      rows: [{
        文档标题: '教育惩戒规则',
        所属模块: '德育',
        文档内容: '教育惩戒的实施与救济。'
      }]
    }], 'self_growth')
    expect(entries[0]!.module).toBe('moral_education')
  })

  it('未填所属模块时使用导入默认分类', () => {
    const entries = parseKnowledgeSheets([{
      name: '知识文档',
      rows: [{ 文档标题: '班级公约', 文档内容: '班级公约正文。' }]
    }], 'moral_education')
    expect(entries[0]!.module).toBe('moral_education')
  })
})
