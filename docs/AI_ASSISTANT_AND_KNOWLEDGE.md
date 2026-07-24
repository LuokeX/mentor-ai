# AI 分诊与三库资源说明

## 1. 定位

首页 AI 只做分诊：澄清教师问题、推荐进入哪个模块、说明推荐理由、提示评估前准备事项。

AI 不直接生成正式方案，不跳过量表，不替代规则归因，不自由决定等级、工具或风险判断。老师确认模块后，进入五模块之一，再按固定流程执行：

```text
量表评估 → 规则归因 → 工具匹配 → 方案生成 → 跟踪复盘
```

当前模块以代码中的 `moduleIdSchema` 为准：`self_growth`、`class_system`、`home_school`、`student_case`、`learning_problem`。

## 2. 安全链路

```text
教师输入
  → 本地危机关键词和硬规则
  → DeepSeek 语义风险辅助（配置模型时）
  → PII 脱敏
  → AI 分诊推荐模块
  → 教师确认模块
  → 模块内确定性量表评估
  → 归因库规则执行
  → 工具库匹配
  → 固定结构方案草稿
  → 行动项和复盘跟踪
```

任一红线命中后立即停止常规分诊，先创建风险事件、心理专员工单、通知 Outbox 和审计记录。

## 3. DeepSeek 配置

```env
DEEPSEEK_API_KEY=实际密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_ROUTER_MODEL=deepseek-v4-flash
DEEPSEEK_GENERATOR_MODEL=deepseek-v4-pro
DEEPSEEK_TIMEOUT_MS=8000
```

DeepSeek 用于语义风险辅助、分诊路由和必要表达润色。没有密钥、超时或响应校验失败时，系统自动使用本地分诊与安全降级。

Embedding 只服务模块资源文档分块，不再服务旧知识库：

```env
EMBEDDING_ENABLED=true
OLLAMA_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=qwen3-embedding:0.6b
EMBEDDING_TIMEOUT_MS=8000
```

如需重建模块资源向量，使用 `pnpm resources:reindex`。

## 4. 三库资源中心

平台后台“模块资源中心”按 `module + libraryType + scope` 管理资源库。`libraryType` 固定为：

| 类型 | 回答的问题 | 运行职责 |
| --- | --- | --- |
| `assessment` | 评估什么、怎么采集 | 提供量表和题项 |
| `attribution` | 为什么是这个问题、属于什么等级 | 提供确定性归因规则 |
| `tool` | 用什么方法处理 | 提供工具、步骤、禁忌和复盘周期 |

教师运行时优先读取本校 `published` 版本；同一模块与库类型没有校本版本时，再回退平台 `global published` 版本。`draft` 和 `retired` 不进入教师端主流程。

## 5. 资源放置

```text
业务需求/                         原始业务资料
docs/business/library-standards/   业务整理规范
business-libraries/[module]/       标准 JSON 数据
module_resource_libraries          运行时资源库
module_resource_versions           运行时发布版本
```

标准 JSON 由业务侧按规范整理后导入。导入命令：

```bash
pnpm import:business-data --dry-run
pnpm import:business-data --publish
pnpm import:business-data --module=home_school --publish
pnpm import:business-data --type=attribution --publish
```

## 6. 方案与复盘

方案不是独立方案库。系统根据量表结果、归因输出、工具匹配和固定结构规则生成方案草稿，结构包括：

- 问题摘要
- 评估结论
- 主归因/次归因
- 支持目标
- 行动项
- 推荐工具
- 注意事项/禁忌
- 下次复盘时间

跟踪粒度为行动项 + 工具。老师可更新行动状态，并在周期复盘中填写效果评分、进展说明和下一步动作。AI 可做复盘追问辅助，但不得自动改写等级、归因、工具、禁忌和风险判断。
