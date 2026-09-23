# AI 助手与三库资源说明

## 1. 定位

首页 AI 是"回答先行"助手：先给出当下可执行的初步分析与建议，信息不足时在回答末尾问一个能改变判断的具体问题（哪个学生或哪类班级、最近一次发生的时间与场合、家长原话、教师已试过的做法），不用方向二选一或泛泛的感受题代替追问，必要时推荐量表或建议进入某个模块。

AI 不直接生成正式方案，不跳过量表，不替代规则归因，不自由决定等级、工具或风险判断。老师进入五模块之一后，再按固定流程执行：

```text
量表评估 → 规则归因 → 工具匹配 → 方案生成 → 跟踪复盘
```

一个模块可以编排多张量表（入口筛查 → 深度诊断 → 专项情境），多张量表的结果在评估组内聚合、全部做完后统一生成一份方案；单张量表的评估体验与直接出方案等价。机制见下文「连续量表流程」。

当前模块以代码中的 `moduleIdSchema` 为准：`self_growth`、`class_system`、`home_school`、`student_case`、`learning_problem`。

## 2. 安全链路

```text
教师输入
  → 本地危机关键词和硬规则
  → DeepSeek 语义风险辅助（配置模型时，首轮识别 + 复核两轮）
  → PII 脱敏
  → Agent 助手回答（可推荐量表或模块）
  → 模块内确定性量表评估
  → 归因库规则执行
  → 工具库匹配
  → 固定结构方案草稿
  → 行动项和复盘跟踪
```

**聊天链路的安全命中只做后台预警，不打断回答**（2026-09-17 业务确认）：

- **本地硬规则命中（明确措辞）与语义命中**（首轮识别 + 复核两轮都成立）：都在同一事务里创建风险事件、心理专员工单、通知 Outbox 和审计记录，同时记 `assistant_safety_alert_issued` 产品事件；回答照常生成，教师端不显示任何预警痕迹（没有转介卡片、没有提示文案、没有消息标记）。
- 复核调用失败（超时、HTTP、解析）时保留首轮判定——安全侧不因技术失败放行；复核清空首轮判定时记 `assistant_semantic_safety_cleared` 产品事件，不建事件与转介。
- **量表提交的熔断不受影响**：红线命中仍停止常规流程，教师端进入转介指引页（`app/components/CrisisReferralCard.vue`）。

## 3. DeepSeek 配置

```env
DEEPSEEK_API_KEY=实际密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_ROUTER_MODEL=deepseek-flash
DEEPSEEK_GENERATOR_MODEL=deepseek-flash
DEEPSEEK_TIMEOUT_MS=30000
# Agent 对话记忆（只追加前缀 + token 预算）
AI_AGENT_HISTORY_TOKEN_BUDGET=24000
AI_AGENT_MAX_OUTPUT_TOKENS=4096
AI_AGENT_COMPACTION_KEEP_RATIO=0.5
# Agent 工具治理：单轮工具轮次上限、启用的工具名清单（逗号分隔，留空 = 按上下文裁剪后全部启用）
AI_AGENT_MAX_TOOL_ROUNDS=8
AI_AGENT_ENABLED_TOOLS=
```

DeepSeek 用于语义风险辅助、Agent 助手回答和必要表达润色。Agent 在本轮无产出时自动整轮重试一次（传输层另有 SDK 自动重试），重试轮会追加一条不落库的临时提示要求模型直接产出回答；**例外**：模型以空正文结束（模型两次往返都没有输出任何文本，也没有再发起工具调用）或工具轮次预算用尽时，只要本轮已经有工具结果，就先不绑定工具补一次「依据已返回的事实作答」的收尾回答——教师已经看到工具过程，直接报错等于白跑一轮；补答仍为空才向教师返回统一的中文错误提示（审计记 `empty_round:<finish_reason>` / `empty_answer:<finish_reason>`，2026-09-17 线上首次出现该形态，上游 `finish_reason` 是区分「服务端资源不足被中断」与「正常结束的空回答」的唯一线索）。安全规则始终由本地关键词与硬规则先行执行。

模型当前默认开启思考模式（effort=high）：实测推理 token 占输出的一半到四分之三，首字延迟数秒，是回答成本的主要来源；`AI_AGENT_MAX_OUTPUT_TOKENS` 用于给输出封顶。若要降本，需先评估回答质量再显式关闭思考或降低 effort（思考模式下 `temperature` 不生效）。

## 3.1 对话记忆与缓存策略

首页助手的对话装载遵循「只追加前缀」：每轮请求的消息序列是上一轮的序列加上新增内容，因此 DeepSeek 的前缀缓存（缓存命中价约为未命中价的 1/30，见官方价目表）能持续命中。实现与约束：

