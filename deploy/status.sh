#!/usr/bin/env bash
# 一键巡检（只读，不改任何状态）：
#   本地执行：ssh <user>@<server> 'bash -s' < deploy/status.sh
#   或登录服务器后：bash deploy/status.sh
set -u
hr() { printf '\n===== %s =====\n' "$1"; }

hr 系统
uptime
free -h | sed -n '1,2p'
df -h / | sed -n '1p;$p'

hr 'zyxf 服务'
systemctl is-active zyxf
systemctl status zyxf --no-pager -l 2>/dev/null | sed -n '1,6p'

hr '健康检查（本机直连后端 :4000）'
curl -s --max-time 5 http://127.0.0.1:4000/api/health || echo '（无响应）'
echo

hr '后端最近 20 行日志'
journalctl -u zyxf -n 20 --no-pager -o cat 2>/dev/null || true

hr nginx
if command -v nginx >/dev/null 2>&1; then
  nginx -t 2>&1
  systemctl is-active nginx 2>/dev/null || true
else
  echo 'nginx 不在 PATH（宝塔装的话在 /www/server/nginx/sbin/nginx）'
fi

hr '监听端口（22/80/443/4000 之外出现端口要留意）'
ss -tlnp 2>/dev/null | awk 'NR==1 || /:(22|80|443|4000) /'

hr '/opt/zyxf 磁盘占用 Top5'
du -xh --max-depth=1 /opt/zyxf 2>/dev/null | sort -rh | head -5
