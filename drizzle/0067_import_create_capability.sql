-- 「导入管理」页放行「新建导入」能力。
--
-- 背景：学校管理员要在页面上执行导入（CSV：账号/班级/学生/家长；xlsx：家校沟通/学生事件记录），
-- 接口本来只校验 school_admin 角色，但 roles.permissions 里 import 页能力此前只有 view，
-- 管理框架据此隐藏了「新建导入」按钮，页面无法打开导入抽屉。
--
-- 事实来源：白名单在 shared/management.ts 的 TARGET_CAPABILITY_MATRIX（import.pages = view/create），
-- 默认清单在 server/domain/roles.ts 的 DEFAULT_ROLE_PERMISSIONS.school_admin；本迁移把存量角色行对齐。
-- 记录级能力仍保持只读（导入历史不可改、不可删），平台管理员不经手学校导入，维持 view。
UPDATE "roles"
SET "permissions" = jsonb_set(
      "permissions",
      '{pages,import}',
      '["view", "create"]'::jsonb,
      true
    ),
    "updated_at" = now()
WHERE "code" = 'school_admin';
