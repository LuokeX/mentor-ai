# 统一管理框架 (Management Framework)

## 概述

教师赋能平台统一管理框架提供标准化的实体管理方案，覆盖列表、详情、创建、修改、归档、恢复、权限、审计、并发控制和测试模板。

## 核心原则

- 实体管理统一采用 Excel 风格的数据表格
- 列表负责检索、排序、分页和发起操作；字段编辑统一通过侧边抽屉显式提交
- 敏感字段、关联字段和复杂业务不得在表格中直接暴露或隐式保存
- 业务数据不物理删除，使用归档和停用
- 前端按钮权限由服务端能力语义驱动

## 共享契约 (`shared/management.ts`)

### 能力类型 (Capability)

```typescript
type Capability =
  | 'view'           // 查看基础信息
  | 'view_sensitive' // 查看敏感详情（需授权）
  | 'create'         // 创建
  | 'edit'           // 修改基础字段
  | 'inline_edit'    // 行内编辑
  | 'archive'        // 归档
  | 'restore'        // 恢复
  | 'transfer'       // 负责人移交
  | 'graduate'       // 班级毕业
  | 'delete'         // 仅限从未激活的邀请账号
  | 'disable'        // 停用账号
```

### 列表查询与响应

```typescript
interface ManagedListQuery {
  page: number        // 1-based
  pageSize: 20 | 50 | 100
  q?: string          // 搜索关键词
  status?: string
  sort: string
  order: 'asc' | 'desc'
}

interface ManagedListResult<T> {
  rows: Array<T & { _capabilities: Capability[] }>
  page: number
  pageSize: number
  total: number
  capabilities: Capability[]  // 页面级能力
}
```

### 并发控制

```typescript
interface ManagedPatch<T> {
  patch: T
  expectedUpdatedAt: string  // ISO 8601
}
```

记录被其他用户修改时返回 `409 EDIT_CONFLICT`。写接口必须在最终
`UPDATE` 条件中再次包含租户、归属、状态和 `expectedUpdatedAt`，不能只依赖前置查询。

## 接口约定

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/resource` | 分页列表 |
| POST | `/resource` | 创建 |
| GET | `/resource/:id` | 详情 |
| PATCH | `/resource/:id` | 修改字段 |
| POST | `/resource/:id/archive` | 归档 |
| POST | `/resource/:id/restore` | 恢复 |
| POST/PATCH | `/resource/:id/transfer` | 移交（以相邻领域路由约定为准） |
| POST | `/classes/:id/graduate` | 班级毕业 |
| POST | `/users/:id/transfer-and-disable` | 业务移交并停用账号 |
| DELETE | `/users/:id` | 仅允许删除未激活的邀请账号 |

## 服务端

### 能力解析 (`server/domain/capabilities.ts`)

按以下顺序解析用户对记录的操作能力：

`角色 → 学校 → 负责人/分配关系 → 记录状态 → 临时授权 → 具体动作`

- `resolveCapabilities(ctx)`: 解析单条记录的全部能力
- `resolvePageCapabilities(user, area)`: 解析页面级能力

### 生命周期服务 (`server/domain/lifecycle.ts`)

- `archiveRecord()`: 通用归档操作（含租户、归属和并发控制）
- `restoreRecord()`: 通用恢复操作
- `validateLifecycleAction()`: 校验状态流转合法性

默认状态流转：

```
active   → archive, transfer, graduate
archived → restore
```

### 分页工具 (`server/utils/pagination.ts`)

- `paginateResult()`: 并行执行查询和计数，返回标准分页结构

## 前端

### 组件 (`app/components/management/`)

| 组件 | 说明 |
|------|------|
| `ManagementPage.vue` | 页面容器：标题、说明、创建按钮 |
| `ManagedDataTable.vue` | 基于 UTable 的数据表格 |
| `TableToolbar.vue` | 搜索栏、筛选、刷新 |
| `TablePagination.vue` | 服务端分页 |
| `RowActions.vue` | 行级操作按钮（基于能力） |
| `BulkActionBar.vue` | 批量操作栏 |
| `EntityFormDrawer.vue` | 创建/编辑抽屉 |
| `EntityDetailDrawer.vue` | 详情抽屉 |
| `LifecycleDialog.vue` | 归档/恢复/移交确认 |

### Composable (`app/composables/`)

| Composable | 说明 |
|------|------|
| `useManagedList.ts` | URL 查询状态同步、请求、防抖、分页 |
| `useRowEditor.ts` | 为确需行草稿的非敏感场景提供保存、取消和冲突处理；当前核心页面使用抽屉 |
| `useCapabilities.ts` | 解释服务端返回的能力数组 |

## 数据生命周期

### 生命周期字段

- `status`: `active | archived | graduated | disabled`
- `archivedAt`: 归档时间
- `archivedBy`: 归档操作人
- `disabledAt`: 停用时间（仅 users 表）
- `disabledBy`: 停用操作人（仅 users 表）
- `disabledReason`: 停用事由（仅 users 表）

### 禁止物理删除的表

- 所有业务档案（classes, students, guardians, communications, plans, assessments, moduleCases, studentEvents）
- 审计日志 (auditLogs)
- 安全事件 (safetyEvents)
- 管理员访问事件 (adminAccessEvents)
- 方案事件 (planOperationEvents)
- 转介事件 (referralEvents)

## 新增管理模块

### 脚手架命令

```bash
pnpm scaffold:management --area <area> --entity <entity>
```

生成：
- `server/api/v1/<area>/<entity>/index.get.ts` - 列表 API 骨架
- `app/pages/<area>/<entity>/index.vue` - 列表页面骨架

### 开发清单

1. 确定实体对应的数据库表
2. 运行脚手架生成骨架文件
3. 修改 API 替换 TODO 占位（查询表、字段、排序白名单）
4. 修改页面前端调整列定义和显示
5. 如有新增表，运行 `pnpm db:generate` 生成迁移
6. 运行 `pnpm typecheck` 检查类型
7. 创建 API：create (POST), update (PATCH), archive (POST), restore (POST), detail (GET /:id)
8. 创建对应测试：权限、CRUD、并发、生命周期
9. 路由守卫更新（如需新的角色限制）

## 验收标准

- 所有实体管理列表统一使用 `ManagedDataTable`
- 所有列表使用服务端分页，单页最多 100 条
- 所有写操作都有服务端权限、归属条件和审计
- 所有业务历史使用归档/关闭/移交，不物理删除
- 前端按钮和服务端权限由同一能力语义驱动
- 新管理代码不新增 `any`
- 账号创建和批量导入只生成 72 小时激活邀请，不生成或展示临时密码
- 学校管理员敏感档案访问授权固定为 15 分钟；平台代管授权最长 30 分钟
- 权限验收至少覆盖四角色、跨学校、跨负责人、过期授权、状态冲突和审计原子性

## 当前落地范围

- 教师信息中心：班级、学生、家长、家校沟通、学生事件、个案
- 学校后台：班级、学生、家长、部门、账号、导入、转介、授权审批、操作与审计
- 平台后台：学校、代管申请、平台审计
- 心理专员：转介工单列表与既有处置工作台

列表统一返回 `ManagedListResult`，但不同实体的可写动作仍由各领域 API
独立实现和校验。统一组件不是绕过业务边界的通用低代码 CRUD 引擎。
