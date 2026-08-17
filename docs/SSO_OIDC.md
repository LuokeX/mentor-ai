# 统一身份验证（OIDC）接入说明

本平台通过 OpenID Connect 授权码 + PKCE 流程接入学校统一身份平台，与本地账密登录并存：OIDC 配置齐全后登录页出现"统一身份登录"入口，未配置时账密登录完全照常（降级路径）。

## 一期边界

- 会话机制不变：OIDC 登录成功后仍走本平台 `sessions` 表 + httpOnly cookie（8 小时滑动续期），所有业务 API 与权限模型不动。
- 角色（`teacher`/`psychologist`/`school_admin`/`platform_admin`）与学校归属始终由本平台维护，不随 IdP 同步。
- 不自动建号：未在本平台预置的账号一律拒绝登录并写入审计（`auth.sso.login` result=`denied`）。
- 不做 RP-initiated logout：退出登录只清除本平台会话，不回跳 IdP 登出端点。
- 心理专员登录后仍需在本平台完成 TOTP 激活与动态码校验（两因素归属本平台，不上收 IdP）。

## 身份平台侧前置条件

对接前需向统一身份平台申请：

1. 一个 confidential client，授权类型为 Authorization Code；
2. 客户端回调地址白名单登记：`https://<本平台域名>/api/v1/auth/sso/callback`（必须完全一致）；
3. 平台 issuer 地址（Discovery 文档所在源）与 client id / secret；
4. scope 需包含 `openid profile email`，userinfo 需返回 `sub`、`email`（建议同时返回工号 `employee_no`，可选 `name`）。

## 配置步骤

在 `.env`（或部署环境变量）中配置：

```bash
OIDC_ISSUER=https://idp.example.edu.cn
OIDC_CLIENT_ID=<平台签发的 client id>
OIDC_CLIENT_SECRET=<平台签发的 client secret>
OIDC_REDIRECT_URI=https://<本平台域名>/api/v1/auth/sso/callback
```

四项齐全后重启应用，登录页即显示"统一身份登录"按钮。Docker Compose 部署时在宿主机环境变量设置同名变量即可（已映射 `NUXT_OIDC_*`）。

## 账号映射规则

IdP 用户信息按以下优先级匹配本地 `users` 表（见 `server/domain/sso.ts`）：

1. `oidc_subject`（首次登录成功时绑定，此后以绑定为准，防止换邮箱导致串号）；
2. `email`（本地唯一索引，当前兜底键）；
3. `employee_no` → `users.employee_no`（仅唯一命中时采用；多校同工号视为歧义跳过）。

命中且用户 `status=active`、所属学校 `status=active` 才放行；命中后首次登录自动回写 `oidc_subject`。未命中返回"该账号未在本平台开通"。

## 本地联调（mock IdP）

无需真实身份平台即可走通完整流程：

```bash
pnpm tsx scripts/mock-oidc-idp.ts --port 3400 --email teacher@demo.local
```

然后设置环境变量（四项指向 mock）：

```bash
OIDC_ISSUER=http://127.0.0.1:3400
OIDC_CLIENT_ID=mock-client
OIDC_CLIENT_SECRET=mock-secret
OIDC_REDIRECT_URI=http://localhost:3301/api/v1/auth/sso/callback
```

启动应用后在登录页点击"统一身份登录"，mock IdP 会直接跳回并完成登录。mock 不校验回调地址，仅限本机使用，禁止部署。

## 审计

- 成功：`auth.sso.login`（含 actor 与学校）。
- 失败：`auth.sso.login` result=`denied`，metadata 记录 IdP issuer 与尝试登录的邮箱。
- 账密登录、TOTP、激活等原有审计不变。

## 相关代码

- 领域逻辑：`server/domain/sso.ts`
- 路由：`server/api/v1/auth/sso/authorize.get.ts`、`server/api/v1/auth/sso/callback.get.ts`
- 登录页：`app/pages/login.vue`
- 配置：`nuxt.config.ts`（runtimeConfig）、`.env.example`、`docker-compose.yml`
- 数据库：`users.password_hash`（可空）、`users.oidc_subject`（唯一，迁移 0029）