- 历史装载：`server/domain/chat-history.ts` 按 `AI_AGENT_HISTORY_TOKEN_BUDGET`（默认 24000 token）保留尾部，窗口起点对齐到教师提问。**不要再引入按条数滑窗**（历史 `limit(8)` 与 `slice(-12)` 已删除）：滑窗会让每轮前缀从历史开头分叉，实测命中率会从 68% 掉到 30%，且窗口一滑动就整段失效。
- 超预算压缩：`server/domain/chat-compaction.ts` 在历史超出预算时，把「摘要游标之后、保留边界之前」的消息一次性并入摘要（保留比例 `AI_AGENT_COMPACTION_KEEP_RATIO`，默认 0.5，即保留一半预算的原文）。摘要加密存在 `chat_sessions.context_summary_enc`，游标是 `context_summary_upto_at`，原始消息一律保留不删；摘要调用本身也记 `ai_model_calls`（`purpose=chat_history_summary`）。每次压缩会让缓存前缀断裂一次，因此必须低频、大批量。
- 工具轨迹回放：`server/agent/tool-trace.ts` 把本轮模型发起的 `tool_calls` 与工具返回加密存在助手消息的 `tool_trace_enc`，下一轮挂在对应提问上原样回放，使上一轮的完整请求（含工具往返）成为本轮的前缀。只回放最近一轮；超过步数/字符上限的轨迹直接丢弃；不保存思维链（实测回放不带 `reasoning_content` 也被服务端接受）。**回放前必须修复配对**（`repairToolTrace`）：OpenAI 兼容接口要求每个 assistant 的 `tool_calls` 都有紧随其后、按 `tool_call_id` 一一对应的工具结果，否则整轮请求被服务端以 400 拒绝（`INVALID_TOOL_RESULTS`，2026-09-16 真实模型评测复现 4/420 轮）。修复会丢弃无法完整回应的调用与孤立工具结果，发生在落库前（`serializeToolTrace`）与回放前（`traceToLangChainMessages`）两处，历史数据无需迁移；模型未给出调用 id 时该轮不记录工具轨迹。
- system 前缀稳定：咨询对象只保留「类型 + 名称」指针，档案细节由 `record_snapshot` 工具按需查询；教师画像与会话摘要都放在 system 段，只在变化时（改画像、压缩）才打断前缀。
- 会话内换绑咨询对象（`server/domain/chat-context-switch.ts`）：一个会话默认绑定一个对象，教师可以在会话中途用 `@` 换对象——既有消息保留（不新建会话、不清空记录），入口把 `chat_sessions.context_type/context_id` 改到新对象，并在元数据 `contextSwitches` 里留痕（前端据此在时间线画分隔条）。换绑后 system 段持续带同一段提示，声明「历史消息属于旧对象、当前对象以工具返回为准」；提示只由元数据推导，逐轮逐字一致，因此不会打断前缀缓存。`chat_sessions.metadata` 的模块占比写回必须是 jsonb 合并（`||`），不能整块覆盖，否则会抹掉换绑记录。
- 只读工具集（`server/agent/tools/index.ts` 按上下文裁剪，共 14 个）：`knowledge_search` 三库混合检索（向量 + pg_trgm 关键词，RRF 融合；零命中时返回该模块已发布资源目录）、`module_route` 确定性分诊（返回模块与该模块的静态分析与行动框架 playbook）、`recommend_assessment` 量表推荐卡（走与模块页同一套门禁：已发布、红线量表仅在触发时可见、被前置锁住则改推前置，并返回候选量表清单）、`entity_memory` 同一对象**跨会话**的相关历史（当前教师/学校/对象内最多 20 个会话、120 条候选，按当前问题相关性和纠正信息选取最多 12 条、6000 token，携带来源与原文）（排除当前会话；未传参数时读当前会话绑定的对象，未绑定对象时返回空与提示），`record_snapshot` 当前会话绑定的咨询对象档案、`student_search` 按姓名或班级检索当前教师负责的在册学生（只返回 id/姓名/班级；姓名 AES 加密存储，只能精确匹配，不支持模糊检索）、`student_snapshot` 按 `student_search` 得到的 id 读取该学生档案、`plan_lookup` 进行中方案与行动项（含逾期标记）与最近复盘（未指定对象时按当前会话的咨询对象收口，逐条带 `object` 标签；该对象没有关联方案时只报「另有 N 条未关联对象的方案」的条数，不把别的对象的方案当作本次对象的）、`assessment_history` 已提交量表结论与未完成草稿与开放评估组（按当前咨询对象收口：返回该对象的结论与教师本人的自我成长量表结论，对象未知的历史提交不返回，逐条带 `object` 标签）、`communication_lookup` 沟通记录（按当前对象的学生/家长收口，逐条带 `object` 与 `studentLabel`/`guardianRelation`；当前对象是班级时不适用，退回教师维度）、`class_overview` 班级与学生聚合概览（沟通数/在跟方案数/最近方案等级）、`teacher_brief` 教师待办简报（逾期行动项、待复盘方案、未完成草稿、未读通知数、需关注的沟通）、`resource_lookup` 三库资源目录（只给名称与摘要，不给正文与结论）、`resource_detail` 三库明细（`libraryType=attribution` 返回归因项的原因名/常见表现/通常成因/建议动作/匹配标签，`libraryType=tool` 返回工具卡的适用症状/关键步骤/预期效果/时长；按模块 + 现象关键词或名称筛选、单次最多 6 条；只暴露这两类教师可见字段，证据规则、分级规则、红线、禁忌规则不进返回；正文字段过 `server/domain/knowledge-text-guard.ts` 的 `findBannedTerms` 防线命中即整段置空，名称含「危机/红线/预警/立即/110/120」时整条丢弃；读的是已发布版本 payload，版本切换自动跟随，不写库也不重新向量化）。全部只读、按 `schoolId + ownerUserId` 收口、按数据模式脱敏；`record_snapshot` 与 `student_snapshot` 共用 `server/agent/tools/record-context.ts` 的读取与治理路径，业务数据的读取集中在 `server/domain/assistant-readers.ts`。**写操作不进工具层**：教师业务正文的修改仍由既有 REST 路由执行（带 `expectedUpdatedAt` 并发校验、归属条件与审计）；若日后要接入，只允许「模型起草动作卡 → 教师确认 → 前端调用既有接口」的形式，不给模型直接的写工具或 SQL。
- 运行期防护（`server/agent/graph.ts`）：同轮内相同 (工具, 参数) 的重复调用直接复用上次结果；单次工具执行有超时上限（`AgentTool.timeoutMs`，默认 10 秒），超时按工具失败回传模型自愈；模块分诊结论与量表推荐模块不一致时以量表推荐为准并写 `assistant_tool_conflict` 产品事件。工具启用清单与轮次上限来自 `AI_AGENT_ENABLED_TOOLS` / `AI_AGENT_MAX_TOOL_ROUNDS`，AI 中心「运行时配置」只读展示生效值。
- 回答校验与展示：`answer-delivery.ts` 对普通回答按完整句子清理后流式展示；制度、量表或敏感判断先缓冲，普通回答中出现这些内容时从该句起缓冲。`assistant-answer-review.ts` 使用教师陈述、档案、确定性工具结果及已发布知识证据校验；代码检查数值/等级是否存在于规则结果，语义检查表述是否得到支持（不负责计分、归因或安全定级）。最多修正一次，仍失败或超时发送现有 `error`，不展示被拦截原文、不落库、不生成替代兜底。语义检查并非绝对可靠，对象/版本的支持性仍需测试与人工验收。
- 知识正文与展示摘要分开：最多 5 个片段，正文每段约 2000 字符并按段落/句子预算，摘要 300 字符；携带文档、版本、片段和截断标记。工具整体结果超预算返回有效结构错误，不截断 JSON。向量、关键词查询统一限定已发布版本、就绪文档与学校可见性。空检索允许一次改写；知识缺口只记模块/原因，人工补库。
- 知识库文档也带「适用学部」（`applicableSchoolSection`，导入时填「适用学部」列或平台后台知识库上传表单选择，缺省 all）：检索时按调用者学段过滤（`schoolSectionVisibility`），未标注的文档始终可见，教师没填任教年级时不过滤。量表与工具同理，规则集中在 `shared/school-section.ts`。是否过滤由 `SCHOOL_SECTION_FILTER_ENABLED` 决定，**默认关闭**（关闭时所有人都检索到全部内容），内容按学段细分后再开启；取值统一走 `server/utils/stage-filter.ts`。
- 知识库文档学段的维护入口：批量导入模板（`business-libraries/templates/知识库填写模板.xlsx`，已含「适用学部」列，`pnpm template:split` 同步 `public/templates/knowledge.xlsx`）；导出 XLSX 同列名带出，可导出改完再导入；「从三库导入」生成的文档从版本 payload 继承（`schoolSectionOfResourceRows`：整版同一具体学部才采用，混杂/缺失按 all）；平台后台知识库列表显示学段、文档详情可修改（`PATCH /api/v1/platform-admin/module-resources/documents/{id}`，一个事务里同步文档与全部切块的 metadata，只动这一个键、不重建向量，写审计）。存量数据用 `pnpm backfill:school-section --library-types=knowledge` 批量回填。
- 结构化记忆版本为 1，包含事实、限制、已尝试措施、待验证解释、未解决问题和约定，逐项记录来源消息、角色与时间。新摘要内容必须摘自来源原文；助手的解释只能记为假设，不能变成教师已经执行的事实。沿用加密摘要列，兼容旧文本；压缩只推进到实际覆盖的来源游标。普通提问和重新生成只装载目标提问之前的历史，最近工具轨迹完整传入模型。切换对象后隔离之前的历史；不带档案时不使用档案工具、助手历史或摘要。
- 业务导航卡由服务端已授权读取结果构建，最多 2 张，前端再校验路径；评估记录、量表草稿、方案和复盘均跳转原页面，无可靠对象关联时只给模块入口。聊天不写方案或业务状态。
- 反馈支持不贴合、不可执行、依据不足、太空泛及加密补充说明。AI 中心只聚合失败率、校验拦截、工具超时、知识缺口、反馈原因、响应 P95 与 token，不授予管理员读取聊天正文的新权限。失败率只统计本版带质量版本的失败事件和完成事件。
- 工具预算到达后收齐已启动结果，额外保留一次无工具的完整回答机会；半截、超时或无输出均失败。停止信号传入模型请求，已发出的数据库只读查询可能无法立即取消，但停止后不落库。
- 本轮对象（`server/domain/assistant-object-mention.ts`）：会话未绑定对象时，入口用确定性代码把本轮消息里唯一命中的学生/班级解析成本轮回答的对象，解决「教师直接写学生姓名、助手却不查档案」的割裂。匹配方式是按当前教师负责的**在册名单**做包含匹配（学生姓名解密后比对、班级名明文），因此含数字、间隔号或超长姓名也能命中；命中多个只把候选取回界面让教师点选，不替教师猜；归档对象不参与。它**不改写会话绑定**：跨会话记忆、摘要与方案收口仍按会话绑定，绑定只由 @ 或教师点「固定为本会话对象」决定。工具按「会话绑定优先，其次本轮对象」收口（`effectiveObject`，`server/agent/tools/record-context.ts`），有任一对象即暴露 `record_snapshot`；教师选择「不带档案咨询」时不做识别，工具仍被裁到三项。`ack` 事件新增 `turnObject` / `turnObjectCandidates` / `suggestedContext` 字段（新增字段、不改事件名）：未绑定会话时界面显示「本次按 X 回答」与固定按钮；已绑定会话里提到**另一个**唯一对象时不静默切换、也不静默忽略，只显示「本轮提到的学生「X」与当前对象不同，是否切换？」并给「切到 X / 保持当前对象」，切换由教师点选触发（`decideEntryObjectUse`，`server/domain/assistant-object-mention.ts`）。固定与切换都走 `POST /api/v1/chat/sessions/[id]/context`，与 @ 换绑共用 `server/domain/chat-session-binding.ts`（元数据留痕 + 产品事件），不再有第二套换绑口径。本轮对象记进助手消息 metadata（只含类型/ID/展示名），回答校验与落库规则不变。
- 停止与重新生成：教师可中断本轮（前端 `AbortController`）；服务端在 `ReadableStream.cancel()` 与响应 `close` 两处置中断标记，落库与发事件前检查，中断则不写库并记 `assistant_answer_aborted`。`POST /api/v1/chat/messages/[id]/regenerate` 复用该回答对应的教师提问重跑一轮，旧回答软删（`chat_messages.deleted_at`），事件流与普通提问完全一致；普通提问与重新生成共用 `server/domain/chat-stream.ts` 的同一份流水线（本轮对象识别口径也一致）。
- 单条消息删除：教师可删除自己会话里的任意一条消息（提问或回答），走 `DELETE /api/v1/chat/messages/[id]`——只允许本人、本校、未删的记录，软删 `deleted_at`/`deleted_by`，**不物理删除**（消息属业务档案，保留在库中供审计与追溯），写审计 `teacher.chat.message.delete` 与产品事件 `assistant_message_deleted`（都只记会话 id 与角色，不记正文）。历史装载本来就过滤软删记录，教师刷新后不再看到该条。已知边界：已被压缩进会话摘要的消息（`created_at <= context_summary_upto_at`）删除后摘要里仍保留其内容；删除带换绑标记的教师提问会让会话内换绑提示丢失（后续 system 前缀随之变化）；删除后该会话的 DeepSeek 前缀缓存会一次性失效。教师提问的消息 id 由提问接口 `ack` 事件的 `userMessageId` 字段回传（新增字段、不改事件名），前端据此把删除按钮挂到刚发出的那条提问上。
- 主动简报：`GET /api/v1/chat/assistant-brief` 返回空态「今日建议」（逾期行动项、待复盘方案、未完成量表草稿、需关注的沟通、未读通知），确定性生成、不调用模型，因此 `local` 数据模式同样可用；点击一条即以该问句发起提问，由 `teacher_brief` 工具在回答里读取真实数据。
- 外发脱敏与本地模式：`redactOutboundText` 对所有外发文本（提问、历史、轨迹、档案、画像、摘要）按学校数据模式脱敏；`local` 模式直接不调用外部模型并向教师返回提示。
- 可观测性：`ai_model_calls` 记录每次模型往返（含工具往返）的输入/输出、缓存命中/未命中 token 与结束原因（`finish_reason`）；AI 中心「调用审计」按「缓存命中」列展示命中量与占比，并在「结束原因」列区分正常结束与 `insufficient_system_resource` 等上游中断。基线对比脚本：`pnpm ai:cache-probe --run`（合成对话，仅手动运行，默认不执行）。

