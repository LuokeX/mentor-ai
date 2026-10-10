-- 合并「学校系统管理员」（system_admin）到「学校管理员」（school_admin）。
--
-- 背景：system_admin 是按 PRD R4/R7 新增的「只做账号开通与维护 + 平台使用量看板」角色，
-- 其账号管理能力与 school_admin 完全重合。业务确认后收敛为一个角色：保留 school_admin，
-- 使用量看板（/usage，S1/S2/S4）随之下放给学校管理员；业务档案仍走
-- 「事由 ≥10 字 + 15 分钟目标级授权 + 审计」的受控只读路径。
--
-- 迁移步骤：
-- 1) 同时持有两个角色的账号：删除多余的 system_admin 行（避免撞 user_roles 唯一约束）；
-- 2) 只持有 system_admin 的账号：角色行改名为 school_admin（保留原有 scope）；
-- 3) 主角色为 system_admin 的账号：users.role 同步为 school_admin；
-- 4) roles 目录表删除 system_admin 行（0064 曾写入）。
-- 幂等：无匹配行时均为空操作，可安全重复执行。

-- 1) 用 CTE 先物化「冗余行」，避免自引用 DELETE 的不确定语义
WITH redundant AS (
  SELECT sys."id"
  FROM "user_roles" sys
  JOIN "user_roles" sch ON sch."user_id" = sys."user_id" AND sch."role_code" = 'school_admin'
  WHERE sys."role_code" = 'system_admin'
)
DELETE FROM "user_roles" WHERE "id" IN (SELECT "id" FROM redundant);

-- 2) 其余 system_admin 行改名为 school_admin
UPDATE "user_roles"
SET "role_code" = 'school_admin', "updated_at" = now()
WHERE "role_code" = 'system_admin';

-- 3) 同步账号主角色
UPDATE "users"
SET "role" = 'school_admin', "updated_at" = now()
WHERE "role" = 'system_admin';

-- 4) 角色目录表移除 system_admin
DELETE FROM "roles" WHERE "code" = 'system_admin';
