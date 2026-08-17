// 给 module_resource_chunks 表中没有 embedding 的片段生成向量
import { Pool } from 'pg'

// 优先从 .env 文件读取 DATABASE_URL
import { readFileSync } from 'fs'
function loadEnvDatabaseUrl() {
  try {
    const content = readFileSync('.env', 'utf-8')
    const match = content.match(/^DATABASE_URL\s*=\s*(.+)$/m)
    if (match) return match[1].trim()
  } catch {}
  return null
}
function resolveConnection() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const fromFile = loadEnvDatabaseUrl()
  if (fromFile) return fromFile
  // 不内置连接凭据：缺失时明确报错，引导配置 .env
  throw new Error('DATABASE_URL 未配置：请复制 .env.example 为 .env 或在环境变量中设置 DATABASE_URL')
}
const CONNECTION = resolveConnection()
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const MODEL = process.env.EMBEDDING_MODEL || 'qwen3-embedding:0.6b'
const BATCH_SIZE = 10

const pg = new Pool({ connectionString: CONNECTION })

async function embed(texts) {
  const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts, truncate: true }),
    signal: AbortSignal.timeout(60000)
  })
  if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await resp.text().catch(() => '')}`)
  const data = await resp.json()
  return data.embeddings
}

async function main() {
  // 查询所有 embedding 为 NULL 的 chunks
  const { rows } = await pg.query(`
    SELECT c.id AS chunk_id, c.chunk_index, c.content, c.heading,
           c.document_id, c.version_id, c.library_id,
           d.title AS doc_title
    FROM module_resource_chunks c
    JOIN module_resource_documents d ON c.document_id = d.id
    WHERE c.embedding IS NULL
    ORDER BY c.document_id, c.chunk_index
  `)

  if (!rows.length) {
    console.log('所有模块资源片段已有向量，无需处理。')
    await pg.end()
    return
  }

  console.log(`共 ${rows.length} 个待处理片段`)

  // 按 document 分组，方便日志
  const byDoc = new Map()
  for (const r of rows) {
    if (!byDoc.has(r.document_id)) byDoc.set(r.document_id, [])
    byDoc.get(r.document_id).push(r)
  }

  let done = 0
  for (const [docId, chunks] of byDoc) {
    const texts = chunks.map(c => `${c.heading ? c.heading + '\n' : ''}${c.content}`)
    const docTitle = chunks[0].doc_title
    console.log(`文档 "${docTitle}" (${docId}): ${chunks.length} 个片段, 正在向量化...`)

    // 分批调用 Ollama
    const allEmbeddings = []
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)
      const embs = await embed(batch)
      allEmbeddings.push(...embs)
    }

    // 回写每个 chunk 的 embedding
    for (let i = 0; i < chunks.length; i++) {
      // pgvector 接受 '[0.1, 0.2, ...]' 格式的字符串
      await pg.query(
        `UPDATE module_resource_chunks SET embedding = $1::vector, embedding_model = $2, embedded_at = NOW() WHERE id = $3`,
        [JSON.stringify(allEmbeddings[i]), MODEL, chunks[i].chunk_id]
      )
    }

    // 更新文档状态为 ready，metadata 记录已向量化
    await pg.query(
      `UPDATE module_resource_documents 
       SET status = 'ready', 
           metadata = jsonb_set(
             COALESCE(metadata, '{}'::jsonb), 
             '{embeddedChunkCount}', 
             to_jsonb($1::int)
           ),
           updated_at = NOW()
       WHERE id = $2`,
      [chunks.length, docId]
    )

    done += chunks.length
    console.log(`  完成 ${done}/${rows.length}`)
  }

  console.log(`\n全部完成。${rows.length} 个片段已向量化 (模型: ${MODEL})。`)
  await pg.end()
}

main().catch(e => { console.error(e); process.exit(1) })