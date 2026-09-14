#!/bin/sh
set -eu

# 【特殊场景工具，不属于发布流程】用正式库最新备份覆盖测试环境数据库
# （mentor-ai-test postgres:5435）。
#
# 默认的测试版本发布**禁止**执行本脚本：测试库使用自有数据并跨版本保留，
# 发布时只重建镜像、执行 migration 并重启，详见
# docs/DEVELOPMENT_AND_PRODUCTION.md 第 7、8.4 节。
# 仅当确有需要（例如复现只在正式数据上出现的迁移问题）并经明确授权时才手动执行；
# 本脚本会清空并覆盖测试库现有数据，执行前先确认可以丢弃。
#
# 用法：
#   ./scripts/refresh-test-db.sh                 # 使用 backups/ 下最新备份
#   ./scripts/refresh-test-db.sh backups/xxx.sql.gz   # 指定备份
#
# 注意：恢复后测试库即为正式数据完整副本（真实人员与业务内容），
# 仅允许本机回环访问，禁止对外开放或外传。

BACKUP_FILE="${1:-$(ls -t backups/mentor-ai-*.sql.gz | head -1)}"
if [ ! -f "$BACKUP_FILE" ]; then
  echo "备份文件不存在: $BACKUP_FILE" >&2
  exit 1
fi

if ! docker compose -f docker-compose.test.yml ps --status running postgres | grep -q "Up"; then
  echo "启动测试环境 postgres（首次约需 30 秒初始化）..."
  docker compose -f docker-compose.test.yml up -d postgres
fi

echo "等待测试环境 postgres 就绪..."
for i in $(seq 1 30); do
  docker compose -f docker-compose.test.yml exec -T postgres pg_isready -U "${POSTGRES_USER:-mentor_admin}" -d mentor_ai >/dev/null 2>&1 && break
  sleep 2
done

# 停 app 避免恢复期间活跃连接阻塞 DROP SCHEMA
docker compose -f docker-compose.test.yml stop app >/dev/null 2>&1 || true

# 清空 public schema：--clean 备份的 DROP 顺序无法处理交叉外键，
# 在已有数据的测试库上直接恢复必然失败（如 users 被多表依赖）。
echo "清空测试库 public schema..."
docker compose -f docker-compose.test.yml exec -T postgres psql -U "${POSTGRES_USER:-mentor_admin}" -d mentor_ai -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA public CASCADE" -c "CREATE SCHEMA public" \
  -c "GRANT USAGE ON SCHEMA public TO ${APP_DB_USER:-mentor_app}" >/dev/null

echo "恢复 $BACKUP_FILE 到测试库..."
gzip -dc "$BACKUP_FILE" | docker compose -f docker-compose.test.yml exec -T postgres psql -U "${POSTGRES_USER:-mentor_admin}" -d mentor_ai -v ON_ERROR_STOP=1
echo "测试库已刷新为正式库副本（$(basename "$BACKUP_FILE")）"