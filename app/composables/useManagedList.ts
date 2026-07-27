/**
 * 统一管理列表 composable
 *
 * 职责：
 * - URL 查询状态同步（搜索、筛选、排序、分页）
 * - 服务端请求和防抖
 * - 刷新、状态管理
 */
import type { ManagedListQuery, ManagedListResult, Capability } from '~~/shared/management'
import { SEARCH_DEBOUNCE_MS, DEFAULT_PAGE_SIZE } from '~~/shared/management'

export function useManagedList<T>(baseUrl: string) {
  const route = useRoute()
  const router = useRouter()

  // 从 URL 读取初始状态
  const page = ref(Number(route.query.page) || 1)
  const pageSize = ref<20 | 50 | 100>(
    ([20, 50, 100].includes(Number(route.query.pageSize)) ? Number(route.query.pageSize) : DEFAULT_PAGE_SIZE) as 20 | 50 | 100,
  )
  const q = ref((route.query.q as string) || '')
  const statusFilter = ref((route.query.status as string) || 'all')
  const sort = ref((route.query.sort as string) || 'updatedAt')
  const order = ref<'asc' | 'desc'>((route.query.order as 'asc' | 'desc') || 'desc')

  const rows = ref<Array<T & { _capabilities: Capability[] }>>([])
  const total = ref(0)
  const pageCapabilities = ref<Capability[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  function syncUrl() {
    const query: Record<string, string> = {
      page: String(page.value),
      pageSize: String(pageSize.value),
      sort: sort.value,
      order: order.value,
    }
    if (q.value) query.q = q.value
    if (statusFilter.value !== 'all') query.status = statusFilter.value
    router.replace({ query })
  }

  async function fetchList() {
    loading.value = true
    error.value = null
    try {
      const params = new URLSearchParams({
        page: String(page.value),
        pageSize: String(pageSize.value),
        sort: sort.value,
        order: order.value,
      })
      if (q.value) params.set('q', q.value)
      if (statusFilter.value !== 'all') params.set('status', statusFilter.value)

      const result = await $fetch<ManagedListResult<T>>(`${baseUrl}?${params}`)
      rows.value = result.rows
      total.value = result.total
      pageCapabilities.value = result.capabilities
    } catch (e: any) {
      error.value = e?.data?.message || '加载失败，请重试'
    } finally {
      loading.value = false
    }
  }

  function onSearch(val: string) {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      q.value = val
      page.value = 1
      syncUrl()
      fetchList()
    }, SEARCH_DEBOUNCE_MS)
  }

  function onStatusChange(status: string) {
    statusFilter.value = status
    page.value = 1
    syncUrl()
    fetchList()
  }

  function onSortChange(field: string) {
    if (sort.value === field) {
      order.value = order.value === 'asc' ? 'desc' : 'asc'
    } else {
      sort.value = field
      order.value = 'asc'
    }
    page.value = 1
    syncUrl()
    fetchList()
  }

  function onPageChange(newPage: number) {
    page.value = newPage
    syncUrl()
    fetchList()
  }

  function onPageSizeChange(newSize: 20 | 50 | 100) {
    pageSize.value = newSize
    page.value = 1
    syncUrl()
    fetchList()
  }

  function refresh() {
    fetchList()
  }

  // 挂载时自动请求，URL 参数作为初始条件
  onMounted(() => {
    fetchList()
  })

  return {
    rows,
    total,
    page: readonly(page),
    pageSize: readonly(pageSize),
    q: readonly(q),
    statusFilter: readonly(statusFilter),
    sort: readonly(sort),
    order: readonly(order),
    pageCapabilities,
    loading: readonly(loading),
    error: readonly(error),
    onSearch,
    onStatusChange,
    onSortChange,
    onPageChange,
    onPageSizeChange,
    refresh,
    fetchList,
  }
}