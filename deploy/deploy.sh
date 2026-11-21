#!/usr/bin/env bash
# 生产部署脚本 —— 由 .github/workflows/deploy.yml 经 SSH 调用，也可在服务器上手工执行。
#
# 为什么放在仓库里而不是内联进 YAML：部署逻辑要能被单独 review，线上排障时能直接
# 重跑一遍，而不是从 Actions 日志里拷一段 shell 出来改（内联版本有 190 行）。
#
# 调用方的前置约定：工作区已对齐到待部署修订（git fetch + reset --hard origin/main）。
# 环境变量：
#   PREV_SHA  部署前的修订，即回滚基线；缺省取当前 HEAD
#   BUNDLE    前端产物 tar.gz（CI 构建，dist/ 的内容在包的根层级）
set -euo pipefail

# 本文件会被 rollback 里的 `git reset --hard` 改写，而 bash 是按偏移增量读脚本的：
# 边执行边被替换会读出半个脚本。先把自己拷到 /tmp 再执行（幂等，只发生一次）。
# 注意这一步在装 trap 之前：cp 失败就干净退出，不会碰线上任何东西。
if [ "${ZYXF_DEPLOY_RELOCATED:-0}" != 1 ]; then
  cp -f "$(readlink -f "$0")" /tmp/zyxf-deploy.sh
  ZYXF_DEPLOY_RELOCATED=1 exec bash /tmp/zyxf-deploy.sh "$@"
fi

REPO=/opt/zyxf
DIST=$REPO/frontend/dist
NGINX_CONF=/etc/nginx/conf.d/zyxf.conf
PREV_SHA=${PREV_SHA:-$(git -C "$REPO" rev-parse HEAD)}
BUNDLE=${BUNDLE:-}

log() { echo "[deploy] $*"; }

# 回滚：任何一步非零退出都退回 PREV_SHA。
# ⚠️ 处理函数里第一件事必须 set +e：回滚自身任何一步失败都不能打断回滚；
#    ROLLED_BACK 保证只回滚一次（健康检查失败会正常退出，由同一个 trap 接管）。
ROLLED_BACK=0
rollback() {
  set +e
  [ "$ROLLED_BACK" = 1 ] && return 0
  ROLLED_BACK=1
  log "ERROR 部署失败（当前 $(git -C "$REPO" rev-parse --short HEAD)），回滚到 ${PREV_SHA:0:7}"
  cd "$REPO" || exit 1
  git reset --hard "$PREV_SHA"
  # 单元文件拷到 /etc/systemd/system 后就脱离了工作区：只 reset 代码会留下「旧代码 + 新 unit」。
  cp "$REPO/deploy/zyxf.service" /etc/systemd/system/zyxf.service 2>/dev/null || true
  systemctl daemon-reload 2>/dev/null || true
  # 回退到的修订可能还没有备份脚本；留着 timer 只会每天静默失败一次。
  [ -f "$REPO/backend/scripts/backup-db.mjs" ] ||
    systemctl disable --now zyxf-backup.timer 2>/dev/null || true
  # 前端产物直接切回上一份：产物来自 CI，服务器上没有第二条构建路径可重建。
  if [ -d "$DIST.prev" ]; then
    chattr -R -i "$DIST.prev" 2>/dev/null || true
    rm -rf "$DIST"
    mv "$DIST.prev" "$DIST"
    log "前端产物已切回上一份"
  else
    log "⚠️ 没有 dist.prev 可回退（这是新流程的首次部署？）"
  fi
  # 回滚路径刻意用 npm install 而不是 npm ci：这里的目标是「把服务恢复回来」，
  # 旧 lockfile 万一与 package.json 有细微不一致，npm ci 会直接失败，把一次可恢复的
  # 发布问题变成「站点起不来」。
  cd "$REPO/backend" && npm install --no-audit --no-fund
  systemctl restart zyxf
  ok=0
  for _ in $(seq 1 10); do
    if curl -fsS --max-time 2 http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 1
  done
  log "回滚后健康检查: $ok"
  journalctl -u zyxf -n 40 --no-pager || true
  log "回滚完成，但本次部署判定为失败"
}
# 末尾必须显式 exit：EXIT trap 的退出码取自最后一条命令，而最后一条是 echo（成功），
# 会把失败掩盖成绿灯。
trap 'code=$?; if [ "$code" -ne 0 ]; then rollback; exit 1; fi; exit 0' EXIT

[ -n "$BUNDLE" ] && [ -s "$BUNDLE" ] || {
  log "缺少前端产物：BUNDLE=${BUNDLE:-<未设置>}"
  exit 1
}

log "部署 $(git -C "$REPO" rev-parse --short HEAD)（回滚基线 ${PREV_SHA:0:7}）"

# 服务器在境内，npmmirror 明显更快。
npm config set registry https://registry.npmmirror.com

