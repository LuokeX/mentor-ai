#!/usr/bin/env bash
set -eu

# 生成测试环境 HTTPS 入口（宿主 3401）使用的「本地 CA + 服务器证书」。
#
# 为什么用本地 CA，而不是直接签一张自签服务器证书：
# 自签服务器证书要受信，必须把这个文件本身导入每台设备的根证书库；一旦证书里换域名或 IP，
# 就得在所有设备上重新导入一遍。改为「一张本地 CA + 由它签发的服务器证书」后，设备只需信任
# ca.pem 一次，之后重签服务器证书（换 IP、续期）不需要动设备。
#
# 重要：即使装了自签/本地 CA 证书，如果设备没有信任 ca.pem，浏览器仍会把页面当成
# 不安全上下文，麦克风（getUserMedia）会被拒绝。所以：
#   - 只用浏览器看页面：可以点「继续访问」，但录音功能不可用；
#   - 要用录音：把 infra/certs-test/ca.pem 安装到设备的「受信任的根证书颁发机构」；
#   - 正式环境请使用学校或公网 CA 签发的证书，不要用本脚本的产物。
#
# 用法：
#   scripts/gen-test-cert.sh                 # SAN 自动包含 localhost、主机名、127.0.0.1 与本机所有 IPv4
#   scripts/gen-test-cert.sh 10.0.0.8        # 追加 SAN（IP 或域名，可多个）
#   FORCE=1 scripts/gen-test-cert.sh         # 覆盖已生成的证书
#
# 产物（默认写入 infra/certs-test/，该目录已在 .gitignore 中忽略）：
#   ca.pem         本地 CA 证书（分发到设备信任库用）
#   ca.key         CA 私钥（仅本机保存，不对外分发）
#   fullchain.pem  服务器证书（nginx ssl_certificate）
#   privkey.pem    服务器私钥（nginx ssl_certificate_key，权限 600）

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
OUT_DIR="$REPO_DIR/infra/certs-test"
SERVER_DAYS=825
CA_DAYS=3650

if [ -s "$OUT_DIR/fullchain.pem" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "[gen-test-cert] $OUT_DIR/fullchain.pem 已存在，未覆盖（要重签请用 FORCE=1）" >&2
  exit 0
fi
mkdir -p "$OUT_DIR"

# SAN 列表：localhost + 主机名 + 127.0.0.1 + 本机所有 IPv4，再加命令行追加项
sans="DNS:localhost,DNS:$(hostname),IP:127.0.0.1"
for ip in $(hostname -I 2>/dev/null || true); do
  sans="$sans,IP:$ip"
done
for extra in "$@"; do
  case "$extra" in
    # 形如 x.x.x.x 的按 IP 写入，其余按域名写入
    [0-9]*.[0-9]*.[0-9]*.[0-9]*) sans="$sans,IP:$extra" ;;
    *) sans="$sans,DNS:$extra" ;;
  esac
done

echo "[gen-test-cert] 生成本地 CA…"
openssl req -x509 -newkey rsa:4096 -sha256 -days "$CA_DAYS" -nodes \
  -keyout "$OUT_DIR/ca.key" -out "$OUT_DIR/ca.pem" \
  -subj "/CN=mentor-ai-test-local-ca" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1

echo "[gen-test-cert] 生成服务器证书（SAN: $sans）…"
openssl req -newkey rsa:2048 -sha256 -nodes \
  -keyout "$OUT_DIR/privkey.pem" -out "$OUT_DIR/server.csr" \
  -subj "/CN=mentor-ai-test" >/dev/null 2>&1

openssl x509 -req -in "$OUT_DIR/server.csr" \
  -CA "$OUT_DIR/ca.pem" -CAkey "$OUT_DIR/ca.key" -CAcreateserial \
  -out "$OUT_DIR/fullchain.pem" -days "$SERVER_DAYS" -sha256 \
  -extfile <(printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$sans") >/dev/null 2>&1

rm -f "$OUT_DIR/server.csr" "$OUT_DIR/ca.srl"
chmod 600 "$OUT_DIR/ca.key" "$OUT_DIR/privkey.pem"
chmod 644 "$OUT_DIR/ca.pem" "$OUT_DIR/fullchain.pem"

echo "[gen-test-cert] 完成，文件位于 $OUT_DIR："
ls -1 "$OUT_DIR"
echo
echo "下一步："
echo "  1) 启动/重启测试环境的 HTTPS 入口：docker compose -f docker-compose.test.yml up -d nginx"
echo "  2) 自检：curl -vk --resolve $(hostname):3401:127.0.0.1 https://$(hostname):3401/health/ready"
echo "  3) 要让录音等安全上下文功能可用：把 $OUT_DIR/ca.pem 安装到访问设备的「受信任的根证书颁发机构」。"
