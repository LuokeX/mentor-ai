/**
 * C 端积分账本、签到、任务与会员。
 *
 * 所有金额变更都写 cend_point_transactions；扣费采用「先冻结（pending）→ 成功结算
 * （settled）/ 失败退回（refunded）」。幂等键唯一约束 + 账户行锁保证并发不双花。
 */
import { and, desc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm'
import { addDays, shanghaiDateKey } from '../../shared/dashboard'
import { type DbClient, schema } from '../utils/db'

export const CEND_POINT_COSTS = {
  aiQuestion: 100,
  assessmentPlan: 200
} as const

export const CEND_SIGNUP_BONUS = 1000
export const CEND_CHECKIN_REWARD = 200
export const CEND_CHECKIN_STREAK_REWARD = 400

export const CEND_TASK_REWARDS = {
  first_question: 100,
  complete_profile: 200,
  submit_feedback: 300,
  use_7_days: 400
} as const satisfies Record<string, number>

export const CEND_TASK_KEYS = Object.keys(CEND_TASK_REWARDS) as Array<keyof typeof CEND_TASK_REWARDS>

export type CendPointTransaction = typeof schema.cendPointTransactions.$inferSelect
export type CendMembership = typeof schema.cendMemberships.$inferSelect
export type CendCheckin = typeof schema.cendCheckins.$inferSelect

export interface GrantPointsInput {
  userId: string
  /** 带符号金额：收入为正，支出为负 */
  amount: number
  type: string
  /** pending = 冻结；settled = 已结算 */
  status?: 'pending' | 'settled'
  idempotencyKey: string
  referenceType?: string | null
  referenceId?: string | null
  note?: string | null
  metadata?: Record<string, string | number | boolean | null>
}

export type GrantPointsResult =
  | { ok: true, transaction: CendPointTransaction, balance: number, duplicate: boolean }
  | { ok: false, reason: 'insufficient', balance: number }

/** 确保积分账户存在（幂等）。 */
export async function ensurePointAccount(db: DbClient, userId: string): Promise<void> {
  await db.insert(schema.cendPointAccounts).values({ userId, balance: 0 }).onConflictDoNothing()
}

/**
 * 在事务内发放/扣减积分。调用方负责事务边界；同一事务内可安全嵌套调用。
 * 先锁账户行，再查幂等键，避免并发重复扣减。
 */
export async function grantPointsTx(db: DbClient, input: GrantPointsInput): Promise<GrantPointsResult> {
  await ensurePointAccount(db, input.userId)
  const [account] = await db.select({ balance: schema.cendPointAccounts.balance })
    .from(schema.cendPointAccounts)
    .where(eq(schema.cendPointAccounts.userId, input.userId))
    .for('update')
    .limit(1)
  if (!account) throw new Error('积分账户不存在')

  const [existing] = await db.select().from(schema.cendPointTransactions).where(and(
    eq(schema.cendPointTransactions.userId, input.userId),
    eq(schema.cendPointTransactions.idempotencyKey, input.idempotencyKey)
  )).limit(1)
  if (existing) {
    return { ok: true, transaction: existing, balance: existing.balanceAfter, duplicate: true }
  }

  if (input.amount < 0 && account.balance + input.amount < 0) {
    return { ok: false, reason: 'insufficient', balance: account.balance }
  }

  const [updated] = await db.update(schema.cendPointAccounts).set({
    balance: sql`${schema.cendPointAccounts.balance} + ${input.amount}`,
    version: sql`${schema.cendPointAccounts.version} + 1`,
    updatedAt: new Date()
  }).where(eq(schema.cendPointAccounts.userId, input.userId)).returning({ balance: schema.cendPointAccounts.balance })
  if (!updated) throw new Error('积分账户更新失败')

  const [transaction] = await db.insert(schema.cendPointTransactions).values({
    userId: input.userId,
    amount: input.amount,
    balanceAfter: updated.balance,
    type: input.type,
    status: input.status ?? 'settled',
    idempotencyKey: input.idempotencyKey,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    note: input.note ?? null,
    metadata: input.metadata ?? {}
  }).returning()
  if (!transaction) throw new Error('积分流水写入失败')
  return { ok: true, transaction, balance: updated.balance, duplicate: false }
}

/** 独立事务版本：供不在事务中的调用方使用。 */
export async function grantPoints(db: DbClient, input: GrantPointsInput): Promise<GrantPointsResult> {
  return db.transaction(tx => grantPointsTx(tx, input))
}

/** 冻结一笔支出（pending）；失败返回积分不足。 */
export async function reservePoints(
  db: DbClient,
  input: Omit<GrantPointsInput, 'amount' | 'status' | 'type'> & { amount: number, type?: string }
): Promise<GrantPointsResult> {
  return grantPoints(db, {
    ...input,
    amount: -Math.abs(input.amount),
    type: input.type ?? 'ai_question',
    status: 'pending'
  })
}

/** 结算一笔冻结流水（成功回答/生成方案）。 */
export async function settlePointsTx(db: DbClient, transactionId: string): Promise<void> {
  await db.update(schema.cendPointTransactions)
    .set({ status: 'settled' })
    .where(and(
      eq(schema.cendPointTransactions.id, transactionId),
      eq(schema.cendPointTransactions.status, 'pending')
    ))
}

/** 退回一笔冻结/已结算支出；幂等。 */
export async function refundPointsTx(db: DbClient, transactionId: string, reason = '操作失败退回'): Promise<void> {
  const [original] = await db.select().from(schema.cendPointTransactions)
    .where(eq(schema.cendPointTransactions.id, transactionId)).limit(1)
  if (!original || original.amount >= 0) return
  if (original.status === 'refunded') return

  await db.update(schema.cendPointTransactions)
    .set({ status: 'refunded', note: reason })
    .where(eq(schema.cendPointTransactions.id, transactionId))

  await grantPointsTx(db, {
    userId: original.userId,
    amount: -original.amount,
    type: 'refund',
    status: 'settled',
    idempotencyKey: `refund:${original.id}`,
    referenceType: 'point_transaction',
    referenceId: original.id,
    note: reason
  })
}

export async function refundPoints(db: DbClient, transactionId: string, reason = '操作失败退回'): Promise<void> {
  await db.transaction(tx => refundPointsTx(tx, transactionId, reason))
}

/** 当前有效会员（未开始/已过期/已撤销都不算）。 */
export async function activeMembership(db: DbClient, userId: string): Promise<CendMembership | null> {
  const now = new Date()
  const [row] = await db.select().from(schema.cendMemberships).where(and(
    eq(schema.cendMemberships.userId, userId),
    eq(schema.cendMemberships.status, 'active'),
    lte(schema.cendMemberships.startAt, now),
    gt(schema.cendMemberships.endAt, now)
  )).orderBy(desc(schema.cendMemberships.endAt)).limit(1)
  return row ?? null
}

/** 一次性任务奖励；已完成则返回 awarded=false。 */
export async function grantTaskRewardTx(
  db: DbClient,
  userId: string,
  taskKey: string
): Promise<{ awarded: boolean, reward: number }> {
  const reward = (CEND_TASK_REWARDS as Record<string, number>)[taskKey]
  if (!reward) return { awarded: false, reward: 0 }
  const [existing] = await db.select({ id: schema.cendTaskCompletions.id })
    .from(schema.cendTaskCompletions)
    .where(and(eq(schema.cendTaskCompletions.userId, userId), eq(schema.cendTaskCompletions.taskKey, taskKey)))
    .limit(1)
  if (existing) return { awarded: false, reward }
  const inserted = await db.insert(schema.cendTaskCompletions).values({ userId, taskKey, reward })
    .onConflictDoNothing().returning({ id: schema.cendTaskCompletions.id })
  if (!inserted.length) return { awarded: false, reward }
  await grantPointsTx(db, {
    userId,
    amount: reward,
    type: 'task_reward',
    status: 'settled',
    idempotencyKey: `task:${taskKey}`,
    referenceType: 'cend_task',
    referenceId: taskKey
  })
  return { awarded: true, reward }
}

export async function grantTaskReward(db: DbClient, userId: string, taskKey: string) {
  return db.transaction(tx => grantTaskRewardTx(tx, userId, taskKey))
}

/** 每日签到：东八区自然日；返回连续天数与奖励。 */
export async function checkInTx(db: DbClient, userId: string): Promise<{
  already: boolean
  streak: number
  reward: number
  balance: number
  checkin: CendCheckin | null
}> {
  const today = shanghaiDateKey(new Date())
  const [existing] = await db.select().from(schema.cendCheckins)
    .where(and(eq(schema.cendCheckins.userId, userId), eq(schema.cendCheckins.checkinDate, today)))
    .limit(1)
  if (existing) {
    const [account] = await db.select({ balance: schema.cendPointAccounts.balance })
      .from(schema.cendPointAccounts).where(eq(schema.cendPointAccounts.userId, userId)).limit(1)
    return { already: true, streak: existing.streak, reward: 0, balance: account?.balance ?? 0, checkin: existing }
  }

  const yesterday = addDays(today, -1)
  const [previous] = await db.select().from(schema.cendCheckins)
    .where(and(eq(schema.cendCheckins.userId, userId), eq(schema.cendCheckins.checkinDate, yesterday)))
    .limit(1)
  const streak = (previous?.streak ?? 0) + 1
  const bonus = streak % 7 === 0 ? CEND_CHECKIN_STREAK_REWARD : 0
  const reward = CEND_CHECKIN_REWARD + bonus

  const [checkin] = await db.insert(schema.cendCheckins).values({
    userId,
    checkinDate: today,
    streak,
    reward
  }).onConflictDoNothing().returning()

  if (!checkin) {
    const [existingCheckin] = await db.select().from(schema.cendCheckins)
      .where(and(eq(schema.cendCheckins.userId, userId), eq(schema.cendCheckins.checkinDate, today)))
      .limit(1)
    const [account] = await db.select({ balance: schema.cendPointAccounts.balance })
      .from(schema.cendPointAccounts).where(eq(schema.cendPointAccounts.userId, userId)).limit(1)
    return { already: true, streak: existingCheckin?.streak ?? streak, reward: 0, balance: account?.balance ?? 0, checkin: existingCheckin ?? null }
  }

  const base = await grantPointsTx(db, {
    userId,
    amount: CEND_CHECKIN_REWARD,
    type: 'checkin',
    status: 'settled',
    idempotencyKey: `checkin:${today}`,
    referenceType: 'cend_checkin',
    referenceId: checkin?.id ?? today
  })
  if (bonus > 0) {
    await grantPointsTx(db, {
      userId,
      amount: bonus,
      type: 'checkin_streak',
      status: 'settled',
      idempotencyKey: `checkin-streak:${today}`,
      referenceType: 'cend_checkin',
      referenceId: checkin?.id ?? today
    })
  }
  return {
    already: false,
    streak,
    reward,
    balance: base.ok ? base.balance : 0,
    checkin: checkin ?? null
  }
}

export async function checkIn(db: DbClient, userId: string) {
  return db.transaction(tx => checkInTx(tx, userId))
}

/** 记录当天成功问答；连续 7 天时自动发 use_7_days 奖励。 */
export async function recordActivityTx(db: DbClient, userId: string): Promise<{ awarded: boolean, reward: number }> {
  const today = shanghaiDateKey(new Date())
  const inserted = await db.insert(schema.cendActivityDays).values({ userId, activityDate: today })
    .onConflictDoNothing().returning({ id: schema.cendActivityDays.id })
  if (!inserted.length) return { awarded: false, reward: 0 }
  const dates = Array.from({ length: 7 }, (_, index) => addDays(today, -index))
  const rows = await db.select({ activityDate: schema.cendActivityDays.activityDate })
    .from(schema.cendActivityDays)
    .where(and(eq(schema.cendActivityDays.userId, userId), inArray(schema.cendActivityDays.activityDate, dates)))
  if (rows.length < 7) return { awarded: false, reward: 0 }
  return grantTaskRewardTx(db, userId, 'use_7_days')
}

export async function recordActivity(db: DbClient, userId: string) {
  return db.transaction(tx => recordActivityTx(tx, userId))
}

/** 账户余额；不存在时返回 0。 */
export async function getPointBalance(db: DbClient, userId: string): Promise<number> {
  const [row] = await db.select({ balance: schema.cendPointAccounts.balance })
    .from(schema.cendPointAccounts).where(eq(schema.cendPointAccounts.userId, userId)).limit(1)
  return row?.balance ?? 0
}

/** 积分流水（分页）。 */
export async function listPointTransactions(
  db: DbClient,
  userId: string,
  input: { limit: number, offset: number }
): Promise<CendPointTransaction[]> {
  return db.select().from(schema.cendPointTransactions)
    .where(eq(schema.cendPointTransactions.userId, userId))
    .orderBy(desc(schema.cendPointTransactions.createdAt))
    .limit(input.limit)
    .offset(input.offset)
}

export interface CendTaskStatus {
  key: string
  title: string
  reward: number
  completed: boolean
  progress?: number
  target?: number
}

/** 任务中心列表：一次性任务完成状态 + 连续使用 7 天进度。 */
export async function listCendTaskStatuses(db: DbClient, userId: string): Promise<CendTaskStatus[]> {
  const completions = await db.select({ taskKey: schema.cendTaskCompletions.taskKey })
    .from(schema.cendTaskCompletions)
    .where(eq(schema.cendTaskCompletions.userId, userId))
  const completed = new Set(completions.map(row => row.taskKey))

  const today = shanghaiDateKey(new Date())
  const dates = Array.from({ length: 7 }, (_, index) => addDays(today, -index))
  const activityRows = await db.select({ activityDate: schema.cendActivityDays.activityDate })
    .from(schema.cendActivityDays)
    .where(and(eq(schema.cendActivityDays.userId, userId), inArray(schema.cendActivityDays.activityDate, dates)))

  return [
    { key: 'first_question', title: '首次完成问答', reward: CEND_TASK_REWARDS.first_question, completed: completed.has('first_question') },
    { key: 'complete_profile', title: '首次完善资料', reward: CEND_TASK_REWARDS.complete_profile, completed: completed.has('complete_profile') },
    { key: 'submit_feedback', title: '提交产品反馈', reward: CEND_TASK_REWARDS.submit_feedback, completed: completed.has('submit_feedback') },
    {
      key: 'use_7_days',
      title: '连续使用 7 天',
      reward: CEND_TASK_REWARDS.use_7_days,
      completed: completed.has('use_7_days'),
      progress: Math.min(activityRows.length, 7),
      target: 7
    }
  ]
}

/** 近 N 天签到状态（用于签到日历）。 */
export async function recentCheckins(db: DbClient, userId: string, days = 7): Promise<CendCheckin[]> {
  const today = shanghaiDateKey(new Date())
  const dates = Array.from({ length: days }, (_, index) => addDays(today, -index))
  return db.select().from(schema.cendCheckins)
    .where(and(eq(schema.cendCheckins.userId, userId), inArray(schema.cendCheckins.checkinDate, dates)))
    .orderBy(desc(schema.cendCheckins.checkinDate))
}

/** 兼容：判断某天是否已有活动记录（测试/内部使用）。 */
export async function hasActivityOn(db: DbClient, userId: string, activityDate: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.cendActivityDays.id })
    .from(schema.cendActivityDays)
    .where(and(eq(schema.cendActivityDays.userId, userId), eq(schema.cendActivityDays.activityDate, activityDate)))
    .limit(1)
  return Boolean(row)
}

/** 会员是否覆盖某时刻（用于后台展示/测试）。 */
export async function membershipCovers(db: DbClient, userId: string, at: Date): Promise<boolean> {
  const [row] = await db.select({ id: schema.cendMemberships.id }).from(schema.cendMemberships).where(and(
    eq(schema.cendMemberships.userId, userId),
    eq(schema.cendMemberships.status, 'active'),
    lte(schema.cendMemberships.startAt, at),
    gte(schema.cendMemberships.endAt, at)
  )).limit(1)
  return Boolean(row)
}
