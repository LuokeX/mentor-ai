import { describe, expect, it } from 'vitest'
import {
  knowledgeImportErrors,
  planKnowledgeImport,
  type ExistingKnowledgeDocument,
  type IncomingKnowledgeDocument
} from '../server/domain/module-resource-knowledge-import'

function existingDocument(overrides: Partial<ExistingKnowledgeDocument> = {}): ExistingKnowledgeDocument {
  return {
    id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
    title: '不可调和矛盾的处理',
    module: 'student_case',
    sourceType: 'markdown',
    sourceRef: '小学部教师知识库条目汇编｜STU-047',
    notes: '',
    tags: ['矛盾调解'],
    section: 'primary',
    checksum: 'checksum-a',
    ...overrides
  }
}

function incomingRow(overrides: Partial<IncomingKnowledgeDocument> = {}): IncomingKnowledgeDocument {
  return {
    rowIndex: 1,
    documentId: '11111111-1111-4111-8111-111111111111',
    title: '不可调和矛盾的处理',
    module: 'student_case',
    sourceType: 'markdown',
    sourceRef: '小学部教师知识库条目汇编｜STU-047',
    notes: '',
    tags: ['矛盾调解'],
    section: 'primary',
    content: '正文',
    checksum: 'checksum-a',
    ...overrides
  }
}

describe('planKnowledgeImport', () => {
  it('正文不变、元数据不变 → 未变', () => {
    const plan = planKnowledgeImport({
      existing: [existingDocument()],
      incoming: [incomingRow()],
      hasDocumentIdColumn: true
    })
    expect(plan.unchanged).toHaveLength(1)
    expect(plan.updateContent).toHaveLength(0)
    expect(plan.updateMetadata).toHaveLength(0)
    expect(plan.remove).toHaveLength(0)
    expect(knowledgeImportErrors(plan)).toEqual([])
  })

  it('正文变了 → 重新切块（updateContent）', () => {
    const plan = planKnowledgeImport({
      existing: [existingDocument()],
      incoming: [incomingRow({ checksum: 'checksum-b', title: '不可调和矛盾的处理（修订）' })],
      hasDocumentIdColumn: true
    })
    expect(plan.updateContent).toHaveLength(1)
    expect(plan.updateContent[0]!.existing.id).toBe('11111111-1111-4111-8111-111111111111')
    expect(plan.updateMetadata).toHaveLength(0)
  })

  it('正文没变、只有标签/学段/备注变化 → 只合并元数据', () => {
    const plan = planKnowledgeImport({
      existing: [existingDocument()],
      incoming: [incomingRow({ tags: ['矛盾调解', '需求协商'], section: 'all', notes: '陈冉（六年级·班主任）' })],
      hasDocumentIdColumn: true
    })
    expect(plan.updateMetadata).toHaveLength(1)
    expect(plan.updateContent).toHaveLength(0)
  })

  it('文档ID 留空 → 新增', () => {
    const plan = planKnowledgeImport({
      existing: [existingDocument()],
      incoming: [incomingRow(), incomingRow({ documentId: undefined, title: '新条目', rowIndex: 2 })],
      hasDocumentIdColumn: true
    })
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0]!.title).toBe('新条目')
    expect(plan.unchanged).toHaveLength(1)
  })

  it('ID 留空但库内已有标题+正文一致的文档 → 按同一篇处理（同一文件可重复跑）', () => {
    const plan = planKnowledgeImport({
      existing: [existingDocument()],
      incoming: [incomingRow({ documentId: undefined })],
      hasDocumentIdColumn: true
    })
    expect(plan.create).toHaveLength(0)
    expect(plan.unchanged).toHaveLength(1)
    expect(plan.remove).toHaveLength(0)
    expect(plan.adopted).toHaveLength(1)

    // 标题一致但正文不同 → 仍是新增（不吞掉业务新写的条目）
    const differentContent = planKnowledgeImport({
      existing: [existingDocument()],
      incoming: [incomingRow({ documentId: undefined, checksum: 'checksum-b' })],
      hasDocumentIdColumn: true
    })
    expect(differentContent.create).toHaveLength(1)
    expect(differentContent.adopted).toHaveLength(0)
  })

  it('库里存在、文件里没有 → 删除', () => {
    const plan = planKnowledgeImport({
      existing: [
        existingDocument(),
        existingDocument({ id: '22222222-2222-4222-8222-222222222222', title: '只存在于库里的文档' })
      ],
      incoming: [incomingRow()],
      hasDocumentIdColumn: true
    })
    expect(plan.remove.map(document => document.title)).toEqual(['只存在于库里的文档'])
  })

  it('ID 查不到、重复 ID、缺 ID 列都判为错误，且不猜测成新增', () => {
    const unknownId = planKnowledgeImport({
      existing: [existingDocument()],
      incoming: [incomingRow({ documentId: '99999999-9999-4999-8999-999999999999' })],
      hasDocumentIdColumn: true
    })
    expect(unknownId.unknownId).toHaveLength(1)
    expect(unknownId.create).toHaveLength(0)
    // ID 对不上的行认领不到库内文档，该文档会落进「删除」——所以调用方在 unknownId 非空时必须拒绝执行
    expect(unknownId.remove).toHaveLength(1)
    expect(knowledgeImportErrors(unknownId).join('')).toContain('在本库查不到')

    const duplicated = planKnowledgeImport({
      existing: [existingDocument()],
      incoming: [incomingRow({ rowIndex: 3 }), incomingRow({ rowIndex: 4 })],
      hasDocumentIdColumn: true
    })
    expect(duplicated.duplicateIds).toEqual([{ documentId: '11111111-1111-4111-8111-111111111111', rowIndexes: [3, 4] }])
    expect(duplicated.unchanged).toHaveLength(0)
    expect(duplicated.updateContent).toHaveLength(0)
    expect(knowledgeImportErrors(duplicated).join('')).toContain('出现多次')

    const missingColumn = planKnowledgeImport({
      existing: [existingDocument()],
      incoming: [incomingRow({ documentId: undefined })],
      hasDocumentIdColumn: false
    })
    expect(missingColumn.missingIdColumn).toBe(true)
    expect(knowledgeImportErrors(missingColumn).join('')).toContain('没有「文档ID」列')
  })

  it('重复 ID 的行不参与匹配，也不会被当成未变', () => {
    const plan = planKnowledgeImport({
      existing: [existingDocument()],
      incoming: [incomingRow(), incomingRow({ rowIndex: 9 })],
      hasDocumentIdColumn: true
    })
    expect(plan.duplicateIds).toHaveLength(1)
    expect(plan.unchanged).toHaveLength(0)
    // 该文档没有被任何有效行认领，会落到删除；调用方在 duplicateIds 非空时已拒绝执行
    expect(plan.remove).toHaveLength(1)
  })
})