提示词与运行时参数：

- 提示词正文随代码发布，唯一来源是 `server/domain/ai-prompt-baselines.ts`；平台后台 AI 中心的提示词页只读展示，改文案走代码评审与发版。
- 数据库 `ai_prompt_templates`（提示词）与 `ai_runtime_settings`（运行时配置）已随迁移 `drizzle/0051_sour_hellfire_club.sql` 删除，不再存在库内来源。
- 没有 Agent 开关：所有消息一律走 Agent 图；Agent 行为要点（回答先行、先检索再回答、量表优先、不得输出「选项：」列表）在 `server/agent/prompts.ts` 的 `buildFormatInstruction`。「先检索再回答」要求：除寒暄与能力询问外，涉及班主任具体做法、平台量表/工具/SOP/制度的问题必须先调用 `knowledge_search`（必要时再补 `resource_lookup`），回答只能基于工具实际返回的内容——这既保证回答有平台知识依据，也让界面上的「参考知识库 N 条」面板有内容可展示。
- 用语红线：面向教师的文本不得出现「危机、红线、预警、立即、110、120」这些字样（含空格、谐音或拆字写法），已在 `assistant_chat`、`assessment_report`、`tool_step_polish`、`instrument_recommendation`、`chat_history_summary` 五条提示词里约束（同类含义改用「安全事项 / 重点关注、安全底线、关注提示、尽快 / 第一时间」；紧急处置只引导联系校内心理专员或学校值班负责人，不写报警或急救电话号码）。助手回答目前仍是提示词层的软约束，`server/agent/answer-guard.ts` 尚未对回答做词级清洗兜底，若观测到漏出再考虑加一层替换；方案改写与深度报告两条链路已有确定性防线（见第 7 节「方案正文的术语白话化与两道防线」）。

