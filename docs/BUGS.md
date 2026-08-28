# BUG Backlog

> 用途：给 AI agent 与开发者共同消费的 bug 跟踪清单。
> 机器可读约定：每个条目首行是 `id / severity / status / layer / component`，第二行是 `files`。`status` 用 `- [ ]`（未修）/ `- [x]`（已修）标记，agent 可直接 grep 统计或过滤。已修复的 bug 从正文移除，汇总见文末「已修复 Bug 归档」。
> 更新：修复时把 `- [ ]` 改为 `- [x]`，并在 status 行追加 `closed: yyyy-mm-dd`；确认后从正文删除并将必要信息记入归档表。

```yaml
updated: 2026-08-28
entries: 20
fixed: 20
pending: 0
severity_levels:
  P0: 明确功能错误或崩溃风险，优先修复
  P1: 性能退化或逻辑隐患
  P2: 健壮性、规范、边缘 case
```

---

## 未修复

> 当前无待修复 bug（全部 20 条已修复并归档，见文末「已修复 Bug 归档」）。

---

## 状态统计

| 等级 | 总数 | 未修 | 已修 |
|---|---|---|---|
| P0 | 4 | 0 | 4 |
| P1 | 6 | 0 | 6 |
| P2 | 10 | 0 | 10 |
| 合计 | 20 | 0 | 20 |

---

## 已修复 Bug 归档

> 本清单按编号汇总所有已修复的 bug，供回溯查看修复位置与影响范围。

| 编号 | 严重度 | 标题 | 修复位置 | 关闭日期 |
|---|---|---|---|---|
| BUG-01 | P0 | 上传进度条永远不动，文件卡在「上传中」 | `frontend/src/components/UploadDialog.jsx` | 2026-08-28 |
| BUG-02 | P0 | Express 4 异步路由不捕获 Promise 拒绝（后端崩溃风险） | `backend/src/routes/files.js`, `backend/src/routes/folders.js` | 2026-08-28 |
| BUG-03 | P0 | 文件名/键含空格时，IMM 预览 token 签名错误 | `backend/src/imm.js` | 2026-08-28 |
| BUG-04 | P1 | 知识图谱每次导航都全量重建并重新布局 | `frontend/src/components/KnowledgeGraph.jsx` | 2026-08-27 |
| BUG-05 | P1 | 快速输入时搜索结果可能被过期响应覆盖 | `frontend/src/components/SearchBar.jsx` | 2026-08-27 |
| BUG-06 | P1 | 批量/树接口 N+1 查询（后端多次往返） | `backend/src/routes/folders.js` | 2026-08-28 |
| BUG-07 | P1 | 智能搜索每次输入全库扫描 | `backend/src/searchService.js` | 2026-08-28 |
| BUG-08 | P1 | sync 全量扫描 + 逐行删除 | `backend/src/routes/sync.js` | 2026-08-28 |
| BUG-09 | P2 | chat 在响应头已发送后才构建系统 Prompt | `backend/src/routes/chat.js` | 2026-08-28 |
| BUG-10 | P2 | 搜索 PATH_PENALTY 与其注释矛盾（排序行为） | `backend/src/searchService.js` | 2026-08-28 |
| BUG-11 | P2 | 文件名/路径含 `/` 与 `-` 导致 OSS key 冲突 | `backend/src/routes/folders.js` | 2026-08-28 |
| BUG-12 | P2 | llm 在已输出文本后仍抛错 / 截断的 tool_call 被当作完整 | `backend/src/llm.js` | 2026-08-28 |
| BUG-13 | P2 | IMM RPC 请求无超时 | `backend/src/imm.js` | 2026-08-28 |
| BUG-14 | P2 | GROUP BY ext 依赖 SQLite 别名遮蔽（脆弱） | `backend/src/routes/stats.js` | 2026-08-27 |
| BUG-15 | P2 | top_downloads 统计在重命名/删除后行不准 | `backend/src/routes/stats.js` | 2026-08-28 |
| BUG-16 | P2 | 搜索把 parent_id = 0 当作根（死分支） | `backend/src/searchService.js`, `backend/src/routes/folders.js` | 2026-08-28 |
| BUG-17 | P2 | 图标按钮缺 aria-label / type | `frontend/src/components/UploadDialog.jsx`, `frontend/src/components/SearchBar.jsx` | 2026-08-28 |
| BUG-18 | P2 | sizeChip 命名不符合 React 组件约定 | `frontend/src/pages/BrowsePage.jsx` | 2026-08-28 |
| BUG-19 | P0 | deploy workflow 使用可变 tag 的第三方 Action（供应链风险） | `.github/workflows/deploy.yml` | 2026-08-28 |
| BUG-20 | P1 | /api/chat 允许用户控制上游 baseUrl（SSRF） | `backend/src/routes/chat.js`, `backend/src/llm.js` | 2026-08-28 |
