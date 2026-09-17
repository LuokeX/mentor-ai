import type { ModuleId } from '../../shared/contracts'

/**
 * 知识库「全量替换导入」的差异计算（纯函数，不碰数据库）。
 *
 * 场景：平台把知识库导出成 XLSX 交业务修改（改文案、加条目、删条目），改完再导入回来，
 * 库里最终应与文件一致。批量导入（batch-import）是纯新增，撑不住这个流程，所以单独有
 * `scripts/import-knowledge-base.ts` —— 本文件只负责「哪行对应库里哪篇、各自算什么变更」，
 * 便于单测覆盖，也避免把判定逻辑埋进脚本里。
 *
 * 匹配口径（宁可拒绝也不猜）：
 *  - 文档 ID 来自导出文件自带的「文档ID」列，是唯一匹配依据；
 *  - ID 为空 = 新增行；ID 在库里查不到、或同一 ID 出现多次，都直接判为错误让调用方拒绝执行，
 *    不猜测、不降级成新增（跨环境导出、复制行忘清 ID 都会踩到这里）；
 *  - 库里存在但文件里没有的文档 = 删除。
 */

/** 库内现有的独立知识库文档（比对所需的最小字段集）。 */
export interface ExistingKnowledgeDocument {
  id: string
  title: string
  module: string
  sourceType: string
  sourceRef: string
  notes: string
  tags: string[]
  /** 适用学部（all/primary/junior/senior/repeat） */
  section: string
  /** 正文归一化后的 sha256（checksumModuleResourceContent） */
  checksum: string
}

/** 导入文件里的一行。 */
export interface IncomingKnowledgeDocument {
  /** 「知识文档」表数据行序号（表头下第几行，1 基），用于报错定位 */
  rowIndex?: number
  documentId?: string
  title: string
  module: ModuleId | string
  sourceType: string
  sourceRef: string
  notes: string
  tags: string[]
  section: string
  content: string
  checksum: string
}

export interface KnowledgeImportChange {
  existing: ExistingKnowledgeDocument
  incoming: IncomingKnowledgeDocument
}

export interface KnowledgeImportPlan {
  /** 正文有改动：需要重切块 + 重新向量化 */
  updateContent: KnowledgeImportChange[]
  /** 正文没变、元数据有变动：只合并 metadata，不重新向量化 */
  updateMetadata: KnowledgeImportChange[]
  /** 与库内完全一致 */
  unchanged: IncomingKnowledgeDocument[]
  /** ID 留空的新增行 */
  create: IncomingKnowledgeDocument[]
  /** 库内有、文件里没有：删除 */
  remove: ExistingKnowledgeDocument[]
  /** 文件里带了 ID 但本库查不到：跨环境文件或该文档已被删除，拒绝执行 */
  unknownId: IncomingKnowledgeDocument[]
  /** 同一 ID 在文件里出现多次：以哪一行为准无法判断，拒绝执行 */
  duplicateIds: Array<{ documentId: string, rowIndexes: number[] }>
  /** 文件不含「文档ID」列：没有匹配依据，拒绝执行 */
  missingIdColumn: boolean
  /**
   * ID 留空、但标题与正文与库内某篇逐字一致的行走这里（不重复新增、不删除重造）。
   * 用于「上一轮导入新增的文档，文件里仍是空 ID」的重复执行场景，保证同一份文件可重复跑。
   */
  adopted: Array<{ existing: ExistingKnowledgeDocument, incoming: IncomingKnowledgeDocument }>
}

function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

function sameTags(left: string[], right: string[]) {
  const a = left.map(tag => tag.trim()).filter(Boolean)
  const b = right.map(tag => tag.trim()).filter(Boolean)
  return a.length === b.length && a.every((tag, index) => tag === b[index])
}

function sameMetadata(existing: ExistingKnowledgeDocument, incoming: IncomingKnowledgeDocument) {
  return normalizeText(existing.title) === normalizeText(incoming.title)
    && normalizeText(existing.module) === normalizeText(incoming.module)
    && normalizeText(existing.sourceType) === normalizeText(incoming.sourceType)
    && normalizeText(existing.sourceRef) === normalizeText(incoming.sourceRef)
    && normalizeText(existing.notes) === normalizeText(incoming.notes)
    && normalizeText(existing.section || 'all') === normalizeText(incoming.section || 'all')
    && sameTags(existing.tags, incoming.tags)
}

