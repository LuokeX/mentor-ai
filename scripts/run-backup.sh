#!/usr/bin/env bash
# 供 crontab 调用：切换到仓库根目录、补齐 Node 环境后执行 OSS 备份脚本。
# 手动执行效果与 `pnpm backup:oss` 一致；额外参数原样透传（--dry-run / --check / --list）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# cron 的 PATH 很干净，nvm 安装的 node 不在其中：取版本号最大的一个 node 目录。
if ! command -v node >/dev/null 2>&1; then
  if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_BIN_DIR="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -n 1)"
    if [ -n "$NODE_BIN_DIR" ]; then
      export PATH="$NODE_BIN_DIR:$PATH"
    fi
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[backup] 未找到 node，请确认 nvm 安装路径或改用绝对路径" >&2
  exit 1
fi

exec "$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/backup-to-oss.ts" "$@"
