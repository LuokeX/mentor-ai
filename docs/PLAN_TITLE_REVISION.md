# 方案标题与两行元信息调整说明

> 2026-08-18 · 涉及代码、历史数据回填与 dev 验收。测试/正式环境 app 未部署。

## 1. 标题生成规则（按方案来源分支）

标题在方案生成时固化为快照（`plans.title` / `plans.title_full`），列表与详情只投影快照。

| 方案来源 | 标题格式 |
|---|---|
| 直接测评（`direct_assessment`） | 归因分析中最重要的前 3 条描述（按中文标点断句取前 3 句）；描述缺失回退归因关键词连接；均无则兜底 `模块名 ｜ 方案` |
| 经过 AI 提问（`assistant_dialogue`） | `对象名称 ｜ AI问题：问题摘要`；无对象时省略对象段；无提问时兜底 `模块名 ｜ 方案` |

- 实现：`server/domain/plan-titles.ts` 的 `buildPlanTitle` / `buildAttributionKeywords`（纯函数）。
- 问题摘要来源：`plans.source_question_summary` 快照；为空时回填脚本可从会话首条用户消息重建（脱敏 + 截断 80 字）。

## 2. 标题下固定两行（列表与详情同一结构）

- 第一行：`归因关键词：<按序去重前 5 个归因名>`（快照列 `plans.attribution_keywords`）
- 第二行：`测评量表：<按测评顺序完整列出量表名称>`（快照列 `plans.instrument_snapshots`，`name` 为空回退 `code`）
- 空数据时不渲染对应行。
- 页面：`app/pages/plans/index.vue`（标题列下）、`app/pages/plans/[id].vue`（头部标题下）。

### 列表页展示规格

- 方案标题：单行显示，超出一行用省略号截断；鼠标悬停弹出文本控件显示完整内容（`title_full`）。
- 归因关键词：按序以"、"连接，单行超出省略；悬停显示完整关键词。
- 测评量表：按测评顺序完整展示名称（允许换行，不省略）。

## 3. 历史数据回填

脚本：`scripts/backfill-plan-titles.ts`（`pnpm backfill:plan-titles [--dry-run]`）。

- 只重算 `title` / `title_full` / `attribution_keywords`；`instrument_snapshots` 保持历史回填数据。
- 归因输入：`plans.report.planStructure.attribution.items`（生成时合并快照，按 share 降序），过滤 `strength = reference`；描述经 `plan_assessment_attempts` JOIN `assessment_attempts.result.attributions` 按 code 匹配，取不到用归因名兜底（与 `submit.post.ts` 生成逻辑一致）。
- AI 来源问题摘要：快照列为空时从 `chat_messages` 首条 user 消息重建（`decryptSensitive` + `redactPii` + 截断 80）。
- 对象名：`guardians` / `students` 的 `name_enc` AES 解密，`guardianName || studentName`。
- 安全：脚本启动校验目标库必须为 `port=5435, database=mentor_ai`（测试库），否则退出；正式库（5433）与本地库（5434）不可写。

### 本次执行记录（2026-08-18）

1. 备份正式库（只读导出）：`backups/mentor-ai-20260818-113939.sql.gz`
2. 刷新测试库为正式数据副本：`./scripts/refresh-test-db.sh backups/mentor-ai-20260818-113939.sql.gz`
3. dry-run 报告：总 23 条（direct_assessment 18 / assistant_dialogue 5），需变更 23，失败 0
4. 正式回填：已更新 23 条方案；事后抽查确认两种来源标题格式正确

### 新旧数据差异

- 存量 AI 方案标题：旧通用格式（`模块 ｜ 状态 ｜ 归因 ｜ N 个工具 ｜ 方案`）→ 新 `AI问题：<首条提问>`；存量方案均未关联学生/家长对象，故无对象名前缀。
- 存量直接测评方案标题：旧通用格式 → 归因描述前 3 句。
- 仅本次刷新后的测试库数据被修改；正式库保持原样（仅生成备份文件）。

## 4. 聊天会话标题（首页侧栏"最近对话"）

- 规则（`server/domain/chat-titles.ts` 的 `buildChatTitle`）：标题取自用户消息序列——每条消息脱敏（`redactPii`）后按中文标点取句，优先取首条消息前几句直至达到 10 字（"寒暄 + 主题"同消息场景自动补足主题），首条消息仍不足时拼接下一条消息首句；统一截断 40 字并追加省略号。
- 时机：创建会话（首条消息）时写入；澄清总结完成时用全部用户消息重算一次。
- 不使用 AI 总结文本做标题（总结开头常为共情/追问复述，不稳定）。
- 存量回填：`pnpm backfill:chat-titles [--dry-run]`（`scripts/backfill-chat-titles.ts`，目标库校验 5435/mentor_ai）。
- 本次执行记录（2026-08-18）：dry-run 15 条全部需变更 → 正式回填 15 条成功；幂等重跑确认无需变更。

## 5. 相关文件

- `server/domain/plan-titles.ts`（标题/关键词纯函数，新增 `AI问题：` 前缀）
- `tests/plan-titles.test.ts`（AI 来源标题断言更新）
- `scripts/backfill-plan-titles.ts`（新增回填脚本）
- `app/pages/plans/index.vue`、`app/pages/plans/[id].vue`（两行元信息结构）
- `server/domain/chat-titles.ts`（新增会话标题纯函数）、`tests/chat-titles.test.ts`
- `server/api/v1/chat/messages.post.ts`（创建会话与澄清总结完成时生成标题）
- `scripts/backfill-chat-titles.ts`（新增会话标题回填脚本）
- `package.json`（新增 `backfill:plan-titles`、`backfill:chat-titles` 脚本）