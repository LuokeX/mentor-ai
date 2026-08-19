#!/bin/sh
set -eu

# 将正式库最新备份恢复进测试环境数据库（mentor-ai-test postgres:5435）。
# 用于发布演练：每次正式部署前先恢复正式数据副本，再启动测试环境跑迁移与验证。
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