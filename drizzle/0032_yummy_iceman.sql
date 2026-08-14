-- users.phone_enc 的删除由 scripts/backfill-phone.ts 在回填完成后执行，
-- 以保证数据库与应用层解密回填之间的执行顺序（drizzle 迁移器为全量执行）。
SELECT 1;