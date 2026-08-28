# BUG Backlog

> 用途：给 AI agent 与开发者共同消费的 bug 跟踪清单。
> 机器可读约定：每个条目首行是 `id / severity / status / layer / component`，第二行是 `files`。`status` 用 `- [ ]`（未修）/ `- [x]`（已修）标记，agent 可直接 grep 统计或过滤。恢复记录见文末「状态统计」。
> 更新：修复时把 `- [ ]` 改为 `- [x]`，并在 status 行追加 `closed: yyyy-mm-dd`。

```yaml
updated: 2026-08-28
entries: 20
severity_levels:
  critical: 明确功能错误或崩溃风险，优先修复
  medium:   性能退化或逻辑隐患
  low:      健壮性、规范、边缘 case
```

---

## critical 严重

### BUG-01 上传进度条永远不动，文件卡在「上传中」
`id: BUG-01` · `severity: critical` · `status: - [x] · closed: 2026-08-28` · `layer: frontend` · `component: UploadDialog`
`files: [frontend/src/components/UploadDialog.jsx]`

- **现象**：文件实际上传成功，但进度条始终停在 0，状态一直显示「上传中」。
- **根因**：`setFiles` 更新用 `it === item` 比较原对象引用。第一次 `setFiles` 已把对象替换成新引用（`{...item, status:'uploading'}`），之后每个 `onProgress` 再拿首次捕获的 `item` 比较永远不匹配，`progress`/`status` 不再更新。
- **影响**：仅前端 UI 显示错误，后端数据正确。
- **修法**：进度比较改用稳定的 `item.file` 引用（如 `it.file === item.file`）。
- **验证**：上传一个文件，观察进度条从 0 递增到 100 且状态变为「已完成」。
- **备注**：修复会改变画面行为（进度条开始走动）。当前「不动」反而不符合预期，需确认后改。

### BUG-02 Express 4 异步路由不捕获 Promise 拒绝（后端崩溃风险）
`id: BUG-02` · `severity: critical` · `status: - [x] · closed: 2026-08-28` · `layer: backend` · `component: express-async-handler`
`files: [backend/src/routes/files.js, backend/src/routes/folders.js]`

- **现象**：`PATCH` / 部分 `POST` 处理器为 `async` 但无 try/catch。OSS/DB 调用出错时抛 `unhandledRejection`。
- **根因**：Express 4 不自动 await/catch 异步处理器返回的 Promise；Node ≥ 15 默认对未处理 Promise 拒绝终止进程。
- **影响**：OSS 网络瞬时错误即可让整个后端崩溃、客户端挂起。
- **修法**：封装 `wrap(fn) => (req,res,next) => fn(req,res,next).catch(next)` 套用所有异步处理器，并把 `throw e` 改为 `next(e)`。
- **验证**：模拟一次 OSS 调用失败，确认返回 500 而非进程退出。

### BUG-03 文件名/键含空格时，IMM 预览 token 签名错误
`id: BUG-03` · `severity: critical` · `status: - [x] · closed: 2026-08-28` · `layer: backend` · `component: imm-signature`
`files: [backend/src/imm.js]`

- **现象**：文件名或 `oss_key` 含空格时，IMM 预览 token 生成失败。
- **根因**：`percentEncode` 把空格编码为 `+`，而阿里云 RPC 签名要求 `%20`；同一字符串既用于签名又用于表单体，导致签名不一致。
- **影响**：含空格文件名的 WebOffice 预览不可用。
- **修法**：分离编码器，签名用 `%20`、表单体用 `+`。
- **验证**：需与阿里云联调验证（本机无法运行外部服务确认）。
- **备注**：需联调后再改。

### BUG-19 deploy workflow 使用可变 tag 的第三方 Action（供应链风险）
`id: BUG-19` · `severity: critical` · `status: - [x] · closed: 2026-08-28` · `layer: ci` · `component: deploy-workflow`
`files: [.github/workflows/deploy.yml]`

- **现象**：部署流程使用 `appleboy/ssh-action@v1` 可变 tag。
- **根因**：第三方 Action 未固定到不可变 commit SHA，存在上游 tag 被篡改/重定向风险。
- **影响**：一旦供应链被劫持，攻击者可在 CI 中执行任意代码并窃取部署密钥，进一步接管目标主机。
- **修法**：将第三方 Action 固定为 `@<full_commit_sha>`，并启用依赖机器人定期更新 SHA。
- **验证**：workflow 仍可正常执行，且所有第三方 Action 均为 SHA 固定引用。

