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
DEEPSEEK_TIMEOUT_MS=30000
```

DeepSeek 用于语义风险辅助、分诊路由和必要表达润色。没有密钥、超时或响应校验失败时，系统自动使用本地分诊与安全降级。

超时说明：`DEEPSEEK_TIMEOUT_MS` 是全局默认（建议 30000）。评估报告润色是最长输出（完整报告 JSON），走专用逻辑：AI 运行时配置显式设置优先，否则不低于 60000ms，不受全局短超时影响。

Embedding 只服务模块资源文档分块，不再服务旧知识库：

```env
EMBEDDING_ENABLED=true
OLLAMA_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=qwen3-embedding:0.6b
EMBEDDING_TIMEOUT_MS=8000
```

如需重建模块资源向量，使用 `pnpm resources:reindex`。

## 4. 三库运营台

平台后台“三库运营台”按 `module + libraryType + scope` 管理模块资源库。`libraryType` 固定为：

| 类型 | 回答的问题 | 运行职责 |
| --- | --- | --- |
| `assessment` | 评估什么、怎么采集 | 提供量表和题项 |
| `attribution` | 为什么是这个问题、属于什么等级 | 提供确定性归因规则 |
| `tool` | 用什么方法处理 | 提供工具、步骤、禁忌和复盘周期 |

教师运行时优先读取本校 `published` 版本；同一模块与库类型没有校本版本时，再回退平台 `global published` 版本。`draft` 和 `retired` 不进入教师端主流程。

## 5. 资源放置

```text
临时文件/2026_07_27_家校沟通与合作-工具库、评估库、专业知识库0722/   原始业务资料（git 忽略）
docs/business/library-standards/                                    业务整理规范
business-libraries/[module]/                                       标准 JSON 数据
module_resource_libraries                                          运行时资源库
module_resource_versions                                           运行时发布版本
```

标准 JSON 由业务侧按规范整理后导入。导入命令：

```bash
pnpm import:business-data --dry-run
pnpm import:business-data --publish
pnpm import:business-data --module=home_school --publish
pnpm import:business-data --type=attribution --publish
pnpm import:business-data --dry-run --strict-quality
pnpm import:business-data --dry-run --require-complete
```

导入流程默认只读取 `business-libraries/[module]/assessment|attribution|tool.(xlsx|json)` 中按模板整理后的标准资源。旧原始业务资料（`临时文件/` 下的源 Excel，git 忽略）不再作为默认发布来源；确需历史排查时才使用 `--include-legacy-raw`。

导入流程会在写库前输出质量报告。错误会阻断导入；警告默认允许导入，但会显示评分、投影统计和前 5 条问题。发布前需要零错误；试点验收或正式发版前建议使用 `--strict-quality`，把警告也作为阻断项处理，并用 `--require-complete` 确认 5 个模块 × 3 类资源齐全。

质量报告重点看：

- 量表：量表数、平均题量、维度覆盖率。
- 归因：规则数、兜底规则数、阻断规则数、带工具标签规则比例。
- 工具：工具数、匹配提示覆盖率、话术覆盖率、禁忌覆盖率、预期效果覆盖率。

学校后台“试点指标”页签提供验收面板。汇报时建议按四层说明：

- 使用启动：账号激活率、10 分钟首任务率、周活跃教师。
- 业务闭环：方案执行率、复盘率、方案质量反馈数。
- 专业质量：归因准确性、工具可用性、方案工作单完整率、三库发布和投影就绪率。
- 安全治理：AI 失败率、来源不足/降级次数、危机转介 SLA。

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
