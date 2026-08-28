#!/usr/bin/env bash
# 配置 Docker 使用阿里云专属镜像加速器（root 才会生效）。
# 服务器为阿里云 ECS，控制台分配的专属加速器 k0sdnixc.mirror.aliyuncs.com
# 只有该 ECS 本机/内网可达；从服务器拉取基础镜像走专线，绕开 docker.io 停滞。
# 幂等：已配置则不重复、不重启 docker；仅在真正改动时重启一次。
set -u

MIRROR="https://k0sdnixc.mirror.aliyuncs.com"
DAEMON=/etc/docker/daemon.json

# 仅 root 且已装 docker 才做；否则跳过（无需报错）。
if [ "$(id -u)" != "0" ] || ! command -v docker >/dev/null 2>&1; then
  echo "[setup-mirror] 跳过：需要 root 且已安装 docker"
  exit 0
fi

mkdir -p /etc/docker
CHANGED=0

# python3 优先（Ubuntu 标配），无则回退 jq。
if command -v python3 >/dev/null 2>&1; then
  # 有实际改动时 python 输出 "changed"。用管道 + grep 判定，避免 set -e 误伤。
  if python3 "$MIRROR" "$DAEMON" <<'PY' | grep -q changed
import json, sys
mirror, daemon = sys.argv[1], sys.argv[2]
cfg = {}
try:
    with open(daemon) as f:
        cfg = json.load(f)
except Exception:
    cfg = {}
mirrors = cfg.get("registry-mirrors")
if isinstance(mirrors, list) and mirror in mirrors:
    exit(0)  # 已配置，无改动
if not isinstance(mirrors, list):
    mirrors = []
cfg["registry-mirrors"] = [mirror] + [m for m in mirrors if m != mirror]
with open(daemon, "w") as f:
    json.dump(cfg, f, indent=2)
print("changed")
PY
  then
    CHANGED=1
  fi
elif command -v jq >/dev/null 2>&1; then
  { [ ! -f "$DAEMON" ] || ! jq -e . "$DAEMON" >/dev/null 2>&1; } && echo '{}' > "$DAEMON"
  if ! jq -e --arg m "$MIRROR" '."registry-mirrors" // [] | index($m)' "$DAEMON" >/dev/null 2>&1; then
    jq --arg m "$MIRROR" \
       '."registry-mirrors" = (([$m] + (."registry-mirrors" // [])) | unique)' \
       "$DAEMON" > "$DAEMON.tmp" && mv "$DAEMON.tmp" "$DAEMON"
    CHANGED=1
  fi
else
  echo "[setup-mirror] 跳过：python3/jq 均不可用" >&2
  exit 0
fi

if [ "$CHANGED" = "1" ]; then
  systemctl restart docker || service docker restart || true
  echo "[setup-mirror] 已写入加速器 $MIRROR 并重启 docker"
else
  echo "[setup-mirror] 加速器 $MIRROR 已配置，跳过"
fi