---

## medium 中等

### BUG-04 知识图谱每次导航都全量重建并重新布局
`id: BUG-04` · `severity: medium` · `status: - [x] · closed: 2026-08-27` · `layer: frontend` · `component: KnowledgeGraph`
`files: [frontend/src/components/KnowledgeGraph.jsx]`

- **现象**：每次切换文件夹导航时整库重建并重新布局。
- **根因**：`buildGraph(tree, rootFiles)` 在 `currentId` 每次变化时重走整树、重分配节点对象，并重触发 `GraphCanvas` 的 `sim.tick(300)`。
- **影响**：大资料库下切换文件夹卡顿。
- **修法**：把 `buildGraph` 单独 `useMemo`（依赖 `[tree, rootFiles]`），仅 `localSubgraph` 依赖 `currentId`。
- **验证**：切换文件夹时性能不再随全库规模退化（已在 A 类修复处理）。

### BUG-05 快速输入时搜索结果可能被过期响应覆盖
`id: BUG-05` · `severity: medium` · `status: - [x] · closed: 2026-08-27` · `layer: frontend` · `component: SearchBar`
`files: [frontend/src/components/SearchBar.jsx]`

- **现象**：快速输入时搜索结果可能被过期响应覆盖，加载状态闪烁。
- **根因**：`onChange` 有 250ms 防抖但每个请求独立发送，无 AbortController / 序号守卫；慢网络下旧请求响应晚于新请求返回并覆盖 `results`，且 `setLoading(false)` 造成闪烁。
- **影响**：搜索下拉结果偶发错误/竞态。
- **修法**：用 `reqIdRef` 单调计数，响应回来时校验是否仍是最新请求（并加防抖卸载清理）。
- **验证**：快速键入并发大量请求，确认最终展示为最新查询结果（已在 A 类修复处理）。

### BUG-06 批量/树接口 N+1 查询（后端多次往返）
`id: BUG-06` · `severity: medium` · `status: - [x] · closed: 2026-08-28` · `layer: backend` · `component: folders-n+1`
`files: [backend/src/routes/folders.js]`

- **现象**：`collectFolderTree`（约 74–88 行）与 `/tree`（约 164–187 行）每个节点做 2 次数据库查询。
- **根因**：树结构遍历逐节点查询，节点多时请求次数线性膨胀（N+1）。
- **影响**：大目录结构的 move/rename/delete、整树加载变慢。
- **修法**：改为 2 次平铺查询（一次取 folders、一次取 files），在内存中按 parent 分组组树。
- **验证**：用大目录树对比优化前后的查询次数与耗时。

### BUG-07 智能搜索每次输入全库扫描
`id: BUG-07` · `severity: medium` · `status: - [x] · closed: 2026-08-28` · `layer: backend` · `component: searchService`
`files: [backend/src/routes/searchService.js]`

- **现象**：每次查询/每次 AI 工具调用都加载全库 folders+files 再 `buildFolderPaths`。
- **根因**：全库加载未做缓存/增量，查询越频繁耗时越大。
- **影响**：N(文件+目录)×depth 耗时任其放大。
- **修法**：引入缓存或按需加载；单纯 hoist 会改变排名（见 BUG-10）。
- **验证**：高频搜索前后的接口耗时对比。
- **备注**：需权衡排序行为后再处理。

### BUG-08 sync 全量扫描 + 逐行删除
`id: BUG-08` · `severity: medium` · `status: - [x] · closed: 2026-08-28` · `layer: backend` · `component: sync`
`files: [backend/src/routes/sync.js]`

- **现象**：`fixExt` 每个同步周期全表扫描；清理清空对象时逐行 `DELETE`（可能触及 Sqlite 999 参数上限）。
- **根因**：无批量/缓存策略，同步周期随数据量线性增长。
- **影响**：同步周期随数据量增长变慢。
- **修法**：ext 修正改为批量（临时表 + 分组删除）；清理时用临时表缓存匹配段。
- **验证**：对比不同数据量下 sync 的耗时与 DELETE 语句条数。

