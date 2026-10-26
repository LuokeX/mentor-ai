import { z } from 'zod'
import { getPointBalance, listPointTransactions } from '../../../domain/cend-points'
import { requireCendContext } from '../../../domain/cend-school'
import { requireUser } from '../../../utils/auth'
import { useDb } from '../../../utils/db'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(20)
})

/** C 端积分余额与流水（分页）。 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  await requireCendContext(event, user)
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)
  const [balance, transactions] = await Promise.all([
    getPointBalance(db, user.id),
    listPointTransactions(db, user.id, {
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize
    })
  ])
  return {
    balance,
    page: query.page,
    pageSize: query.pageSize,
    transactions: transactions.map(item => ({
      id: item.id,
      amount: item.amount,
      balanceAfter: item.balanceAfter,
      type: item.type,
      status: item.status,
      note: item.note,
      referenceType: item.referenceType,
      referenceId: item.referenceId,
      createdAt: item.createdAt
    }))
  }
})