超时说明：`DEEPSEEK_TIMEOUT_MS` 是全局默认（建议 30000）。评估报告润色是最长输出（完整报告 JSON），走专用逻辑：不低于 360000ms，不受全局短超时影响。运行时参数（模型名、超时、embedding）只来自环境变量与代码默认值。

Embedding 只服务模块资源文档分块，不再服务旧知识库。当前部署环境使用百炼 DashScope：

```env
EMBEDDING_ENABLED=true
EMBEDDING_PROVIDER=dashscope
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_API_KEY=
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_TIMEOUT_MS=8000
```

代码仍支持 `EMBEDDING_PROVIDER=ollama`（配 `OLLAMA_BASE_URL`），但正式 compose 已不再内置 ollama 服务，需要自备。切换 provider 后存量向量语义空间不兼容，必须重建。

如需重建模块资源向量，使用 `pnpm resources:reindex`。

## 3.2 语音输入与回答朗读（百炼）

首页助手支持「录音提问」与「朗读回答」，两条链路都复用现有的百炼（DashScope）接入，不需要新增密钥：

```env
# 语音输入与回答朗读（百炼）
SPEECH_ENABLED=true
ASR_MODEL=qwen-audio-3.0-asr-flash
TTS_MODEL=qwen-audio-3.0-tts-flash
TTS_VOICE=longanlingxi
DASHSCOPE_API_BASE_URL=https://dashscope.aliyuncs.com/api/v1
```

