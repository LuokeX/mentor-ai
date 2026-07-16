import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { usePool } from '../utils/db'
import { embedKnowledgeQuery } from '../integrations/ollama'

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

function queryTerms(value: string) {
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

export async function retrieveKnowledge(event: H3Event, schoolId: string, query: string, limit = 6): Promise<KnowledgeCitation[]> {
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
