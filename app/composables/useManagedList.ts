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

export function useManagedList<T>(baseUrl: string, options?: { extraQuery?: () => Record<string, string | undefined> }) {
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

  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  function syncUrl() {
    const query: Record<string, string | undefined> = {
      ...Object.fromEntries(Object.entries(route.query).map(([key, value]) => [
        key,
        Array.isArray(value) ? value[0] : value,
      ])),
      page: String(page.value),
      pageSize: String(pageSize.value),
      sort: sort.value,
      order: order.value,
    }
    query.q = q.value || undefined
    query.status = statusFilter.value !== 'all' ? statusFilter.value : undefined
    void router.replace({ query })
  }

  const requestQuery = computed(() => {
    const query: Record<string, string> = {
        page: String(page.value),
        pageSize: String(pageSize.value),
        sort: sort.value,
        order: order.value,
    }
    if (q.value) query.q = q.value
    if (statusFilter.value !== 'all') query.status = statusFilter.value
    if (options?.extraQuery) {
      const extra = options.extraQuery() || {}
      for (const [key, value] of Object.entries(extra)) if (value) query[key] = value
    }
    return query
  })

  const { data, pending, error: requestError, refresh: refreshRequest } = useFetch<ManagedListResult<T>>(baseUrl, {
    query: requestQuery,
    watch: false,
    default: () => ({
      rows: [],
      page: page.value,
      pageSize: pageSize.value,
      total: 0,
      capabilities: [],
    }),
  })

  const rows = computed(() => data.value?.rows || [])
  const total = computed(() => data.value?.total || 0)
  const pageCapabilities = computed<Capability[]>(() => data.value?.capabilities || [])
  const error = computed(() => {
    const value = requestError.value
    return value
      ? (value.data as { message?: string } | undefined)?.message || value.message || '加载失败，请重试'
      : null
  })

  function fetchList() {
    return refreshRequest()
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
    return fetchList()
  }

  return {
    rows,
    total,
    page: readonly(page),
    pageSize: readonly(pageSize),
    q: readonly(q),
    statusFilter: readonly(statusFilter),
    sort: readonly(sort),
    order: readonly(order),
    pageCapabilities: readonly(pageCapabilities),
    loading: readonly(pending),
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
