#!/usr/bin/env bash
set -eu

# 本地开发服务器（带 cgroup 内存硬上限）。
#
# 为什么需要：Nuxt dev 除 V8 堆外还有大量非堆/原生内存（esbuild、vue-tsc、
# Vite 模块图、Nitro 等），NODE_OPTIONS 的 --max-old-space-size 只约束 V8 堆。
# 2026-09-10 16:33:56 内核日志记录该进程 anon-rss 涨到 34.4 GiB（total-vm 68 GiB，
# 仅页表就 739 MiB），触发 kernel 全局 OOM（global_oom，PID 1003182 被杀）。
# 这里把 dev server 放进 systemd 用户级 transient service，用 cgroup 限制整棵
# 进程树：只用 MemoryMax（默认 16G）做硬上限，超过后 cgroup 只杀 dev server
# 自己，不再拖垮整机和桌面会话。不设 MemoryHigh——它带来的持续节流会产生内存
# 压力，Ubuntu 的 systemd-oomd（user@ 服务默认 ManagedOOMMemoryPressure=kill，
# 阈值 50%）会据此在远低于上限时就把整个单元杀掉。
#
# 用法：
#   scripts/dev-server.sh start     # 启动（会先停掉同名单元）
#   scripts/dev-server.sh stop
#   scripts/dev-server.sh restart
#   scripts/dev-server.sh status    # 单元状态 + 当前/峰值内存 + 健康检查
#   scripts/dev-server.sh logs      # 跟踪日志
#
# 可调环境变量：
#   MEMORY_HIGH=8G  MEMORY_MAX=12G  MEMORY_SWAP_MAX=1G   内存限制
#   HEAP_MB=6144                                        V8 堆上限（NODE_OPTIONS）
#   UNPROTECTED=1   跳过 systemd，直接前台运行（仅用于不支持 cgroup 的机器）
#
# 数据库指向：开发服务器固定连本地开发库，配置独立在仓库根的 .env.dev
# （DEV_DB_PORT / DEV_DB_NAME，或用 DEV_DATABASE_URL 给完整连接串），
# 与共用 .env 的 DATABASE_URL 解耦；账号密码仍取自 .env。

UNIT=mentor-ai-dev
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

# 内存限制：MemoryHigh 默认不设——它会让内核持续节流并产生内存压力，
# Ubuntu 的 systemd-oomd（user@ 服务默认 ManagedOOMMemoryPressure=kill，
# 阈值 50%）会因此把整个单元杀掉；只用 MemoryMax 做硬上限，超限由 cgroup
# 自己杀，触发点明确、也让 oomd 没有插手的余地。
MEMORY_HIGH=${MEMORY_HIGH:-}
MEMORY_MAX=${MEMORY_MAX:-16G}
MEMORY_SWAP_MAX=${MEMORY_SWAP_MAX:-1G}
DEV_DB_PORT=${DEV_DB_PORT:-5434}
DEV_DB_NAME=${DEV_DB_NAME:-mentor_ai_dev}
HEAP_MB=${HEAP_MB:-6144}

# 单元内部实际执行的进程：加载 .env、指向 dev 库、启动 nuxt dev
run_dev() {
  cd "$REPO_DIR"
  # nvm.sh 是 bash 专用脚本，且内部有未定义变量，需临时关掉 set -u
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    set +u
    # shellcheck disable=SC1090
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
    nvm use 24 >/dev/null 2>&1 || true
    set -u
  fi
  set -a
  # shellcheck disable=SC1091
  . ./.env
  # 开发服务器连哪个库独立在 .env.dev（不含密钥，账号密码仍来自 .env）
  if [ -f ./.env.dev ]; then
    # shellcheck disable=SC1091
    . ./.env.dev
  fi
  set +a
  DEV_DB_PORT=${DEV_DB_PORT:-5434}
  DEV_DB_NAME=${DEV_DB_NAME:-mentor_ai_dev}
  # .env 的 DATABASE_URL 可能指向其它环境（如测试库 5435），这里固定指向本地开发库
  export DATABASE_URL="${DEV_DATABASE_URL:-postgres://$APP_DB_USER:$APP_DB_PASSWORD@localhost:$DEV_DB_PORT/$DEV_DB_NAME}"
  export NUXT_DATABASE_URL="$DATABASE_URL"
  export NODE_OPTIONS="--max-old-space-size=$HEAP_MB"
  echo "[dev-server] 数据库 $(printf %s "$DATABASE_URL" | sed -E 's#(://[^:]+:)[^@]+@#\1***@#')"
  echo "[dev-server] cgroup 上限 MemoryHigh=${MEMORY_HIGH:-未设置} MemoryMax=$MEMORY_MAX MemorySwapMax=$MEMORY_SWAP_MAX，V8 堆上限 ${HEAP_MB}MB"
  exec pnpm dev
}

unit_cgroup() {
  systemctl --user show -p ControlGroup --value "$UNIT" 2>/dev/null
}

case "${1:-start}" in
  __run)
    run_dev
    ;;
  start)
    systemctl --user stop "$UNIT" >/dev/null 2>&1 || true
    systemctl --user reset-failed "$UNIT" >/dev/null 2>&1 || true
    if [ "${UNPROTECTED:-0}" = "1" ]; then
      echo "[dev-server] UNPROTECTED=1，直接在内存限制之外运行" >&2
      run_dev
      exit $?
    fi
    run_opts=(-p WorkingDirectory="$REPO_DIR" -p MemoryMax="$MEMORY_MAX" -p MemorySwapMax="$MEMORY_SWAP_MAX")
    if [ -n "$MEMORY_HIGH" ]; then
      run_opts+=(-p MemoryHigh="$MEMORY_HIGH")
    fi
    systemd-run --user --unit="$UNIT" --collect \
      "${run_opts[@]}" \
      -p Restart=on-failure -p RestartSec=15 \
      -p StartLimitIntervalSec=120 -p StartLimitBurst=3 \
      -p Environment=DEV_DB_PORT="$DEV_DB_PORT" \
      -p Environment=DEV_DB_NAME="$DEV_DB_NAME" \
      -p Environment=HEAP_MB="$HEAP_MB" \
      -p Environment=MEMORY_HIGH="$MEMORY_HIGH" \
      -p Environment=MEMORY_MAX="$MEMORY_MAX" \
      -p Environment=MEMORY_SWAP_MAX="$MEMORY_SWAP_MAX" \
      /bin/bash "$SCRIPT" __run
    echo "[dev-server] 已启动单元 $UNIT（约 20-40 秒后就绪）"
    echo "[dev-server] 日志：journalctl --user -u $UNIT -f    状态：$SCRIPT status"
    ;;
  stop)
    systemctl --user stop "$UNIT" 2>/dev/null || true
    echo "[dev-server] 已停止 $UNIT"
    ;;
  restart)
    "$SCRIPT" stop >/dev/null
    "$SCRIPT" start
    ;;
  status)
    systemctl --user status "$UNIT" --no-pager 2>&1 | head -14 || true
    cg=$(unit_cgroup)
    if [ -n "$cg" ]; then
      echo "--- cgroup 内存（$cg） ---"
      for f in memory.max memory.high memory.swap.max memory.current memory.peak; do
        printf '%-18s %s\n' "$f" "$(cat "/sys/fs/cgroup$cg/$f" 2>/dev/null || echo '-')"
      done
    fi
    echo "--- 健康检查 ---"
    curl -s -m 5 http://127.0.0.1:3305/health/ready || echo "3305 无响应"
    echo
    ;;
  logs)
    journalctl --user -u "$UNIT" -f
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status|logs}" >&2
    exit 2
    ;;
esac
