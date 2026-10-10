#!/usr/bin/env bash
set -eu

# 生成「本地 CA + 服务器证书」，供测试环境（3401）和正式环境（443）的 nginx HTTPS 入口使用。
#
# 为什么用本地 CA，而不是直接签一张自签服务器证书：
# 自签服务器证书要受信，必须把这个文件本身导入每台设备的根证书库；一旦证书里换域名或 IP，
# 就得在所有设备上重新导入一遍。改为「一张本地 CA + 由它签发的服务器证书」后，设备只需信任
# ca.pem 一次，之后重签服务器证书（换 IP、续期）不需要动设备。
#
# 重要：即使装了自签/本地 CA 证书，如果设备没有信任 ca.pem，浏览器仍会把页面当成
# 不安全上下文，麦克风（getUserMedia）会被拒绝。所以：
#   - 只用浏览器看页面：可以点「继续访问」，但录音功能不可用；
#   - 要用录音：把对应环境目录下的 ca.pem 安装到设备的「受信任的根证书颁发机构」；
#   - 有条件时用学校或公网 CA 签发的证书替换 fullchain.pem 与 privkey.pem（不需要本地 CA）。
#
# 两个环境各自一张 CA、目录分开（都在 .gitignore 中），避免自签证书被另一个环境误用。
#
# 用法：
#   scripts/gen-cert.sh                 # 测试环境（默认）：写入 infra/certs-test/
#   scripts/gen-cert.sh --env=prod      # 正式环境：写入 infra/certs/
#   scripts/gen-cert.sh 10.0.0.8        # 追加 SAN（IP 或域名，可多个）
#   FORCE=1 scripts/gen-cert.sh         # 重签服务器证书（换 IP、续期）；默认复用已有 CA，设备无需重装
#   NEW_CA=1 FORCE=1 scripts/gen-cert.sh # 连本地 CA 一起重造（所有已安装 ca.pem 的设备需重新安装）
#
# 产物：
#   ca.pem         本地 CA 证书（分发到设备信任库用）
#   ca.key         CA 私钥（仅本机保存，不对外分发）
#   fullchain.pem  服务器证书（nginx ssl_certificate）
#   privkey.pem    服务器私钥（nginx ssl_certificate_key，权限 600）

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
SERVER_DAYS=825
CA_DAYS=3650

ENV_NAME=test
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --env=*) ENV_NAME="${arg#--env=}" ;;
    *) ARGS+=("$arg") ;;
  esac
done

case "$ENV_NAME" in
  test)
    OUT_DIR="$REPO_DIR/infra/certs-test"
    CA_CN="mentor-ai-test-local-ca"
    SERVER_CN="mentor-ai-test"
    ;;
  prod)
    OUT_DIR="$REPO_DIR/infra/certs"
    CA_CN="mentor-ai-local-ca"
    SERVER_CN="mentor-ai"
    ;;
  *)
    echo "[gen-cert] 未知环境 '${ENV_NAME}'，--env 只支持 test 或 prod" >&2
    exit 1
    ;;
esac

if [ -s "$OUT_DIR/fullchain.pem" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "[gen-cert] $OUT_DIR/fullchain.pem 已存在，未覆盖（要重签请用 FORCE=1）" >&2
  exit 0
fi
mkdir -p "$OUT_DIR"

# SAN 列表：localhost + 主机名 + 127.0.0.1 + 本机所有 IPv4，再加命令行追加项
sans="DNS:localhost,DNS:$(hostname),IP:127.0.0.1"
for ip in $(hostname -I 2>/dev/null || true); do
  sans="$sans,IP:$ip"
done
for extra in ${ARGS[@]+"${ARGS[@]}"}; do
  case "$extra" in
    # 形如 x.x.x.x 的按 IP 写入，其余按域名写入
    [0-9]*.[0-9]*.[0-9]*.[0-9]*) sans="$sans,IP:$extra" ;;
    *) sans="$sans,DNS:$extra" ;;
  esac
done

if [ -s "$OUT_DIR/ca.key" ] && [ -s "$OUT_DIR/ca.pem" ] && [ "${NEW_CA:-0}" != "1" ]; then
  # 复用已有 CA：换 IP、续期只重签服务器证书，设备已信任的 ca.pem 继续有效，不用重装
  echo "[gen-cert] 复用已有本地 CA（要重造 CA 请用 NEW_CA=1）…"
else
  echo "[gen-cert] 生成 $ENV_NAME 环境本地 CA…"
  openssl req -x509 -newkey rsa:4096 -sha256 -days "$CA_DAYS" -nodes \
    -keyout "$OUT_DIR/ca.key" -out "$OUT_DIR/ca.pem" \
    -subj "/CN=$CA_CN" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1
fi

echo "[gen-cert] 生成服务器证书（SAN: $sans）…"
openssl req -newkey rsa:2048 -sha256 -nodes \
  -keyout "$OUT_DIR/privkey.pem" -out "$OUT_DIR/server.csr" \
  -subj "/CN=$SERVER_CN" >/dev/null 2>&1

openssl x509 -req -in "$OUT_DIR/server.csr" \
  -CA "$OUT_DIR/ca.pem" -CAkey "$OUT_DIR/ca.key" -CAcreateserial \
  -out "$OUT_DIR/fullchain.pem" -days "$SERVER_DAYS" -sha256 \
  -extfile <(printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$sans") >/dev/null 2>&1

# 保留 ca.srl：复用 CA 重签时序列号会继续递增，避免新旧证书出现相同序列号
rm -f "$OUT_DIR/server.csr"
chmod 600 "$OUT_DIR/ca.key" "$OUT_DIR/privkey.pem"
chmod 644 "$OUT_DIR/ca.pem" "$OUT_DIR/fullchain.pem"

echo "[gen-cert] 完成，文件位于 $OUT_DIR："
ls -1 "$OUT_DIR"
echo
if [ "$ENV_NAME" = "prod" ]; then
  echo "下一步："
  echo "  1) 启动/重启正式环境的 HTTPS 入口：docker compose up -d nginx"
  echo "  2) 自检：curl -sk https://127.0.0.1:3301/health/ready（换证书后先 docker compose exec nginx nginx -s reload）"
  echo "  3) 要让录音等安全上下文功能可用：把 $OUT_DIR/ca.pem 安装到访问设备的「受信任的根证书颁发机构」。"
else
  echo "下一步："
  echo "  1) 启动/重启测试环境的 HTTPS 入口：docker compose -f docker-compose.test.yml up -d nginx"
  echo "  2) 自检：curl -vk --resolve $(hostname):3401:127.0.0.1 https://$(hostname):3401/health/ready"
  echo "  3) 要让录音等安全上下文功能可用：把 $OUT_DIR/ca.pem 安装到访问设备的「受信任的根证书颁发机构」。"
fi