export function planKnowledgeImport(input: {
  existing: ExistingKnowledgeDocument[]
  incoming: IncomingKnowledgeDocument[]
  /** 文件里是否存在「文档ID」列（parseKnowledgeWorkbook 的返回值） */
  hasDocumentIdColumn: boolean
}): KnowledgeImportPlan {
  const existingById = new Map(input.existing.map(document => [document.id, document]))
  const matched = new Set<string>()
  const plan: KnowledgeImportPlan = {
    updateContent: [],
    updateMetadata: [],
    unchanged: [],
    create: [],
    remove: [],
    unknownId: [],
    duplicateIds: [],
    missingIdColumn: !input.hasDocumentIdColumn,
    adopted: []
  }

  // 先查重复 ID：同一篇文档被文件里多行引用时无法判断以哪行为准
  const rowsById = new Map<string, number[]>()
  for (const incoming of input.incoming) {
    const id = normalizeText(incoming.documentId)
    if (!id) continue
    const rows = rowsById.get(id) || []
    rows.push(incoming.rowIndex ?? 0)
    rowsById.set(id, rows)
  }
  const duplicatedIds = new Set<string>()
  for (const [documentId, rowIndexes] of rowsById) {
    if (rowIndexes.length > 1) {
      duplicatedIds.add(documentId)
      plan.duplicateIds.push({ documentId, rowIndexes })
    }
  }

  for (const incoming of input.incoming) {
    const id = normalizeText(incoming.documentId)
    if (!id) {
      // ID 留空：先看是不是「上一轮导入新增、文件里还没回填 ID」的那篇（标题+正文逐字一致）
      const adoptedDocument = input.existing.find(document =>
        !matched.has(document.id)
        && normalizeText(document.title) === normalizeText(incoming.title)
        && normalizeText(document.checksum) === normalizeText(incoming.checksum)
      )
      if (adoptedDocument) {
        matched.add(adoptedDocument.id)
        plan.adopted.push({ existing: adoptedDocument, incoming })
        if (!sameMetadata(adoptedDocument, incoming)) {
          plan.updateMetadata.push({ existing: adoptedDocument, incoming })
        } else {
          plan.unchanged.push(incoming)
        }
        continue
      }
      plan.create.push(incoming)
      continue
    }
    if (duplicatedIds.has(id)) continue

    const existing = existingById.get(id)
    if (!existing) {
      plan.unknownId.push(incoming)
      continue
    }

    matched.add(id)
    const change: KnowledgeImportChange = { existing, incoming }
    if (normalizeText(existing.checksum) !== normalizeText(incoming.checksum)) plan.updateContent.push(change)
    else if (!sameMetadata(existing, incoming)) plan.updateMetadata.push(change)
    else plan.unchanged.push(incoming)
  }

  plan.remove = input.existing.filter(document => !matched.has(document.id))
  return plan
}

/** 计划里是否存在会让导入中止的错误（调用方应拒绝写入并原样展示）。 */
export function knowledgeImportErrors(plan: KnowledgeImportPlan) {
  const errors: string[] = []
  if (plan.missingIdColumn) {
    errors.push('文件里没有「文档ID」列。全量替换导入必须用平台导出的文件做底稿（该列用于定位要更新的文档），不能新建一份表格来导。')
  }
  if (plan.duplicateIds.length) {
    const detail = plan.duplicateIds
      .slice(0, 10)
      .map(item => `文档ID ${item.documentId}（出现在第 ${item.rowIndexes.join('、')} 行）`)
      .join('；')
    errors.push(`同一文档ID在文件里出现多次，无法判断以哪一行为准：${detail}${plan.duplicateIds.length > 10 ? ` 等 ${plan.duplicateIds.length} 处` : ''}。请删除重复行，或把新增行的「文档ID」清空。`)
  }
  if (plan.unknownId.length) {
    const detail = plan.unknownId
      .slice(0, 10)
      .map(item => `第 ${item.rowIndex ?? '?'} 行「${item.title}」=${item.documentId}`)
      .join('；')
    errors.push(`文件里有 ${plan.unknownId.length} 行的文档ID在本库查不到：${detail}${plan.unknownId.length > 10 ? ' 等' : ''}。这份文件可能来自另一个环境（开发库/正式库），或对应文档已被删除；请改用本库导出的文件做底稿。`)
  }
  return errors
}
