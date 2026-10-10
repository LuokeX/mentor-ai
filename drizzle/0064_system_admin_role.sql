-- 新增学校级角色「系统管理员」（system_admin，对应 PRD 第 3 章 R4 / 8.3 的 R7 定位）。
--
-- 职责边界：只做学校账号开通 / 权限维护与平台使用量看板（S1 平台使用总览、S2 使用量趋势、
-- S4 操作审计日志），不具备任何业务数据查看权；业务实体目标类型与数据驾驶舱全部显式写空。
-- 一校一个账号，由平台侧用 scripts/create-account.ts 开通（不进入 SCHOOL_MANAGED_ROLES，
-- 学校后台账号列表里不提供编辑/停用按钮）。
--
-- 权限清单的事实来源是 server/domain/roles.ts 的 DEFAULT_ROLE_PERMISSIONS.system_admin，
-- 两者必须保持一致（tests/roles-permissions.test.ts 校验数据驱动与硬编码结果等价）。
INSERT INTO "roles" ("code", "name", "description", "is_system", "permissions") VALUES (
  'system_admin',
  '系统管理员',
  '系统管理员：仅负责校内账号开通与权限维护，可见平台使用量看板（S1/S2/S4），不可见任何业务数据与数据驾驶舱',
  true,
  '{"records":{"class":[],"student":[],"guardian":[],"communication":[],"guardian_communication":[],"student_event":[],"class_event":[],"student_case":[],"department":[],"user":["view","edit","delete","disable"],"school":[],"referral":[],"audit":[],"import":[],"plan_operation":[],"access_request":[],"assessment":[],"plan":[],"conversation":[],"dashboard":[],"dashboard_ai_questions":[],"dashboard_plans":[],"dashboard_alerts":[]},"pages":{"class":[],"student":[],"guardian":[],"communication":[],"guardian_communication":[],"student_event":[],"class_event":[],"student_case":[],"department":[],"user":["view","create"],"school":[],"referral":[],"audit":[],"import":[],"plan_operation":[],"access_request":[],"assessment":[],"plan":[],"conversation":[],"dashboard":[],"dashboard_ai_questions":[],"dashboard_plans":[],"dashboard_alerts":[]}}'::jsonb
) ON CONFLICT ("code") DO NOTHING;