模型系列决定端点、请求体与返回结构，代码按模型名前缀自动选择（`server/integrations/dashscope-speech.ts` 的 `asrRequest` / `ttsSynthesisRequest`），换模型只改环境变量、不用改端点，但**两族的差异必须知道**：

- 识别：`qwen3-asr-*`（Qwen-ASR）走 OpenAI 兼容 `/chat/completions`，音频放 `input_audio.data`，结果取 `choices[0].message.content`；`qwen-audio-*`（Qwen-Audio）走原生 `/services/aigc/multimodal-generation/generation`，音频放 `input.messages[].content[].audio`，**必须显式传 `parameters.format`（我们的录音固定 `wav`），否则上游返回 400 `UNSUPPORTED_FORMAT`**；结果取顶层 `text`（多句音频实测能完整返回，不截断），秒数取 `usage.duration`。两族都固定中文并开启数字归一化（`language=zh` / `enable_itn`）。
- 朗读：`qwen-audio-*`（Qwen-Audio-TTS）与 `cosyvoice-*` 走 `/services/audio/tts/SpeechSynthesizer`（入参 text/voice/format/sample_rate）；`qwen3-tts-*` 走 `/services/aigc/multimodal-generation/generation`（入参带 `language_type`）。用错端点上游直接 400。
- `TTS_VOICE` 必须是所选系列存在的系统音色；业务空间专属域名与官方域名都可以用，取 `.env` 的 `DASHSCOPE_BASE_URL` / `DASHSCOPE_API_BASE_URL` 当前值。