### BUG-20 /api/chat 允许用户控制上游 baseUrl（SSRF）
`id: BUG-20` · `severity: medium` · `status: - [x] · closed: 2026-08-28` · `layer: backend` · `component: llm-proxy`
`files: [backend/src/routes/chat.js, backend/src/llm.js]`

- **现象**：`/api/chat` 可接收并透传用户提供的 `llm.baseUrl`，后端直接向该地址发起请求。
- **根因**：服务端仅校验协议/长度，未限制 host/IP/网段，也未做上游 allowlist。
- **影响**：可被用于 SSRF（探测/访问内网、回环、链路本地或云元数据地址）。
- **修法**：禁止客户端自定义任意 `baseUrl`，改为服务端固定上游或严格 allowlist，并拦截内网/回环地址。
- **验证**：对内网与元数据地址请求被拒绝；合法上游请求正常返回。

---

## low 轻微

### BUG-09 chat 在响应头已发送后才构建系统 Prompt
`id: BUG-09` · `severity: low` · `status: - [x] · closed: 2026-08-28` · `layer: backend` · `component: chat-stream`
`files: [backend/src/routes/chat.js]`

- **现象**：`res.writeHead(200,...)` 之后才调用会查库的 `buildSystemPrompt()`，且不在内部 try 内。
- **根因**：查库出错时 `next(e)` 在响应头已刷出后执行，Express 报「headers already sent」。
- **影响**：仅在 Prompt 构建期间出错时触发（低概率），正常路径不变。
- **修法**：把 `messages`/`buildSystemPrompt()` 移到 `res.writeHead` 之前，或移入内部 try。
- **验证**：模拟 Prompt 构建查库失败，确认不再出现 headers-already-sent。

### BUG-10 搜索 PATH_PENALTY 与其注释矛盾（排序行为）
`id: BUG-10` · `severity: low` · `status: - [x] · closed: 2026-08-28` · `layer: backend` · `component: searchRanking`
`files: [backend/src/routes/searchService.js]`

- **现象**：`PATH_PENALTY=10` 使路径前缀(90) 排到名称子串(80) 之前，与其注释「name-direct 总是领先」矛盾。
- **根因**：惩罚值设置导致排序与注释意图不一致。
- **影响**：搜索结果相对顺序与注释不符。
- **修法**：调整 PATH_PENALTY 使名称直配在路径命中之上。
- **验证**：对比修复前后同一查询的结果排序。
- **备注**：修复会改变搜索结果排序，属行为变更，需评审确认。

### BUG-11 文件名/路径含 `/` 与 `-` 导致 OSS key 冲突
`id: BUG-11` · `severity: low` · `status: - [x] · closed: 2026-08-28` · `layer: backend` · `component: storagePath`
`files: [backend/src/storagePath.js, backend/src/routes/folders.js]`

- **现象**：文件夹名 `a/b` 与 `a-b` 生成相同 OSS key；`relocateFolderSubtree` 只校验文件 key 不校验占位符 key。
- **根因**：`cleanObjectSegment` 保留空格、把 `/` 映射成 `-`、做 NFC 归一化，导致不同名称归一化后碰撞。
- **影响**：极端命名下两个文件夹在存储上冲突。
- **修法**：拒绝含 `/` 的文件夹名，或写入前校验清理后的 key 唯一。
- **验证**：用例 `a/b` 与 `a-b` 确认不再生成相同 key。

### BUG-12 llm 在已输出文本后仍抛错 / 截断的 tool_call 被当作完整
`id: BUG-12` · `severity: low` · `status: - [x] · closed: 2026-08-28` · `layer: backend` · `component: llm-stream`
`files: [backend/src/llm.js]`

- **现象**：流式中途断连时即便已输出若干文本仍抛错（与注释矛盾）；被截断的 `tool_calls` 被当作完整结果透传。
- **根因**：未跟踪是否已产生输出；`tool_call` JSON 未校验完整性即透传。
- **影响**：AI 助手中途断流的错误提示不准确。
- **修法**：跟踪是否已产生输出；对 `tool_call` 的 JSON 在透传前校验完整。
- **验证**：模拟中途断流，确认不再误报错误、截断 tool_call 被丢弃。

