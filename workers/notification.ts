import pg from 'pg'
import { loadLocalEnv } from '../scripts/load-env'

loadLocalEnv()
const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required; copy .env.example to .env first')
const pool = new Pool({ connectionString: databaseUrl, max: 2 })
const retrySeconds = [60, 300, 900, 3600]

async function sendNotification(payload: Record<string, unknown>, deduplicationKey: string) {
  const provider = process.env.SMS_PROVIDER || 'mock'
  if (provider === 'mock') {
    process.stdout.write(`${JSON.stringify({ level: 'info', event: 'sms.mock', recipients: payload.recipients, message: payload.message })}\n`)
    return
  }
  if (provider === 'webhook') {
    const url = process.env.SMS_WEBHOOK_URL
    if (!url) throw new Error('SMS_WEBHOOK_URL is required for webhook provider')
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: process.env.SMS_WEBHOOK_TOKEN ? `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` : '',
        'idempotency-key': deduplicationKey
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) throw new Error(`SMS webhook returned ${response.status}`)
    return
  }
  throw new Error(`Unsupported SMS_PROVIDER: ${provider}`)
}

async function takeOne() {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`
      update notification_outbox
      set status='pending', locked_at=null, next_attempt_at=now(), last_error='worker lock expired'
      where status='processing' and locked_at < now() - interval '2 minutes'
    `)
    const result = await client.query(`
      select id, payload, attempts, deduplication_key from notification_outbox
      where status = 'pending' and next_attempt_at <= now()
      order by created_at asc
      for update skip locked limit 1
    `)
    const job = result.rows[0]
    if (!job) {
      await client.query('commit')
      return false
    }
    await client.query(`update notification_outbox set status='processing', locked_at=now(), attempts=attempts+1 where id=$1`, [job.id])
    await client.query('commit')
    try {
      await sendNotification(job.payload, job.deduplication_key)
      await pool.query(`update notification_outbox set status='sent', sent_at=now(), locked_at=null where id=$1`, [job.id])
    } catch (error) {
      const attempts = Number(job.attempts) + 1
      const retry = retrySeconds[Math.min(attempts - 1, retrySeconds.length - 1)]
      const terminal = attempts >= retrySeconds.length
      await pool.query(`
        update notification_outbox
        set status=$2, next_attempt_at=now()+($3 || ' seconds')::interval, locked_at=null, last_error=$4
        where id=$1
      `, [job.id, terminal ? 'failed' : 'pending', String(retry), error instanceof Error ? error.message : 'Unknown error'])
    }
    return true
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

process.stdout.write(`${JSON.stringify({ level: 'info', event: 'notification.worker.started' })}\n`)
while (true) {
  const worked = await takeOne().catch((error) => {
    process.stderr.write(`${JSON.stringify({ level: 'error', event: 'notification.worker.error', message: error instanceof Error ? error.message : String(error) })}\n`)
    return false
  })
  await new Promise(resolve => setTimeout(resolve, worked ? 100 : 1000))
}