- 能力开关与门禁：`GET /api/v1/chat/status` 返回 `speech: { asr, tts }`，取值只反映部署侧是否就绪（`SPEECH_ENABLED` 与 `DASHSCOPE_API_KEY`），前端据此决定是否渲染麦克风、朗读按钮与页头的「语音对话」喇叭开关（不留死按钮）；学校数据模式为 `local` 时不在 `status` 里体现，而是在两个语音接口逐请求返回 403——避免把「环境可用」误读成「本校可用」（前端另按 `GET /api/v1/chat/data-governance` 的 `effectiveMode` 把开关置灰并说明原因）。
- 「语音对话」总开关（对话页页头「AI 助手」标题后的喇叭图标，`app/pages/index.vue`）：喇叭亮=打开，每轮回答定稿自动朗读、发送新问题时先停掉上一条朗读；喇叭灭=关闭，只影响朗读，不影响录音识别后的自动发送。默认关闭且**不落库、不写 localStorage**，每次进入页面都从关闭开始。自动朗读失败一律静默（浏览器拦截自动播放、回答没有可朗读内容返回 409、`local` 模式 403），不逐轮弹错误；教师手动点「朗读」仍会看到失败原因。
- 语音输入（ASR）：浏览器 `MediaRecorder` 录音（最长 60 秒自动停止）→ `AudioContext` 解码并重采样为 16kHz 单声道 WAV（`app/utils/audio.ts`，无第三方依赖）→ `POST /api/v1/chat/transcriptions`（base64 音频 + `mimeType: audio/wav`）→ 服务端按模型系列调识别接口（默认 `qwen-audio-3.0-asr-flash`：原生端点 + `parameters.format=wav`，结果取顶层 `text`；详见上面的系列差异）。识别文本**追加到输入框后直接发送**（不覆盖教师已打的内容；上一轮还在生成时只回填不插队），仍走同一个提问入口 `ask()`，因此安全规则、上下文装配、会话绑定、危机识别都只在提问入口一处生效，语音不会绕开任何一道门禁。手势分两套：手机端（`sm` 以下）输入区默认是「按住说话」大按钮，按下开始录音、松开结束并发送，旁边的键盘图标可切回打字输入（键盘输入模式下点麦克风图标切回按住说话）；桌面端输入框恒显示，麦克风按钮点击开始、再点结束。服务端限制解码后音频不超过 6MB；静音或没有有效语音时返回 422 让教师重录——`qwen-audio` 系列对静音音频直接返回 400 `ASR_RESPONSE_HAVE_NO_WORDS`，已在集成层按 `no_speech` 归类并与「空文本」统一映射为 422（否则会被误报成「服务不可用」）。
- 回答朗读（TTS）：`GET /api/v1/chat/messages/{id}/speech?chunk=n` 逐片取音频。服务端解密回答正文 → `shared/speech.ts` 的 `speechTextOf` 清洗成可朗读纯文本（去代码块、链接地址、表格分隔行、强调标记）→ `splitSpeechChunks` 按句末标点切成不超过 300 字的分片（两端共用同一套口径，避免「有朗读按钮却读不出声」）→ 按学校数据模式过 `redactOutboundText` 脱敏 → 调 TTS 合成（默认 `qwen-audio-3.0-tts-flash` + 系统音色 `longanlingxi`；非流式返回 24 小时有效的音频 URL，**服务端取回字节后同源返回 base64**，不把外部音频 URL 暴露给浏览器）。单条回答最多朗读前 20 片（约 6000 字），超出由前端提示。自动朗读与手动朗读共用 `useSpeechPlayback` 的播放循环与分片缓存（`app/composables/useSpeechPlayback.ts`），同一条回答不会重复请求同一片。
- 音频不落库、不落磁盘；`ai_model_calls` 只记元数据（`provider=dashscope`，`purpose=speech_asr` / `speech_tts`，含 `data_mode`、耗时与错误码 `timeout` / `http:<status>` / `schema` / `oversize` / `unknown`），不记音频与朗读正文；产品事件 `assistant_voice_input_used` / `assistant_voice_playback_used` 同样只记分片位置与数据模式。
- 数据边界：录音原声无法脱敏，因此语音输入与朗读都只在 `redacted` / `full_context` 模式开放；朗读文本按既有外发口径走 `redactOutboundText`（`redacted` 模式下「X 老师」会被念成「PERSON 老师」，这是与其它外发链路一致的取舍）。
- 浏览器限制：`getUserMedia` 只在安全上下文可用，**录音仅在 HTTPS 或 `localhost` 下工作**。测试环境的明文 3400 会把浏览器 307 跳到 `https://<主机>:3401`（见 `docs/DEVELOPMENT_AND_PRODUCTION.md` 第 8.5 节），但自签证书需要把 `infra/certs-test/ca.pem` 装到设备信任列表，否则浏览器会先提示证书不受信；`/health/*` 仍可用明文探活。正式环境走 Nginx + TLS，不受限；Nginx 已为 `/api/v1/chat/transcriptions` 单独放宽 `client_max_body_size`（全局仍为 2m）。

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

