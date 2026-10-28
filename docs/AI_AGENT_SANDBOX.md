# AI 工作 Agent 与文档工作区沙箱

> 状态：Phase 0/1（2026-10-28）。`SANDBOX_ENABLED=false` 默认关闭；当前只落了独立 runner 与 app 客户端骨架，Agent 工具和上传 UI 在 Phase 2 接入。

## 1. 为什么做

现有 AI 是「问答助手 + 只读业务工具 + 确定性导出」：能查学生/班级/方案，能生成教案文本，但不能在工作区里处理教师上传的资料、生成和迭代产物。工作 Agent 需要补上：

1. **执行环境**：文件与文档处理在隔离环境里跑，不在 app 进程里跑。
2. **工作区**：每个任务一个临时目录，上传资料、解析结果、生成文件都在里面。
3. **权限**：工作区内自动读写；导出/分享等对外动作由教师确认；业务库始终只读。
4. **审计**：任务、工具调用、文件、产物、导出都可回放。

## 2. 非目标

- 不做通用代码/Shell 沙箱：模型不能执行任意命令、不能访问外网。
- 不替代现有确定性规则、量表、归因、危机熔断。
- 不允许模型直接写业务库；学生/班级/方案/沟通的写入仍走既有 REST 路由。
- Phase 1 不接入模型：runner 只做文件与文本抽取，模型调用仍在 app。

## 3. 威胁模型

| 风险 | 处理 |
|---|---|
| 上传恶意 Office/压缩包 | 只解析 txt/md/docx 的文本；不执行宏、不展开外部关系；ZIP 非法结构返回 415 |
| 路径穿越/符号链接 | 文件名只允许 basename，拒绝 `/`、`\`、`..`、控制字符；工作区目录用 UUID 且校验 resolve 前缀 |
| 资源耗尽 | 单文件 20MB、工作区 100MB、50 个文件、30 分钟 TTL；容器 1GB / 1 CPU / 128 pids |
| 数据外泄 | runner 只挂 `internal: true` 网络，无外网；app 调模型前按学校数据模式脱敏 |
| 越权访问 | app 只暴露本人、本校、未删除的会话/文件；runner 只认 Bearer token + 不可猜 UUID |
| 容器逃逸 | 非 root、只读根文件系统、`cap_drop: ALL`、`no-new-privileges`、tmpfs 工作区 |
| 日志泄露 | 日志只记 method/status/耗时，不记文件名、路径、正文、token |

## 4. 架构

```text
教师浏览器
   │ 上传资料 / 生成 / 下载
   ▼
app（Nuxt/Nitro）
   ├─ Agent loop（DeepSeek，只读业务工具）
   ├─ 权限/审计/积分
   ├─ SandboxClient ──HTTP+Bearer──> sandbox-runner（独立容器）
   │                                  ├─ 每任务工作区（tmpfs）
   │                                  ├─ 文件读写/列表/删除
   │                                  ├─ txt/md/docx 文本抽取
   │                                  └─ 无 shell、无外网、无模型
   └─ 确定性文档生成（Word 导出等）
```

- **模型不在沙箱里**：模型只做决策；工具调用由 app 转发到 runner 或现有只读工具。
- **runner 不在 app 进程里**：独立镜像、独立网络、独立资源限额；app 通过内部地址访问。
- **Phase 2 的工具**：`sandbox_write_file`、`sandbox_read_file`、`sandbox_list_files`、`sandbox_extract`、`sandbox_generate_docx`。全部限制在工作区内，写业务库的工具不新增。

## 5. runner API（Phase 1）

内部地址 `http://sandbox-runner:3200`，除 `/health` 外都要求 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查，返回工作区数量 |
| POST | `/v1/workspaces` | 创建临时工作区，返回 `workspaceId` |
| DELETE | `/v1/workspaces/{id}` | 删除工作区及其文件 |
| GET | `/v1/workspaces/{id}/files` | 文件列表（名称/大小/更新时间） |
| PUT | `/v1/workspaces/{id}/files/{name}` | 上传原始字节（≤20MB） |
| GET | `/v1/workspaces/{id}/files/{name}` | 下载文件 |
| DELETE | `/v1/workspaces/{id}/files/{name}` | 删除文件 |
| POST | `/v1/workspaces/{id}/extract` | `{ name }`，返回 `{ text, truncated }` |

错误统一为 `{ error: { code, message } }`，中文 message；不返回堆栈。

## 6. 权限与数据治理

- **工作区**：app 把 `workspaceId` 绑定到当前教师 + 会话/任务；不同教师/学校不共享。
- **文件**：上传后只存在 runner 的 tmpfs；TTL 到期或任务结束删除；不写 app 数据库。
- **模型上下文**：runner 返回的文本由 app 按 `local/redacted/full_context` 处理后再发给 DeepSeek；`local` 模式不调用外部模型。
- **业务库**：Agent 仍只有现有只读工具；写入走 REST + 归属/并发/审计。
- **导出**：Word/PPT 等产物由教师点击导出；导出事件写审计。
- **积分**：Phase 3 接入 C 端计费（按任务/轮次或积分），当前不改变现有问答 100 积分口径。

## 7. 部署与运维

- 新增镜像 `mentor-ai-sandbox`（正式）/ `mentor-ai-test-sandbox`（测试），Dockerfile 在 `sandbox/Dockerfile`。
- 新增 `sandbox-internal` 网络（`internal: true`，无默认网关）；只有 app 同时挂默认网络与内部网络。
- `sandbox-runner` 在 `--profile sandbox` 下启动；默认 `docker compose up -d` 不启动，app 的 `SANDBOX_ENABLED=false`。
- 启用步骤：
  ```bash
  # 生成强随机 token，写入 .env（不要提交）
  openssl rand -hex 32
  # .env: SANDBOX_ENABLED=true / SANDBOX_RUNNER_TOKEN=<token>
  IMAGE_TAG=<tag> docker compose --profile sandbox build sandbox-runner
  IMAGE_TAG=<tag> docker compose --profile sandbox up -d
  ```
- 验收：`docker compose --profile sandbox ps` 中 runner healthy；`app` 内 `curl http://sandbox-runner:3200/health` 200；从外网/其他容器访问 runner 应失败。
- 回滚：`SANDBOX_ENABLED=false` + `docker compose --profile sandbox stop sandbox-runner`；app 不依赖 runner 即可启动。

## 8. 分阶段计划

| 阶段 | 交付 | 状态 |
|---|---|---|
| 0 | 本文档 + 威胁模型 + compose/环境变量 | 本次 |
| 1 | runner（工作区/文件/抽取）、SandboxClient、单测 | 本次 |
| 2 | 备课上传 UI、Agent 工作区工具、Word/PPT 产物、权限与审计 | 待排期 |
| 3 | 预览/版本/清理、C 端计费与配额、测试环境验收 | 待排期 |
| 4 | 抽象为通用教师工作区，再评估子 Agent/记忆 | 待排期 |

## 9. 待确认

- 上传文件是否需要持久化（当前设计为任务结束即删）；若需要，走 OSS 加密 + TTL，不进 app 数据库。
- 备课产物是否需要 PPT/Excel；Phase 2 先 Word，后续加 PPT。
- C 端积分口径：按任务、按文档页数还是按 token；需要产品确认。
- 是否需要把 runner 也用于学生个案/班级工作区；先完成备课闭环再评估。
