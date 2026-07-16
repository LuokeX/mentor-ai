import { sql } from 'drizzle-orm'
import { decryptSensitive } from '../utils/crypto'
import { usePool } from '../utils/db'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  const pool = usePool()
  const retrySeconds = [60, 300, 900, 3600]
  const SCAN_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
  let lastScanTime = 0

  async function sendNotification(payload: Record<string, unknown>, dedupKey: string) {
    const provider: string = config.smsProvider || 'mock'
    if (provider === 'mock') {
      console.log(JSON.stringify({ level: 'info', event: 'sms.mock', recipients: payload.recipients, message: payload.message }))
      return
    }
    if (provider === 'webhook') {
      const url: string = config.smsWebhookUrl
      if (!url) throw new Error('SMS_WEBHOOK_URL is required for webhook provider')
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: process.env.SMS_WEBHOOK_TOKEN ? `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` : '',
          'idempotency-key': dedupKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error(`SMS webhook returned ${response.status}`)
      return
    }
    throw new Error(`Unsupported SMS_PROVIDER: ${provider}`)
  }

  async function scanOverduePlans(): Promise<number> {
    const { rows: overduePlans } = await pool.query<{
      id: string; title: string; schoolId: string; studentNameEnc: string | null; updatedAt: string
    }>(`
      SELECT p.id, p.title, p.school_id as "schoolId",
             s.name_enc as "studentNameEnc", p.updated_at as "updatedAt"
      FROM plans p
      LEFT JOIN students s ON s.id = p.student_id
      WHERE p.status = 'in_progress'
        AND p.updated_at < NOW() - INTERVAL '7 days'
    `)

    if (overduePlans.length === 0) return 0

    const today = new Date().toISOString().slice(0, 10)
    let inserted = 0

    const schoolIds = [...new Set(overduePlans.map(p => p.schoolId))]
    const { rows: settingsRows } = await pool.query<{ schoolId: string; smsRecipients: string[] }>(
      `SELECT school_id as "schoolId", sms_recipients as "smsRecipients" FROM school_settings WHERE school_id = ANY($1)`,
      [schoolIds]
    )
    const recipientsBySchool = new Map(settingsRows.map(r => [r.schoolId, r.smsRecipients || []]))

    for (const plan of overduePlans) {
      const dedupKey = `plan:${plan.id}:${today}`
      const { rows: existing } = await pool.query(
        `SELECT id FROM notification_outbox WHERE deduplication_key = $1`, [dedupKey]
      )
      if (existing.length > 0) continue

      const daysSinceUpdate = Math.floor((Date.now() - new Date(plan.updatedAt).getTime()) / 86_400_000)
      let studentName = ''
      if (plan.studentNameEnc) {
        try { studentName = decryptSensitive(plan.studentNameEnc, config.encryptionKey as string) } catch { /* keep empty */ }
      }

      const payload = {
        planId: plan.id, planTitle: plan.title, studentName, daysSinceUpdate,
        recipients: recipientsBySchool.get(plan.schoolId) || [],
        message: studentName
          ? `[智慧导师] 学生「${studentName}」的方案「${plan.title}」已超期 ${daysSinceUpdate} 天未更新，请及时复盘。`
          : `[智慧导师] 方案「${plan.title}」已超期 ${daysSinceUpdate} 天未更新，请及时复盘。`,
      }

      try {
        await pool.query(
          `INSERT INTO notification_outbox (school_id, event_type, deduplication_key, payload)
           VALUES ($1, 'plan_overdue', $2, $3) ON CONFLICT (deduplication_key) DO NOTHING`,
          [plan.schoolId, dedupKey, JSON.stringify(payload)]
        )
        inserted++
        console.log(JSON.stringify({ level: 'info', event: 'plan_overdue.inserted', planId: plan.id, dedupKey }))
      } catch (err) {
        console.error(JSON.stringify({ level: 'error', event: 'plan_overdue.insert_error', planId: plan.id, message: err instanceof Error ? err.message : String(err) }))
      }
    }
    return inserted
  }

  async function takeOne(): Promise<boolean> {
    const client = await pool.connect()
    try {
      await client.query('begin')
      // Release stale locks
      await client.query(`
        UPDATE notification_outbox
        SET status='pending', locked_at=null, next_attempt_at=now(), last_error='worker lock expired'
        WHERE status='processing' AND locked_at < now() - interval '2 minutes'
      `)
      const result = await client.query(`
        SELECT id, payload, attempts, deduplication_key FROM notification_outbox
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED LIMIT 1
      `)
      const job = result.rows[0]
      if (!job) {
        await client.query('commit')
        return false
      }
      await client.query(
        `UPDATE notification_outbox SET status='processing', locked_at=now(), attempts=attempts+1 WHERE id=$1`,
        [job.id]
      )
      await client.query('commit')
      try {
        await sendNotification(job.payload, job.deduplication_key)
        await pool.query(`UPDATE notification_outbox SET status='sent', sent_at=now(), locked_at=null WHERE id=$1`, [job.id])
      } catch (error) {
        const attempts = Number(job.attempts) + 1
        const retry = retrySeconds[Math.min(attempts - 1, retrySeconds.length - 1)]
        const terminal = attempts >= retrySeconds.length
        await pool.query(`
          UPDATE notification_outbox
          SET status=$2, next_attempt_at=now()+($3 || ' seconds')::interval, locked_at=null, last_error=$4
          WHERE id=$1
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

  console.log(JSON.stringify({ level: 'info', event: 'notification.worker.started' }))

  // Initial overdue scan
  scanOverduePlans().catch(() => {})
  lastScanTime = Date.now()

  // Poll every second for pending notifications + hourly overdue scan
  setInterval(async () => {
    try {
      await takeOne()
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'notification.worker.error', message: error instanceof Error ? error.message : String(error) }))
    }

    if (Date.now() - lastScanTime >= SCAN_INTERVAL_MS) {
      try {
        const count = await scanOverduePlans()
        lastScanTime = Date.now()
        if (count > 0) {
          console.log(JSON.stringify({ level: 'info', event: 'plan_overdue.scan', inserted: count }))
        }
      } catch (error) {
        console.error(JSON.stringify({ level: 'error', event: 'plan_overdue.scan_error', message: error instanceof Error ? error.message : String(error) }))
      }
    }
  }, 1000)
})