### BUG-13 IMM RPC 请求无超时
`id: BUG-13` · `severity: low` · `status: - [x] · closed: 2026-08-28` · `layer: backend` · `component: imm-rpc`
`files: [backend/src/imm.js]`

- **现象**：`fetch`（约 63–67 行）无超时，外部服务挂起时请求槽与 socket 被长期占用。
- **根因**：无 `AbortSignal` 超时控制。
- **影响**：极端情况下资源泄漏/请求堆积。
- **修法**：加 `AbortSignal.timeout`。
- **验证**：对外部服务断连场景确认请求在超时后释放。
- **备注**：仅改变当前会挂死的场景。

### BUG-14 GROUP BY ext 依赖 SQLite 别名遮蔽（脆弱）
`id: BUG-14` · `severity: low` · `status: - [x] · closed: 2026-08-27` · `layer: backend` · `component: stats-groupby`
`files: [backend/src/routes/stats.js]`

- **现象**：`SELECT ... AS ext ... GROUP BY ext` 依赖 SQLite 别名遮蔽，未来版本或迁移后可能不再成立。
- **根因**：`GROUP BY` 引用 SELECT 别名属于 SQLite 的别名遮蔽行为。
- **影响**：当前正确但脆弱。
- **修法**：改为显式表达式 `GROUP BY COALESCE(NULLIF(LOWER(ext), ''), 'other')`。
- **验证**：运行 stats 用例确认分组结果一致（已在 A 类修复处理）。

### BUG-15 top_downloads 统计在重命名/删除后行不准
`id: BUG-15` · `severity: low` · `status: - [x] · closed: 2026-08-28` · `layer: backend` · `component: stats-top-downloads`
`files: [backend/src/routes/stats.js]`

- **现象**：`GROUP BY dl.file_id, dl.file_name` —— 窗口内文件被重命名出现重复行，文件删除后该行元数据为 null。
- **根因**：按文件名分组，未考虑重命名/删除。
- **影响**：下载排行在某些历史情况下多行/空字段。
- **修法**：改为按 `file_id` 分组（必要时聚合文件名）。
- **验证**：构造重命名/删除场景，确认排行无重复/null 行。
- **备注**：修改分组会改变返回载荷，需评审确认。

### BUG-16 搜索把 parent_id = 0 当作根（死分支）
`id: BUG-16` · `severity: low` · `status: - [x] · closed: 2026-08-28` · `layer: backend` · `component: root-sentinel`
`files: [backend/src/routes/searchService.js, backend/src/routes/folders.js]`

- **现象**：`WHERE parent_id IS NULL OR parent_id = 0`。Schema 用 `NULL` 表示根，`=0` 正常匹配不到任何行；一旦存在历史脏数据 `parent_id=0`，`top_folders` 会漏掉其子树。
- **根因**：用 `=0` 作为根的哨兵值，与 `NULL` 语义不一致。
- **影响**：对真实数据无影响（死代码），对脏数据鲁棒性差。
- **修法**：统一用 `IS NULL`，或写入前把 `0` 归一为 `NULL`。
- **验证**：确认 `parent_id=0` 的脏数据也能被正确统计。

### BUG-17 图标按钮缺 aria-label / type
`id: BUG-17` · `severity: low` · `status: - [x] · closed: 2026-08-28` · `layer: frontend` · `component: accessibility`
`files: [frontend/src/components/UploadDialog.jsx, frontend/src/components/SearchBar.jsx]`

- **现象**：部分 icon-only 按钮未设置 `aria-label` 或未显式 `type="button"`。
- **根因**：纯图标按钮遗漏无障碍/表单属性。
- **影响**：读屏体验与表单防误触提交健壮性欠佳。
- **修法**：对 icon-only 按钮补 `aria-label`，并视需要补 `type="button"`。
- **验证**：用读屏或检查 DOM，确认按钮有可访问名称。

### BUG-18 sizeChip 命名不符合 React 组件约定
`id: BUG-18` · `severity: low` · `status: - [x] · closed: 2026-08-28` · `layer: frontend` · `component: naming`
`files: [frontend/src/pages/BrowsePage.jsx]`

