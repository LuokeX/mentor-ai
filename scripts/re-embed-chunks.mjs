// 给 knowledge_chunks 表中没有 embedding 的片段重新生成向量
import { Pool } from 'pg'

const pg = new Pool({ connectionString: 'postgres://mentor_admin:e99ed52b2799dba76638a35842c5841f4781407d4b2ab755e5244fd939078c89@localhost:5432/mentor_ai' })

const OLLAMA_URL = 'http://localhost:11434'
const MODEL = 'qwen3-embedding:0.6b'
const BATCH_SIZE = 10

async function embed(texts) {
  const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts, truncate: true }),
    signal: AbortSignal.timeout(30000)
  })
  if (!resp.ok) throw new Error(`Ollama ${resp.status}`)
  const data = await resp.json()
  return data.embeddings
}

async function main() {
  const { rows } = await pg.query(`
    SELECT d.id AS doc_id, d.knowledge_base_id, c.id AS chunk_id,
           c.chunk_index, c.content, c.heading
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.embedding IS NULL
    ORDER BY d.id, c.chunk_index
  `)

  if (!rows.length) {
    console.log('所有片段已有向量，无需处理。')
    await pg.end()
    return
  }

  console.log(`共 ${rows.length} 个待处理片段`)

  // 按文档分组
  const byDoc = new Map()
  for (const r of rows) {
    if (!byDoc.has(r.doc_id)) byDoc.set(r.doc_id, [])
    byDoc.get(r.doc_id).push(r)
  }

  let done = 0
  for (const [docId, chunks] of byDoc) {
    const texts = chunks.map(c => `${c.heading ? c.heading + '\n' : ''}${c.content}`)
    console.log(`文档 ${docId}: ${chunks.length} 个片段, 正在向量化...`)

    // 分批调用 Ollama
    const allEmbeddings = []
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)
      const embs = await embed(batch)
      allEmbeddings.push(...embs)
    }

    // 回写每个 chunk 的 embedding
    for (let i = 0; i < chunks.length; i++) {
      await pg.query(
        `UPDATE knowledge_chunks SET embedding = $1, embedding_model = $2, embedded_at = NOW() WHERE id = $3`,
        [JSON.stringify(allEmbeddings[i]), MODEL, chunks[i].chunk_id]
      )
    }

    // 更新文档 metadata
    await pg.query(
      `UPDATE knowledge_documents SET metadata = jsonb_set(metadata, '{embeddedChunkCount}', to_jsonb($1::int)) WHERE id = $2`,
      [chunks.length, docId]
    )

    done += chunks.length
    console.log(`  完成 ${done}/${rows.length}`)
  }

  console.log(`\n全部完成。${rows.length} 个片段已向量化。`)
  await pg.end()
}

main().catch(e => { console.error(e); process.exit(1) })