## 6. 连续量表流程（一个模块多张量表）

一个模块可以编排多张量表（入口筛查 → 深度诊断 → 专项情境）。编排元数据位于三库量表库发布版本的 `instruments`（`module_resource_versions` payload）中，每张量表可带：

- `role`（`instrumentRole`）：量表角色——`screening` 入口筛查、`deep_dive` 深度诊断、`situational` 专项情境、`red_line` 红线检查。教师端按角色分区展示；红线检查量表默认对教师隐藏。
- `isRequired`：必做标记。
- `prerequisiteCodes`：前置量表编码。前置未完成时本量表锁定。
- `exclusiveCodes`：互斥量表编码。互斥量表已完成时本量表锁定。
- `triggerCondition`：触发条件（如 `量表[SG_S1].总分 >= 15`），引用此前量表的结果。未满足时标为「当前不需要做」，但不是门禁——教师仍可手动选择；满足时标为「建议做」。
- `triggerConditionNote`：触发条件说明，教师端展示。

### 状态判定与推荐

服务端按该教师的历史作答计算每张量表的状态（`buildInstrumentOptions`，五态）：

- `available`：可做（无门禁，或触发条件已满足）。
- `suggested`：触发条件已满足，业务判定「现在该做」。
- `not_needed`：触发条件未满足，当前不需要做；不禁止，教师仍可手动选。
- `locked`：前置量表未完成，或已完成互斥量表——真正禁止。
- `completed`：已做过。

推荐接口（`POST /api/v1/assessments/[module]/recommend`）由 AI 按教师描述挑一张，并受业务规则约束：只能从已发布且未锁定的量表中选；选中的那张被前置量表锁住时改推前置量表（redirected）；DeepSeek 不可用、超时或非法输出时退到规则兜底（优先 suggested → 必做且可做 → 第一张可做的）。红线检查量表只在高危阈值命中（suggested）时才对教师和 LLM 可见，避免安全清单被当成常规问卷做掉。

触发条件的求值口径按「量表是不是对象级」区分（`server/domain/assessment-instruments.ts`）：对象级量表＝`frequency=per_case`、红线检查，以及所在模块的评估对象是班级/学生/家长的量表（口径与模块页的对象选择器同源，见 `shared/assessments.ts` 的 `MODULE_ASSESSMENT_CONTEXT_TYPES`，班级系统的「五系统自评表」就属于这一类）。这类量表的**完成状态、前置/互斥门禁与触发条件**都只认**同一咨询对象**的提交——当前对话/模块页没有关联班级、学生或家长时，这些量表一律按「未对该对象做过」处理，不拿别的班级或家庭、以及没有关联对象的模块级提交当依据；self_growth 这类教师级量表仍按教师历史提交判定。触发条件命中时，给模型的依据是**实测事实**（哪张量表、何时完成、均分与结论等级，见 `InstrumentTriggerEvidence`），不是触发条件原文——规则原文是条件式描述，被转述后容易变成「平台查到你存在风险」这类对教师数据的断言。推荐请求可带 `contextType`/`contextId`（模块页与 AI 对话都会带），方案详情的深度诊断建议同样按方案自身的咨询对象求值。

### 提交、评估组与统一出方案

- 教师提交量表时前端带 `deferPlan: true`：服务端（`POST /api/v1/assessments/[module]/submit`）只把结果落入评估组 `assessment_sessions`，不生成方案，返回 `deferred: true` 与 `assessmentSessionId`。首次提交也会先建组。
- 评估组按业务上下文聚合：同一来源对话或同一关联对象（学生/班级/家长）的提交自动归入同一 open 组（同一对话跨模块各自成组）；无来源对话、无关联对象的直接评估由前端显式携带组 id 续接，该组超过 24 小时未提交视为过期，续接时自动新建组。前端把组 id 存在本地，刷新页面后可继续做同一组的下一张。
- 提交后前端刷新推荐，发现 suggested 量表自动进入下一张继续做；全部建议量表完成后调用 `POST /api/v1/assessments/[module]/finalize`，用组内全部量表结果统一生成一份方案。合并口径（`mergeGroupResults`）：归因按提交顺序合并、按编码去重，主归因取组内首张量表的主归因；严重度取组内最严重（安全导向），等级取最近一次评估结论；维度并集取最大值；工具与行动项按内容去重合并；复盘时间基于最后提交重算。方案内容只由组内已提交量表的确定性结果决定，与提交次数、时序无关。
- 无建议量表时前端自动 finalize：单张评估的体验与直接出方案等价。
- 绿色兜底：组内合并结果显示状态良好、无需方案时（`isNoPlanNeeded`）不出方案，直接告知教师「状态良好，无需方案」，并可继续完成建议量表。

