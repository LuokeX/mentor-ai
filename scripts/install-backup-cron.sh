#!/bin/sh
set -eu

# 幂等安装「每日自动备份到阿里云 OSS」的 crontab 条目（数据库 + 代码）。
# 重复执行不会产生重复条目；卸载请用 `crontab -e` 手动删除 run-backup.sh 那一行。
#
# 用法：
#   ./scripts/install-backup-cron.sh                                # 默认每天 03:00
#   CRON_SCHEDULE="0 */6 * * *" ./scripts/install-backup-cron.sh    # 自定义频率（每 6 小时）
#
# 前置条件：已在仓库根创建 .env.backup（参考 .env.backup.example），
# 且 `pnpm backup:oss -- --check` 验证通过。

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCHEDULE="${CRON_SCHEDULE:-0 3 * * *}"

if [ ! -f "$ROOT/.env.backup" ]; then
  echo "缺少 $ROOT/.env.backup：请先复制 .env.backup.example 并填写 OSS 配置。" >&2
  exit 1
fi

mkdir -p "$ROOT/backups"

LINE="$SCHEDULE cd $ROOT && $ROOT/scripts/run-backup.sh >> $ROOT/backups/backup-cron.log 2>&1"

CURRENT="$(crontab -l 2>/dev/null || true)"
# 按完整路径匹配（本机可能有其它项目也用同名 run-backup.sh，只认本仓库这一条）
if printf '%s\n' "$CURRENT" | grep -Fq "$ROOT/scripts/run-backup.sh"; then
  echo "cron 任务已存在，未重复安装："
  printf '%s\n' "$CURRENT" | grep -F "$ROOT/scripts/run-backup.sh"
  exit 0
fi

printf '%s\n%s\n' "$CURRENT" "$LINE" | sed '/^[[:space:]]*$/d' | crontab -

echo "已安装 cron 任务（日志：backups/backup-cron.log）："
crontab -l | grep -F "$ROOT/scripts/run-backup.sh"
