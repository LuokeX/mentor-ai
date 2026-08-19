# 部署、回滚、备份与事故处理手册

数据库 Schema 变更、开发命令、正式部署顺序和禁止事项以 [数据库与应用开发、发布和运行规范](DEVELOPMENT_AND_PRODUCTION.md) 为准；本文侧重运行期检查和事故处置。

## 上线前检查

- 校内域名解析到部署服务器，TLS 证书和私钥权限正确。
- `.env` 中数据库、会话和加密密钥均为独立强随机值；不得使用示例值。
- `SMS_PROVIDER=webhook` 已配置真实网关，网关按 `Idempotency-Key` 去重。
- DeepSeek Base URL、模型名、超时和出口白名单已联调；故障时已验证本地路由降级。
- 学校已配置默认心理专员、求助电话、危机文案和短信接收人。
- 已删除演示账号。

## 发布与回滚

发布流程固定为「版本标签 → 备份 → 构建 → 部署 → 验证」五步。**每次正式发布必须先由发布人确认版本号（`vX.Y.Z`），且 git 标签与 docker 镜像标签必须一致**；部署完成后记录：migration、备份文件及校验和、健康检查与冒烟结果。

```bash
# 1) 打 git 标签并推送（版本号由发布人确认，禁止代理自行决定）
git tag -a vX.Y.Z -m "正式部署：<本次变更摘要>"
git push origin vX.Y.Z

# 2) 发布前备份数据库
./scripts/backup.sh

# 3) 构建镜像（一次只跑一个 build，禁止并发 build 互相排队阻塞）
docker compose build app

# 4) docker 镜像打与 git 相同的版本标签
docker tag mentor-ai-app:latest mentor-ai-app:vX.Y.Z
docker tag mentor-ai-migrate:latest mentor-ai-migrate:vX.Y.Z

# 5) 部署并验证
docker compose up -d
docker compose ps          # app 状态 healthy
curl -fsS http://localhost:3300/health/ready
# 冒烟：四角色登录 + /auth/me
```

应用回滚使用上一个经过验证的**版本镜像标签**（`mentor-ai-app:v<上一版本>`）重新部署，不依赖 `latest`。数据库迁移默认只做向前兼容变更；若必须回退数据库，先停止 App（含内置通知消费者），再在隔离数据库验证目标备份，最后使用恢复脚本。不要在未验证备份时直接删除卷。

正式环境禁止执行 `pnpm db:seed`、`pnpm env:init`、`pnpm dev` 和 `docker compose down -v`。每次发布必须记录 migration、备份文件及校验和、健康检查与冒烟结果。

## 每日备份与恢复演练

建议由校内调度系统每天执行 `scripts/backup.sh`，将输出目录同步至加密的异机存储。至少每月在隔离实例执行一次恢复，并记录：备份文件、校验和、开始/完成时间、恢复人、抽样记录数和应用健康检查结果。

## 健康与日志

- 存活：`GET /health/live`
- 就绪：`GET /health/ready`
- App（含内置通知消费者）、Nginx 和 PostgreSQL 日志使用 `docker compose logs` 收集；生产环境应接入校内集中日志并限制管理员访问。
- 内置通知消费者会回收超过两分钟的 `processing` 锁；短信按立即、1、5、15 分钟尝试。最终失败时 `notification_outbox.status=failed`，需要人工复核接收人和网关。

## 危机事故

1. 不等待 AI：教师页面展示校内求助电话，风险事件和转介先落库。
2. 心理专员确认收到并转入线下流程；平台不替代 110/120 或学校既有制度。
3. 短信失败时通过校内备用电话联系；不得在短信或普通聊天工具中发送姓名和个案正文。
4. 保存风险事件号、转介号、Outbox 状态和审计号，禁止擅自修改原记录。
5. 处置结束后由合规负责人复盘响应时间、授权访问和通知失败原因。

## 数据泄露或越权

立即停用相关账号并撤销会话，保全 `audit_logs`、`admin_access_requests`、`admin_access_grants` 和 `admin_access_events`；必要时停用受影响学校。不要用常规数据库页面查看业务正文。按校方制度通知合规负责人，确认影响对象、字段和时间范围后再决定通知和恢复。

## 密钥轮换

会话密钥可在维护窗口替换并使现有会话失效。`ENCRYPTION_KEY` 直接替换会导致旧密文无法读取，因此必须通过专用离线轮换程序逐条解密再加密，并保留受控旧密钥直到校验完成；封闭试用期不得手工批量更新密文字段。