- **现象**：`sizeChip`（约 728 行）小写驼峰命名、返回 JSX，而 React 组件惯例为 PascalCase。
- **根因**：命名未遵循组件约定。
- **影响**：仅代码风格，不影响功能。
- **修法**：重命名为 `SizeChip` 并保持调用一致。
- **验证**：构建与测试通过即可。

---

## 状态统计

| 等级 | 总数 | 未修 | 已修 |
|---|---|---|---|
| critical | 4 | 0 | 4 |
| medium | 6 | 0 | 6 |
| low | 10 | 0 | 10 |
| 合计 | 20 | 0 | 20 |

> 命名约定：`BUG-` + 两位序号，按严重程度分组（非按发现顺序）。修复后把对应 `- [ ]` 改为 `- [x]` 并在 status 行追加 `closed: yyyy-mm-dd`。

---

## 已修复 Bug 归档

> 本清单按编号汇总所有已修复（`closed: 2026-08-28`）的 bug，供回溯查看修复位置与影响范围。

| 编号 | 严重度 | 标题 | 修复位置 | 关闭日期 |
|---|---|---|---|---|
| BUG-01 | critical | 上传进度条永远不动，文件卡在「上传中」 | `frontend/src/components/UploadDialog.jsx` | 2026-08-28 |
| BUG-02 | critical | Express 4 异步路由不捕获 Promise 拒绝（后端崩溃风险） | `backend/src/routes/files.js`, `backend/src/routes/folders.js` | 2026-08-28 |
| BUG-03 | critical | 文件名/键含空格时，IMM 预览 token 签名错误 | `backend/src/imm.js` | 2026-08-28 |
| BUG-04 | medium | 知识图谱每次导航都全量重建并重新布局 | `frontend/src/components/KnowledgeGraph.jsx` | 2026-08-27 |
| BUG-05 | medium | 快速输入时搜索结果可能被过期响应覆盖 | `frontend/src/components/SearchBar.jsx` | 2026-08-27 |
| BUG-06 | medium | 批量/树接口 N+1 查询（后端多次往返） | `backend/src/routes/folders.js` | 2026-08-28 |
| BUG-07 | medium | 智能搜索每次输入全库扫描 | `backend/src/searchService.js` | 2026-08-28 |
| BUG-08 | medium | sync 全量扫描 + 逐行删除 | `backend/src/routes/sync.js` | 2026-08-28 |
| BUG-09 | low | chat 在响应头已发送后才构建系统 Prompt | `backend/src/routes/chat.js` | 2026-08-28 |
| BUG-10 | low | 搜索 PATH_PENALTY 与其注释矛盾（排序行为） | `backend/src/searchService.js` | 2026-08-28 |
| BUG-11 | low | 文件名/路径含 `/` 与 `-` 导致 OSS key 冲突 | `backend/src/routes/folders.js` | 2026-08-28 |
| BUG-12 | low | llm 在已输出文本后仍抛错 / 截断的 tool_call 被当作完整 | `backend/src/llm.js` | 2026-08-28 |
| BUG-13 | low | IMM RPC 请求无超时 | `backend/src/imm.js` | 2026-08-28 |
| BUG-14 | low | GROUP BY ext 依赖 SQLite 别名遮蔽（脆弱） | `backend/src/routes/stats.js` | 2026-08-27 |
| BUG-15 | low | top_downloads 统计在重命名/删除后行不准 | `backend/src/routes/stats.js` | 2026-08-28 |
| BUG-16 | low | 搜索把 parent_id = 0 当作根（死分支） | `backend/src/searchService.js`, `backend/src/routes/folders.js` | 2026-08-28 |
| BUG-17 | low | 图标按钮缺 aria-label / type | `frontend/src/components/UploadDialog.jsx`, `frontend/src/components/SearchBar.jsx` | 2026-08-28 |
| BUG-18 | low | sizeChip 命名不符合 React 组件约定 | `frontend/src/pages/BrowsePage.jsx` | 2026-08-28 |
| BUG-19 | critical | deploy workflow 使用可变 tag 的第三方 Action（供应链风险） | `.github/workflows/deploy.yml` | 2026-08-28 |
| BUG-20 | medium | /api/chat 允许用户控制上游 baseUrl（SSRF） | `backend/src/routes/chat.js`, `backend/src/llm.js` | 2026-08-28 |
