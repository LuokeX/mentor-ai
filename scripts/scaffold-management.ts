#!/usr/bin/env tsx
/**
 * 管理模块脚手架生成命令
 *
 * 用法: pnpm scaffold:management --area <area> --entity <entity>
 *
 * 生成内容：
 *   - server/api/v1/<area>/<entity>/index.get.ts    列表 API
 *   - server/api/v1/<area>/<entity>/index.post.ts    创建 API（骨架）
 *   - server/api/v1/<area>/<entity>/[id].patch.ts    修改 API（骨架）
 *   - app/pages/<area>/<entity>/index.vue            列表页面
 *
 * 特性：
 *   - 拒绝覆盖已有文件
 *   - 不自动生成数据库迁移
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname!, '..')

const args = process.argv.slice(2)
const areaIdx = args.indexOf('--area')
const entityIdx = args.indexOf('--entity')

if (areaIdx === -1 || entityIdx === -1) {
  console.error('用法: pnpm scaffold:management --area <area> --entity <entity>')
  console.error('示例: pnpm scaffold:management --area information --entity announcements')
  process.exit(1)
}

const area = args[areaIdx + 1]
const entity = args[entityIdx + 1]
if (!area || !entity) {
  console.error('错误: --area 和 --entity 参数不能为空')
  process.exit(1)
}

// Convert entity to title case
const entityTitle = entity.charAt(0).toUpperCase() + entity.slice(1).replace(/-/g, ' ')
const entitySlugSnake = entity.replace(/-/g, '_')

async function exists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true } catch { return false }
}

async function safeWrite(path: string, content: string, label: string) {
  if (await exists(path)) {
    console.log(`  [跳过] ${label} 已存在: ${path}`)
    return
  }
  await writeFile(path, content, 'utf-8')
  console.log(`  [创建] ${label}: ${path}`)
}

// ===== API 模板 =====
const listApi = `/**
 * ${entityTitle} 列表 API (管理框架)
 */
import { and, asc, desc, eq, ilike, or } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '${'../'.repeat(area.split('/').length + 3)}../../../shared/management'
import type { ManagedListResult, Capability } from '${'../'.repeat(area.split('/').length + 3)}../../../shared/management'
import { requireUser } from '${'../'.repeat(area.split('/').length + 3)}../../utils/auth'
import { useDb, schema } from '${'../'.repeat(area.split('/').length + 3)}../../utils/db'
import { countSql, offsetFrom } from '${'../'.repeat(area.split('/').length + 3)}../../domain/school-management'
import { resolveCapabilities } from '${'../'.repeat(area.split('/').length + 3)}../../domain/capabilities'
import { paginateResult } from '${'../'.repeat(area.split('/').length + 3)}../../utils/pagination'

const SORT_WHITELIST = createSortWhitelist('updatedAt', 'createdAt')

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((v) => [20, 50, 100].includes(v)).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'archived', 'all']).default('all'),
  sort: z.string().trim().max(40).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher', 'school_admin'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '未关联学校' })
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  // TODO: 根据实际表结构修改查询
  const conditions: any[] = []
  if (query.status !== 'all') conditions.push(eq(schema.schools.status as any, query.status))

  const validSort = validateSort(query.sort, SORT_WHITELIST, 'updatedAt')
  const orderFn = query.order === 'asc' ? asc : desc

  // TODO: 替换为实际表和数据列
  const result = await paginateResult({
    dataQuery: db.select({ id: schema.schools.id, name: schema.schools.name, createdAt: schema.schools.createdAt, updatedAt: schema.schools.updatedAt }).from(schema.schools).where(and(...conditions)).orderBy(orderFn(schema.schools.updatedAt)).limit(query.pageSize).offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.schools).where(and(...conditions)),
    page: query.page, pageSize: query.pageSize,
  })

  const rows = await Promise.all(result.rows.map(async (row) => {
    const caps: Capability[] = await resolveCapabilities({ user, recordSchoolId: user.schoolId, recordOwnerUserId: user.id, recordStatus: 'active', targetType: '${entitySnakeSlug}', targetId: row.id })
    return { ...row, _capabilities: caps }
  }))

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: ['view', 'create'] as Capability[] } satisfies ManagedListResult<typeof result.rows[number]>
})
`

const pageTemplate = `<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'

const { rows, total, page, pageSize, q, sort, order, loading, error, pageCapabilities, onSearch, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; updatedAt: string }>('/api/v1/${area}/${entity}')

const columns = [
  { key: 'id', label: 'ID' },
  { key: 'updatedAt', label: '更新时间' },
  { key: 'actions', label: '操作' },
]
</script>

<template>
  <ManagementPage
    title="${entityTitle}"
    description="${entityTitle}管理页面"
    :can-create="pageCapabilities.includes('create')"
    create-label="创建${entityTitle}"
  >
    <TableToolbar :search-value="q" search-placeholder="搜索..." :loading="loading" @search="onSearch" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #id-data="{ row }">
        <span class="text-xs text-gray-500 font-mono">{{ row.id.slice(0, 8) }}</span>
      </template>
      <template #actions-data="{ row }">
        <RowActions :capabilities="row._capabilities" :row-id="row.id" />
      </template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
`

// ===== 生成 =====
async function main() {
  console.log(`生成管理模块: area=${area}, entity=${entity}\n`)

  const apiDir = resolve(ROOT, 'server/api/v1', area, entity)
  await mkdir(apiDir, { recursive: true })
  await safeWrite(resolve(apiDir, 'index.get.ts'), listApi, '列表 API')

  const pageDir = resolve(ROOT, 'app/pages', area, entity)
  await mkdir(pageDir, { recursive: true })
  await safeWrite(resolve(pageDir, 'index.vue'), pageTemplate, '列表页面')

  console.log('\n完成。')
  console.log('  1. 编辑服务端 API 替换 TODO 标记的占位查询')
  console.log('  2. 编辑前端页面调整列定义和显示逻辑')
  console.log('  3. 运行 pnpm db:generate 生成数据库迁移（如需新增表）')
  console.log('  4. 运行 pnpm typecheck 检查类型')
}

main().catch(console.error)