# --- 后端依赖：npm ci 按 lockfile 精确安装，不一致时直接失败（那是我们想尽早知道的信号）---
cd "$REPO/backend"
npm ci --no-audit --no-fund

# --- 前端产物：解到 dist.new → 校验 → 两次 rename 换上去 ---
# 正常路径下 dist 任何时刻都是完整的一份，nginx 不会读到半个目录。
NEW=$DIST.new
rm -rf "$NEW"
mkdir -p "$NEW"
tar -xzf "$BUNDLE" -C "$NEW" --no-same-owner
[ -s "$NEW/index.html" ] || { log "产物里没有 index.html"; exit 1; }
[ -d "$NEW/assets" ] || { log "产物里没有 assets/"; exit 1; }
chattr -R -i "$DIST.prev" 2>/dev/null || true
rm -rf "$DIST.prev"
if [ -d "$DIST" ]; then mv "$DIST" "$DIST.prev"; fi
mv "$NEW" "$DIST"
log "前端产物已替换（$(du -sh "$DIST" | cut -f1)）"

# --- systemd 单元 + journald 上限 ---
cp "$REPO/deploy/zyxf.service" /etc/systemd/system/zyxf.service
cp "$REPO/deploy/zyxf-backup.service" /etc/systemd/system/zyxf-backup.service
cp "$REPO/deploy/zyxf-backup.timer" /etc/systemd/system/zyxf-backup.timer
systemctl daemon-reload
# 40 GB 系统盘上日志无上限增长，撑满后 SQLite 写入失败 → 服务直接不可用（issue #93）。
# 用 drop-in 幂等落盘，不改发行版原配置。
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/zyxf.conf
systemctl restart systemd-journald || true
systemctl enable zyxf
systemctl enable --now zyxf-backup.timer

# --- 重启后端 ---
# 先优雅停掉 systemd 旧实例，再清理仍占用 4000 的残留进程（从 nohup/面板时代迁来的
# 历史包袱）。按端口精确定位，避免 `pkill -f` 误杀本脚本自身。
systemctl stop zyxf 2>/dev/null || true
if command -v fuser >/dev/null 2>&1; then
  fuser -k 4000/tcp 2>/dev/null || true
else
  ss -tlnp 2>/dev/null | awk '/:4000 /{match($0, /pid=([0-9]+)/, m); if (m[1]) print m[1]}' |
    sort -u | xargs -r kill 2>/dev/null || true
fi
systemctl start zyxf

# 健康检查：有上限的重试（最多约 15s）。固定 sleep 3 曾把「启动比 3 秒慢」判死、整批
# 回滚（issue #80）。失败时把 systemd 状态与最近日志打出来，省掉靠猜的排障。
ok=0
for _ in $(seq 1 15); do
  if curl -fsS --max-time 2 http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  log "后端 15s 内未通过健康检查"
  systemctl status zyxf --no-pager || true
  journalctl -u zyxf -n 80 --no-pager || true
  exit 1
fi
curl -fsS http://127.0.0.1:4000/api/health
echo

# 每次部署顺手做一次备份，不等 04:17。放在健康检查之后：库是后端启动时才创建的。
# 失败只警告不阻塞——备份不该挡住发布，但每次部署都真的走一遍上传，等于持续验证。
systemctl start zyxf-backup.service || log "⚠️ 备份失败，检查 journalctl -u zyxf-backup"

# --- nginx：以仓库 frontend/nginx.conf 为唯一来源 ---
# 备份文件名用 .bak 而不是 .conf：nginx 只 include *.conf，备份不会被误加载。
if [ -f "$REPO/frontend/nginx.conf" ]; then
  cp "$NGINX_CONF" "$NGINX_CONF.bak" 2>/dev/null || true
  # 安全头 snippet 必须先就位：nginx.conf 的 server 与每个自写 add_header 的 location
  # 都 include 它，缺文件会让 nginx -t 直接失败。
  mkdir -p /etc/nginx/snippets
  cp "$REPO/frontend/security-headers.conf" /etc/nginx/snippets/zyxf-headers.conf
  cp "$REPO/frontend/nginx.conf" "$NGINX_CONF"
  # 语法校验 + reload 后真的能取到首页，两者都过才算成功。不能用后端健康检查代替：
  # 它只打 127.0.0.1:4000，nginx 挂了它照样绿。
  if nginx -t && systemctl reload nginx &&
    curl -fsS --resolve zyxf.top:443:127.0.0.1 https://zyxf.top/ -o /dev/null; then
    log "nginx 配置已同步并 reload"
  else
    log "nginx 配置校验失败或站点取不到首页，已还原上一份配置"
    # 首次部署时没有 .bak：宁可删掉新配置回落到其它 vhost，也不留坏配置。
    cp "$NGINX_CONF.bak" "$NGINX_CONF" 2>/dev/null || rm -f "$NGINX_CONF"
    nginx -t && systemctl reload nginx || true
    exit 1
  fi
fi

rm -f "$BUNDLE"
log "完成"
