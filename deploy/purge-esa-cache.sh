#!/usr/bin/env bash
# 发布后刷新 ESA 边缘缓存。
#
# 为什么需要：`dzhz.zyxf.top` 发布 APK 时是**覆盖写同一个 key**
# （`xjtu-toolbox/apk/latest/app-release.apk`），而边缘会把它缓存起来
# （2026-11-21 实测 age ≈ 3868s，约 1 小时）。不发刷新任务的话，发版后最长
# 一小时内一部分用户点「下载」拿到的还是旧包，且服务器侧完全看不出来。
#
# 用法（发版流水线在上传完 OSS 之后调用）：
#   ESA_SITE_ID=<站点 ID> ./purge-esa-cache.sh \
#     https://dzhz.zyxf.top/xjtu-toolbox/apk/latest/app-release.apk \
#     https://dzhz.zyxf.top/xjtu-toolbox/stable.json
#
# 依赖：`aliyun` CLI 且已配置凭证，需要有 esa:PurgeCaches 权限。
# 站点 ID 见 docs/DEPLOY.md §4.2.2，也可用 `aliyun esa ListSites` 查。
#
# 配额：免费版文件刷新额度 1000 次（`aliyun esa GetPurgeQuota --SiteId <id> --Type file`），
# 一次传多个 URL 仍算 1 个任务，日常发布完全够用。
set -euo pipefail

SITE_ID=${ESA_SITE_ID:-}
if [ -z "$SITE_ID" ]; then
  echo "缺少 ESA_SITE_ID（ESA 站点 ID）" >&2
  exit 2
fi
if [ "$#" -lt 1 ]; then
  echo "用法：$0 <url> [url...]" >&2
  exit 2
fi

# Content 是对象，file 类型要放在 Files 数组里（扁平写法 `--Content.1` 会被
# 以 InvalidContent 拒绝）。URL 里不会有引号和反斜杠，直接拼 JSON 即可，
# 这样脚本不依赖 python。
content='{"Files":['
sep=''
for url in "$@"; do
  content="$content$sep\"$url\""
  sep=','
done
content="$content]}"

out=$(aliyun esa PurgeCaches --SiteId "$SITE_ID" --Type file --Content "$content")

task=$(printf '%s\n' "$out" | sed -n 's/.*"TaskId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
if [ -z "$task" ]; then
  echo "刷新任务提交失败：$out" >&2
  exit 1
fi

echo "已提交刷新任务 TaskId=$task"
# DescribePurgeTasks 没有按 TaskId 过滤的参数，只能按类型/状态/时间窗查最近的任务。
echo "查看进度：aliyun esa DescribePurgeTasks --SiteId $SITE_ID --Type file --PageSize 5"
