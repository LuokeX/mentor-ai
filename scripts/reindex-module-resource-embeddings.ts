import { Pool } from 'pg'
import { loadLocalEnv } from './load-env'
import { DEFAULT_EMBEDDING_MODEL } from '../server/integrations/ollama'
import { requestProviderEmbeddings, type EmbeddingProvider } from '../server/integrations/embeddings'

loadLocalEnv()

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
if (process.env.EMBEDDING_ENABLED !== 'true') {
  process.stdout.write('Embedding is disabled; skipping module resource reindex\n')
  process.exit(0)
}

const provider = (process.env.EMBEDDING_PROVIDER === 'dashscope' ? 'dashscope' : 'ollama') as EmbeddingProvider
const model = process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL
const config = {
  provider,
  model,
  baseUrl: provider === 'dashscope'
    ? process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    : process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  apiKey: process.env.DASHSCOPE_API_KEY || '',
  timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS || 30_000)
}
const pool = new Pool({ connectionString: databaseUrl })
let indexed = 0

try {
  while (true) {
    const batch = await pool.query<{ id: string, heading: string | null, content: string }>(`
      select id, heading, content
      from module_resource_chunks
      where embedding is null or embedding_model is distinct from $1
      order by created_at
      limit 16
    `, [model])
    if (!batch.rows.length) break

    const embeddings = await requestProviderEmbeddings(config, batch.rows.map(row => `${row.heading ? `${row.heading}\n` : ''}${row.content}`))
    await pool.query('begin')
    try {
      for (let index = 0; index < batch.rows.length; index++) {
        await pool.query(`
          update module_resource_chunks
          set embedding = $2::vector, embedding_model = $3, embedded_at = now()
          where id = $1
        `, [batch.rows[index]!.id, `[${embeddings[index]!.join(',')}]`, model])
      }
      await pool.query('commit')
    } catch (error) {
      await pool.query('rollback')
      throw error
    }
    indexed += batch.rows.length
    process.stdout.write(`Indexed ${indexed} module resource chunks\n`)
  }

  // 更新 module_resource_documents 的 metadata 统计
  await pool.query(`
    update module_resource_documents md
    set metadata = md.metadata || jsonb_build_object(
      'embeddedChunkCount', summary.embedded_count,
      'embeddingStatus', case when summary.embedded_count = summary.chunk_count then 'ready' else 'pending' end
    ), updated_at = now()
    from (
      select document_id, count(*)::int as chunk_count, count(embedding)::int as embedded_count
      from module_resource_chunks
      group by document_id
    ) summary
    where md.id = summary.document_id
  `)
  process.stdout.write(`Module resource embedding reindex completed: ${indexed} chunks updated\n`)
} finally {
  await pool.end()
}