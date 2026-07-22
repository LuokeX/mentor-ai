import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { usePool } from '../utils/db'
import { embedKnowledgeQuery } from '../integrations/ollama'
import type { LibraryType, ModuleId } from '../../shared/contracts'

export interface KnowledgeChunkInput {
  chunkIndex: number
  heading: string | null
  content: string
  tokenEstimate: number
}

export interface KnowledgeCitation {
  chunkId: string
  documentId: string
  knowledgeBaseId: string
  knowledgeBase: string
  documentTitle: string
  heading: string | null
  excerpt: string
  score: number
  lexicalScore?: number
  semanticScore?: number
  retrievalMode?: 'hybrid' | 'lexical'
  module?: ModuleId
  libraryType?: LibraryType
  resourceVersionId?: string
  resourceTitle?: string
}

export function normalizeKnowledgeContent(value: string) {
  return value.replace(/\r\n?/g, '\n').replace(/\0/g, '').trim()
}

export function checksumKnowledgeContent(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function buildKnowledgeRetrievalQuery(message: string, history: Array<{ role: 'user' | 'assistant', content: string }>) {
  const recentUserContext = history
    .filter(item => item.role === 'user')
    .slice(-3)
    .map(item => item.content.trim())
    .filter(Boolean)
  return [...recentUserContext, message.trim()]
    .filter(Boolean)
    .join('\n')
    .slice(-3000)
}

export function chunkKnowledgeDocument(raw: string, maxChars = 1200): KnowledgeChunkInput[] {
  const content = normalizeKnowledgeContent(raw)
  if (!content) return []
  const paragraphs = content.split(/\n{2,}/).map(item => item.trim()).filter(Boolean)
  const chunks: KnowledgeChunkInput[] = []
  let heading: string | null = null
  let buffer = ''

  const push = () => {
    const value = buffer.trim()
    if (!value) return
    chunks.push({
      chunkIndex: chunks.length,
      heading,
      content: value,
      tokenEstimate: Math.ceil(value.length / 2)
    })
    buffer = ''
  }

  for (const paragraph of paragraphs) {
    const headingMatch = paragraph.match(/^#{1,6}\s+(.+)$/m)
    if (headingMatch?.[1] && paragraph.length < 300) heading = headingMatch[1].trim()
    if (paragraph.length > maxChars) {
      push()
      for (let start = 0; start < paragraph.length; start += maxChars - 120) {
        buffer = paragraph.slice(start, start + maxChars)
        push()
      }
      continue
    }
    if (buffer && buffer.length + paragraph.length + 2 > maxChars) push()
    buffer += `${buffer ? '\n\n' : ''}${paragraph}`
  }
  push()
  return chunks
}

export function queryTerms(value: string) {
  const normalized = value.toLowerCase().replace(/1[3-9]\d{9}/g, ' ').replace(/[\w.-]+@[\w.-]+\.\w+/g, ' ')
  const words = normalized.match(/[a-z\d]{2,}|[\u4e00-\u9fff]{2,}/g) || []
  const terms = new Set<string>()
  for (const word of words) {
    if (/^[\u4e00-\u9fff]+$/.test(word)) {
      for (let index = 0; index < word.length - 1; index++) terms.add(word.slice(index, index + 2))
    } else terms.add(word)
  }
  return [...terms].slice(0, 80)
}

export async function retrieveKnowledge(event: H3Event, schoolId: string, query: string, limit = 6, options?: {
  module?: ModuleId
  secondaryModules?: ModuleId[]
  libraryTypes?: LibraryType[]
  strictRequired?: boolean
}): Promise<KnowledgeCitation[]> {
  if (options?.module) {
    const resourceCitations = await retrieveModuleResourceKnowledge(event, schoolId, query, limit, {
      module: options.module,
      secondaryModules: options.secondaryModules,
      libraryTypes: options.libraryTypes
    })
    if (resourceCitations.length || options.strictRequired) return resourceCitations
  }
  const pool = usePool(event)
  const sanitizedQuery = query.replace(/1[3-9]\d{9}/g, '[PHONE]').replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]').slice(0, 2000)
  const terms = queryTerms(sanitizedQuery)
  type RetrievalRow = {
    chunk_id: string
    document_id: string
    knowledge_base_id: string
    knowledge_base: string
    document_title: string
    heading: string | null
    content: string
    lexical_score?: number
    semantic_score?: number
    term_hits?: number
  }
  const lexicalPromise = pool.query<RetrievalRow>(`
    select
      kc.id as chunk_id,
      kd.id as document_id,
      kb.id as knowledge_base_id,
      kb.name as knowledge_base,
      kd.title as document_title,
      kc.heading,
      kc.content,
      greatest(
        similarity(left(kc.content, 2400), $1),
        similarity(coalesce(kc.heading, ''), $1) * 1.4,
        similarity(kd.title, $1) * 1.2
      ) as lexical_score,
      (select count(*)::int from unnest($3::text[]) as term where position(term in lower(kc.content || ' ' || coalesce(kc.heading, '') || ' ' || kd.title)) > 0) as term_hits
    from knowledge_chunks kc
    join knowledge_documents kd on kd.id = kc.document_id
    join knowledge_bases kb on kb.id = kc.knowledge_base_id
    where kb.status = 'published'
      and kd.status = 'ready'
      and (kb.scope = 'global' or (kb.scope = 'school' and kb.school_id = $2))
    order by term_hits desc, lexical_score desc, kc.created_at desc
    limit 30
  `, [sanitizedQuery, schoolId, terms])

  const embeddingPromise = embedKnowledgeQuery(event, sanitizedQuery).catch(() => null)
  const [lexicalResult, queryEmbedding] = await Promise.all([lexicalPromise, embeddingPromise])

  const lexicalItems = lexicalResult.rows.map(row => {
    const haystack = `${row.document_title} ${row.heading || ''} ${row.content}`.toLowerCase()
    const overlap = terms.length ? terms.filter(term => haystack.includes(term)).length / terms.length : 0
    const lexicalScore = Number(row.lexical_score || 0) * 0.65 + overlap * 0.35
    return { row, lexicalScore }
  }).filter(item => item.lexicalScore >= 0.025)

  if (!queryEmbedding) {
    return lexicalItems
      .sort((a, b) => b.lexicalScore - a.lexicalScore)
      .slice(0, limit)
      .map(({ row, lexicalScore }) => ({
        chunkId: row.chunk_id,
        documentId: row.document_id,
        knowledgeBaseId: row.knowledge_base_id,
        knowledgeBase: row.knowledge_base,
        documentTitle: row.document_title,
        heading: row.heading,
        excerpt: row.content.slice(0, 420),
        score: lexicalScore,
        lexicalScore,
        retrievalMode: 'lexical'
      }))
  }

  const queryVector = `'[${queryEmbedding.join(',')}]'::vector`

  const semanticResult = await pool.query<RetrievalRow>(`
    select
      kc.id as chunk_id,
      kd.id as document_id,
      kb.id as knowledge_base_id,
      kb.name as knowledge_base,
      kd.title as document_title,
      kc.heading,
      kc.content,
      1 - (kc.embedding <=> ${queryVector}) as semantic_score
    from knowledge_chunks kc
    join knowledge_documents kd on kd.id = kc.document_id
    join knowledge_bases kb on kb.id = kc.knowledge_base_id
    where kb.status = 'published'
      and kd.status = 'ready'
      and kc.embedding is not null
      and (kb.scope = 'global' or (kb.scope = 'school' and kb.school_id = $1))
    order by kc.embedding <=> ${queryVector}
    limit 30
  `, [schoolId])

  const candidates = new Map<string, {
    row: RetrievalRow
    lexicalScore: number
    semanticScore: number
    lexicalRank?: number
    semanticRank?: number
  }>()
  lexicalItems.forEach((item, index) => candidates.set(item.row.chunk_id, {
    row: item.row,
    lexicalScore: item.lexicalScore,
    semanticScore: 0,
    lexicalRank: index + 1
  }))
  semanticResult.rows.forEach((row, index) => {
    const semanticScore = Math.max(0, Number(row.semantic_score || 0))
    const existing = candidates.get(row.chunk_id)
    candidates.set(row.chunk_id, existing
      ? { ...existing, semanticScore, semanticRank: index + 1 }
      : { row, lexicalScore: 0, semanticScore, semanticRank: index + 1 })
  })

  const bestRankScore = 1 / 61
  return [...candidates.values()].map(item => {
    const reciprocalRank = (
      (item.lexicalRank ? 0.45 / (60 + item.lexicalRank) : 0) +
      (item.semanticRank ? 0.55 / (60 + item.semanticRank) : 0)
    ) / bestRankScore
    const rawScore = item.lexicalScore * 0.45 + item.semanticScore * 0.55
    const score = reciprocalRank * 0.6 + rawScore * 0.4
    return {
      chunkId: item.row.chunk_id,
      documentId: item.row.document_id,
      knowledgeBaseId: item.row.knowledge_base_id,
      knowledgeBase: item.row.knowledge_base,
      documentTitle: item.row.document_title,
      heading: item.row.heading,
      excerpt: item.row.content.slice(0, 420),
      score,
      lexicalScore: item.lexicalScore,
      semanticScore: item.semanticScore,
      retrievalMode: 'hybrid' as const
    }
  }).filter(item => item.semanticScore >= 0.18 || item.lexicalScore >= 0.025)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

async function retrieveModuleResourceKnowledge(event: H3Event, schoolId: string, query: string, limit: number, options: {
  module: ModuleId
  secondaryModules?: ModuleId[]
  libraryTypes?: LibraryType[]
}): Promise<KnowledgeCitation[]> {
  const pool = usePool(event)
  const sanitizedQuery = query.replace(/1[3-9]\d{9}/g, '[PHONE]').replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]').slice(0, 2000)
  const terms = queryTerms(sanitizedQuery)
  const modules = [options.module, ...(options.secondaryModules || [])].filter((item, index, array) => array.indexOf(item) === index)
  const libraryTypes = options.libraryTypes?.length
    ? options.libraryTypes
    : ['professional_knowledge', 'sop', 'tool', 'script', 'case', 'prompt'] as LibraryType[]
  type ResourceRow = {
    chunk_id: string
    document_id: string
    library_id: string
    version_id: string
    module: ModuleId
    library_type: LibraryType
    resource_title: string
    document_title: string
    heading: string | null
    content: string
    lexical_score?: number
    semantic_score?: number
    term_hits?: number
  }
  const lexicalPromise = pool.query<ResourceRow>(`
    select
      mc.id as chunk_id,
      md.id as document_id,
      ml.id as library_id,
      mv.id as version_id,
      ml.module,
      ml.library_type,
      ml.name as resource_title,
      md.title as document_title,
      mc.heading,
      mc.content,
      greatest(
        similarity(left(mc.content, 2400), $1),
        similarity(coalesce(mc.heading, ''), $1) * 1.4,
        similarity(md.title, $1) * 1.2,
        similarity(ml.name, $1) * 1.1
      ) as lexical_score,
      (select count(*)::int from unnest($5::text[]) as term where position(term in lower(mc.content || ' ' || coalesce(mc.heading, '') || ' ' || md.title || ' ' || ml.name)) > 0) as term_hits
    from module_resource_chunks mc
    join module_resource_documents md on md.id = mc.document_id
    join module_resource_versions mv on mv.id = mc.version_id
    join module_resource_libraries ml on ml.id = mc.library_id
    where mv.status = 'published'
      and md.status = 'ready'
      and ml.module = any($2::text[])
      and ml.library_type = any($3::text[])
      and (ml.scope = 'global' or (ml.scope = 'school' and ml.school_id = $4))
      and not (
        ml.scope = 'global'
        and exists (
          select 1
          from module_resource_libraries sl
          join module_resource_versions sv on sv.library_id = sl.id and sv.status = 'published'
          where sl.scope = 'school'
            and sl.school_id = $4
            and sl.module = ml.module
            and sl.library_type = ml.library_type
        )
      )
    order by term_hits desc, lexical_score desc, mc.created_at desc
    limit 40
  `, [sanitizedQuery, modules, libraryTypes, schoolId, terms])

  const embeddingPromise = embedKnowledgeQuery(event, sanitizedQuery).catch(() => null)
  const [lexicalResult, queryEmbedding] = await Promise.all([lexicalPromise, embeddingPromise])
  const moduleRank = new Map(modules.map((module, index) => [module, index]))
  const typeRank = new Map(libraryTypes.map((type, index) => [type, index]))
  const lexicalItems = lexicalResult.rows.map(row => {
    const haystack = `${row.resource_title} ${row.document_title} ${row.heading || ''} ${row.content}`.toLowerCase()
    const overlap = terms.length ? terms.filter(term => haystack.includes(term)).length / terms.length : 0
    const lexicalScore = Number(row.lexical_score || 0) * 0.65 + overlap * 0.35
    return { row, lexicalScore }
  }).filter(item => item.lexicalScore >= 0.025)

  if (!queryEmbedding) {
    return lexicalItems
      .sort((a, b) => byResourcePriority(a.row, b.row, moduleRank, typeRank) || b.lexicalScore - a.lexicalScore)
      .slice(0, limit)
      .map(({ row, lexicalScore }) => toResourceCitation(row, lexicalScore, lexicalScore, 0, 'lexical'))
  }

  const queryVector = `'[${queryEmbedding.join(',')}]'::vector`
  const semanticResult = await pool.query<ResourceRow>(`
    select
      mc.id as chunk_id,
      md.id as document_id,
      ml.id as library_id,
      mv.id as version_id,
      ml.module,
      ml.library_type,
      ml.name as resource_title,
      md.title as document_title,
      mc.heading,
      mc.content,
      1 - (mc.embedding <=> ${queryVector}) as semantic_score
    from module_resource_chunks mc
    join module_resource_documents md on md.id = mc.document_id
    join module_resource_versions mv on mv.id = mc.version_id
    join module_resource_libraries ml on ml.id = mc.library_id
    where mv.status = 'published'
      and md.status = 'ready'
      and mc.embedding is not null
      and ml.module = any($1::text[])
      and ml.library_type = any($2::text[])
      and (ml.scope = 'global' or (ml.scope = 'school' and ml.school_id = $3))
      and not (
        ml.scope = 'global'
        and exists (
          select 1
          from module_resource_libraries sl
          join module_resource_versions sv on sv.library_id = sl.id and sv.status = 'published'
          where sl.scope = 'school'
            and sl.school_id = $3
            and sl.module = ml.module
            and sl.library_type = ml.library_type
        )
      )
    order by mc.embedding <=> ${queryVector}
    limit 40
  `, [modules, libraryTypes, schoolId])

  const candidates = new Map<string, { row: ResourceRow, lexicalScore: number, semanticScore: number, lexicalRank?: number, semanticRank?: number }>()
  lexicalItems.forEach((item, index) => candidates.set(item.row.chunk_id, { row: item.row, lexicalScore: item.lexicalScore, semanticScore: 0, lexicalRank: index + 1 }))
  semanticResult.rows.forEach((row, index) => {
    const semanticScore = Math.max(0, Number(row.semantic_score || 0))
    const existing = candidates.get(row.chunk_id)
    candidates.set(row.chunk_id, existing
      ? { ...existing, semanticScore, semanticRank: index + 1 }
      : { row, lexicalScore: 0, semanticScore, semanticRank: index + 1 })
  })

  const bestRankScore = 1 / 61
  return [...candidates.values()].map(item => {
    const reciprocalRank = ((item.lexicalRank ? 0.45 / (60 + item.lexicalRank) : 0) + (item.semanticRank ? 0.55 / (60 + item.semanticRank) : 0)) / bestRankScore
    const rawScore = item.lexicalScore * 0.45 + item.semanticScore * 0.55
    const score = reciprocalRank * 0.6 + rawScore * 0.4
    return { item, score }
  }).filter(({ item }) => item.semanticScore >= 0.18 || item.lexicalScore >= 0.025)
    .sort((a, b) => byResourcePriority(a.item.row, b.item.row, moduleRank, typeRank) || b.score - a.score)
    .slice(0, limit)
    .map(({ item, score }) => toResourceCitation(item.row, score, item.lexicalScore, item.semanticScore, 'hybrid'))
}

function byResourcePriority(a: { module: ModuleId, library_type: LibraryType }, b: { module: ModuleId, library_type: LibraryType }, moduleRank: Map<ModuleId, number>, typeRank: Map<LibraryType, number>) {
  return (moduleRank.get(a.module) ?? 99) - (moduleRank.get(b.module) ?? 99)
    || (typeRank.get(a.library_type) ?? 99) - (typeRank.get(b.library_type) ?? 99)
}

function toResourceCitation(row: {
  chunk_id: string
  document_id: string
  library_id: string
  version_id: string
  module: ModuleId
  library_type: LibraryType
  resource_title: string
  document_title: string
  heading: string | null
  content: string
}, score: number, lexicalScore: number, semanticScore: number, retrievalMode: 'hybrid' | 'lexical'): KnowledgeCitation {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    knowledgeBaseId: row.library_id,
    knowledgeBase: row.resource_title,
    documentTitle: row.document_title,
    heading: row.heading,
    excerpt: row.content.slice(0, 420),
    score,
    lexicalScore,
    semanticScore,
    retrievalMode,
    module: row.module,
    libraryType: row.library_type,
    resourceVersionId: row.version_id,
    resourceTitle: row.resource_title
  }
}
