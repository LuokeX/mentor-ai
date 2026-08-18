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

  async function scanOperationalReminders(): Promise<number> {
    let inserted = 0
    // 普通业务提醒只进入负责教师个人通知中心，绝不进入短信 Outbox。
    const actionResult = await pool.query(`
      INSERT INTO notifications (school_id, user_id, type, title, body, target_type, target_id, deduplication_key)
      SELECT pa.school_id, pa.owner_user_id, 'plan_action_due', '方案动作待处理',
             CASE WHEN pa.due_at < NOW() THEN '有一项方案动作已逾期，请及时处理。' ELSE '有一项方案动作今日到期。' END,
             'plan_action', pa.id, 'plan-action:' || pa.id::text || ':' || CURRENT_DATE::text
      FROM plan_actions pa
      JOIN plans p ON p.id = pa.plan_id
      WHERE pa.status IN ('pending', 'in_progress')
        AND pa.decision = 'included'
        AND pa.due_at IS NOT NULL AND pa.due_at < CURRENT_DATE + INTERVAL '1 day'
        AND p.status = 'in_progress'
      ON CONFLICT (deduplication_key) DO NOTHING
    `)
    inserted += actionResult.rowCount || 0
    const reviewResult = await pool.query(`
      INSERT INTO notifications (school_id, user_id, type, title, body, target_type, target_id, deduplication_key)
      SELECT p.school_id, p.owner_user_id, 'plan_review_due', '方案待复盘',
             '有一份方案已到复盘时间，请记录效果和下一步。',
             'plan', p.id, 'plan-review:' || p.id::text || ':' || CURRENT_DATE::text
      FROM plans p
      WHERE p.status = 'in_progress' AND p.next_review_at IS NOT NULL AND p.next_review_at < CURRENT_DATE + INTERVAL '1 day'
      ON CONFLICT (deduplication_key) DO NOTHING
    `)
    inserted += reviewResult.rowCount || 0

    // 超过 15 分钟仍未确认，升级短信只包含事件编号和登录提示。
    const { rows: overdueReferrals } = await pool.query<{
      id: string, schoolId: string, safetyEventId: string, recipients: string[]
    }>(`
      SELECT r.id, r.school_id AS "schoolId", r.safety_event_id AS "safetyEventId",
             CASE WHEN jsonb_array_length(COALESCE(ss.safety_contact_recipients, '[]'::jsonb)) > 0
               THEN ss.safety_contact_recipients ELSE COALESCE(ss.sms_recipients, '[]'::jsonb) END AS recipients
      FROM referrals r
      LEFT JOIN school_settings ss ON ss.school_id = r.school_id
      WHERE r.acknowledged_at IS NULL AND r.escalated_at IS NULL
        AND r.escalation_due_at IS NOT NULL AND r.escalation_due_at <= NOW()
    `)
    for (const referral of overdueReferrals) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const updated = await client.query(`
          UPDATE referrals SET status='escalated', escalated_at=NOW(), updated_at=NOW()
          WHERE id=$1 AND acknowledged_at IS NULL AND escalated_at IS NULL RETURNING id
        `, [referral.id])
        if (!updated.rowCount) { await client.query('ROLLBACK'); continue }
        await client.query(`
          INSERT INTO referral_events (school_id, referral_id, event_type, from_status, to_status, metadata)
          VALUES ($1, $2, 'auto_escalated', 'created', 'escalated', '{"reason":"sla_timeout"}'::jsonb)
        `, [referral.schoolId, referral.id])
        await client.query(`
          INSERT INTO notification_outbox (school_id, event_type, deduplication_key, payload)
          VALUES ($1, 'crisis_escalation', $2, $3) ON CONFLICT (deduplication_key) DO NOTHING
        `, [referral.schoolId, `referral-escalation:${referral.id}`, JSON.stringify({
          eventId: referral.safetyEventId,
          referralId: referral.id,
          recipients: referral.recipients || [],
          message: `教师赋能平台危机事件 ${referral.safetyEventId.slice(0, 8)} 已超时升级，请立即登录处置。`
        })])
        await client.query('COMMIT')
        inserted++
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        console.error(JSON.stringify({ level: 'error', event: 'referral.escalation_error', referralId: referral.id, message: error instanceof Error ? error.message : String(error) }))
      } finally { client.release() }
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

  // Initial operational scan
  scanOperationalReminders().catch(() => {})
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
        const count = await scanOperationalReminders()
        lastScanTime = Date.now()
        if (count > 0) {
          console.log(JSON.stringify({ level: 'info', event: 'operational_reminders.scan', inserted: count }))
        }
      } catch (error) {
        console.error(JSON.stringify({ level: 'error', event: 'operational_reminders.scan_error', message: error instanceof Error ? error.message : String(error) }))
      }
    }
  }, 1000)
})