### 熔断例外

高危（熔断）结果不走连续流程：提交时立即创建风险事件与心理转介、冻结评估组内待确认的普通方案并关闭评估组，教师端停留在转介指引页。转介卡片（`app/components/CrisisReferralCard.vue`）展示学校危机指引、校内求助电话（学校设置 `helpPhone`）与心理专员响应时限，首页助手的熔断提示复用同一套组件与规则；面向教师的文案不得出现「危机 / 红线 / 预警 / 立即 / 110 / 120」字样，学校配置的指引在保存时校验、读取时回退默认指引。`deferPlan` 只在非熔断且组可聚合时生效；无组时结果无法聚合，仍按单张直接出方案。

## 7. 方案与复盘

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

方案状态不再只看时间：展示层纳入方案的可执行行动全部完成时，方案由「进行中」自动进入「待复盘」（`planStatusAfterActionUpdate`，与方案页同一套合并/截断口径，被并入归因条的工具行不参与判断）；教师可在方案页「确认目标达成并关闭方案」一次完成收口——服务端按同一口径校验完成情况，写一条真实复盘记录（决策 `close_success`，效果评分默认 5 分、可改）并把方案置为「已完成」（`POST /api/v1/plans/[id]/complete`），也可按原有复盘流程选「继续原方案」回到「进行中」。跳过/取消行动不改变方案状态，行动被撤销完成则回到「进行中」。

### 方案正文的术语白话化与两道防线

方案行动改写（`tool_step_polish`）与 AI 深度报告（`assessment_report`）在生成前会先做一次「术语检索」（`server/domain/term-glossary.ts`）：

1. `term_extraction` 提示词从待改写的正文（工具步骤、归因/等级建议、报告事实与输出模板渲染文案）里抽出教师可能看不懂的专业词，最多 8 个，且每个词必须是输入文本的子串（防编造）；
2. 用 `embedModuleResourceQueries` 批量向量化后逐词检索知识库（每词 top 2、相似度 ≥ 0.5），按 chunkId 合并去重；
3. 检索结果先过 `filterKnowledgeChunks`（`server/domain/knowledge-text-guard.ts`）：文档标题带「输出模板·/ 分级规则·/ 红线·/ 路由·/ 禁忌·」前缀，或正文命中红线词 / 内部编码（六力、A-E、SOP、OTC 等）的片段整段丢弃；
4. 剩余片段作为 `facts.termChunks`（每条带 `term` 标注）交给模型，只用于把已出现的专业词讲成白话，不得当作新步骤、新建议、新工具或制度依据。

出口检查分两档（`server/domain/knowledge-text-guard.ts`）：

- `findBannedTerms`（红线词 + 内部编码：六力、A-E、SOP、OTC 等）继续用于知识片段过滤与字段过滤；
- `findOutboundBannedTerms` 用于「模型产出教师正文」的出口（行动改写、深度报告、输出模板渲染），在此之上追加内部标注：技术编号（T1-T12，含 T4+/T11+ 与「T1-T8」区间写法）、流程编号（S0-S5，含 S0a 子步骤）、响应分级（L1-L3）、维度字母（「维度 D」「D、E 两维」「D 级」「A 到 E」）与「六维」，命中即要求改写成教师能看懂的中文名称。编号类不进「整段丢弃」口径，是因为它们大量夹在有效正文里（本地库 1053 段知识片段中约六分之一含 T/S/L 编号或维度字母），整段丢弃会连带丢内容。

行动改写命中即判本次输出不合格（触发带反馈重试，重试耗尽不写入任何部分结果、方案置 `ai_actions_status=failed`）；深度报告命中即抛错（重试 3 次后收敛为 failed）。输出模板库渲染出的摘要与风险说明在写库前单独兜底：命中即退回模块内置文案并告警，不阻断方案生成。等级、等级中文名、归因名称等取自三库的确定性字段不参与判定，避免三库原文里的词把报告永久判失败。

提示词侧同步声明：`tool_step_polish`、`assessment_report`、`assistant_chat` 三条提示词都写明这些内部标注不得出现在教师正文里，且不算「关键事实」，需要引用技术/维度/流程时一律改用中文名称。

成本与取舍：每条链路多一次小模型调用（`term_extraction`，关闭思考、20 秒超时）+ 一次批量 embedding + 最多 8 次向量查询，均在后台异步执行、不影响教师请求；术语片段与工具名检索结果按 chunkId 去重，合计最多 11 段进入 facts。已知取舍：知识库里的「附录 I 术语表」因含「心理风险 A-E」会被过滤丢弃，后续可用标题白名单放行。

## 助手升级评测
合成案例、真实模型命令、人工盲评标准及领导演示见 [评测说明](ai-evaluation/README.md)。
