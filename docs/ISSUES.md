# 问题与改进追踪（ISSUES）

> 本文件是项目的「待办清单 + 处置档案」：追踪**缺陷**与**改进建议**，并沉淀关键决策依据。

## 阅读与维护约定

- **编号**：`BUG-<n>` 缺陷 · `IMPROVE-<n>` 改进。编号一经分配永不复用，因此**不连续属正常**（如 `BUG-22`、`BUG-28` 为空号）。
- **状态流转**：新条目先进「[1. 待处理](#1-待处理)」；处理完成后移入「[2. 已归档](#2-已归档)」并补记关闭日期。
- **处置要点列**：归档表的 `处置要点` 列与条目**同行**保存「为什么这样做 / 怎么验证」（设计取舍、踩坑、跨条目教训），不再另设按主题的章节；无额外说明的条目填 `—`。
- **条目字段**：缺陷 = 现象 / 根因 / 影响 / 修法 / 验证；改进 = 现状 / 根因 / 影响 / 建议 / 验证。条目首行是分类（`layer · component`），次行是受影响文件。
- **严重度**：`P0` 功能错误或崩溃风险 · `P1` 性能退化或逻辑隐患 · `P2` 健壮性 / 规范 / 边缘 case / 轻微改进。

## 当前进度

```yaml
updated: 2026-09-11
entries: 108          # 缺陷 78 + 改进 30
pending: 23           # 缺陷 11 + 改进 12
fixed: 85             # 已归档：缺陷 67 + 改进 18
```

---

## 1. 待处理

### 1.1 缺陷

当前 **11 条待处理**（均为 2026-09-11 全仓审计新发现，已逐条人工复核；历史批次 BUG-21/23/24/26/27/29 已处置）。

> 审计方式：9 路并行只读审计（安全/后端正确性/后端基础设施/性能/前端状态/前端组件/重复与死代码/工程配置与文档），再由人工逐条读码复核、剔除误报。下文每条都给出可核对的文件与行号证据。

#### BUG-54 · `PATCH /api/folders/:id` 的环校验与写库之间隔了 OSS 往返：并发可写入 parent 环
`backend · 文件夹`
`files: [backend/src/routes/folders.js]`

- **现状**：改名/移动路径是「检查重名 → `await relocateFolderSubtree(...)`（内部逐对象 `copyOssObject`）→ UPDATE」，检查与写入不在同一事务内，中间有真实网络往返；`isUniqueError` 兜底对根目录 `parent_id IS NULL` 不生效（SQLite 中 NULL 互不相等）。
- **影响**：两个并发请求都能通过检查后各自提交，可产生同父级同名文件夹；更严重的是把 A 移进自己的后代形成 parent 环——该子树从此不可达（`/folders/tree` 递归不到），且反向遍历也可能异常。
- **修法**：把「祖先链校验 + 唯一性检查 + UPDATE」放进同一个 `transaction()`（`BEGIN IMMEDIATE`）内，OSS 复制挪到事务之后；并补根级部分唯一索引（见 IMPROVE-18 同类问题）。
- **验证**：用例「并发两次移动到同一目标 → 后者 409」「移动到自己的子孙 → 400」。

#### BUG-55 · 文件夹改名/移动的 OSS 复制无补偿：孤儿对象会被下一次 sync 当成新文件导入
`backend · 文件夹`
`files: [backend/src/routes/folders.js, backend/src/routes/sync.js]`

- **现状**：`relocateFolderSubtree` 先批量 `copyOssObject` 到新 key，再更新 DB，最后删旧对象；若在「复制完成、事务未提交」之间失败（或进程被杀），新 key 已成孤兒而 DB 仍是旧 key。
- **影响**：这些孤儿对象在下次 sync 时会被当作「桶里有、库里没有」的新文件导入，于是同一份资料在库里出现两条记录（不同路径），学生看到重复条目、下载统计被拆散。
- **修法**：至少把「复制 → DB 更新 → 删旧」的顺序在失败路径上记录待清理键（或先写一张 `pending_moves` 表再逐步推进）；短期可在 sync 导入前对比 `oss_key` 的同名同大小文件并跳过。
- **验证**：用例「复制成功后事务失败 → 不留重复导入」。

#### BUG-57 · 仪表盘切换时间区间时过期响应覆盖新区间统计
`frontend · 仪表盘`
`files: [frontend/src/pages/DashboardPage.jsx]`

- **现状**：`load = useCallback((silent=false, r=range) => { getStats(r).then(...) }, [range])`，effect 依赖 `[load, range]`，无请求序号；两个 `finally` 都会 `setLoading(false)`。
- **影响**：连点「7 天 → 30 天」时若 7 天的响应后到，卡片数据被 7 天覆盖而切换器高亮 30 天，分析页给出错误结论；刷新中的 loading 也会被先到的响应提前复位。
- **修法**：同 BUG-56 的 `reqIdRef` 守卫。
- **验证**：`Dashboard.test.jsx` 增一例「慢响应后到不得覆盖」。

#### BUG-58 · 设置里保存 AI 配置后，ChatComposer 仍用挂载时读到的旧配置
`frontend · 智能对话`
`files: [frontend/src/components/ChatComposer.jsx, frontend/src/components/SettingsModal.jsx]`

- **现状**：`ChatComposer` 用 `useState(loadLlmCfg)` 只在挂载时读一次 localStorage，`SettingsModal` 保存时只写 localStorage 与自己的 state，全仓没有 storage 事件或 context 通知；而 ChatComposer 在右栏常驻不卸载。
- **影响**：用户填好自带 Key 后直接提问，仍按旧配置发送（或 `hasClientCfg` 为假、干脆不带 `llm`），后端回「AI 功能未配置」/401，必须切页重挂载才生效。
- **修法**：保存后 `dispatchEvent(new Event('llm-config-changed'))`，ChatComposer 监听后 `setLlmCfg(loadLlmCfg())`。
- **验证**：`ChatComposer.test.jsx` 增一例「保存事件后新配置随请求下发」。

#### BUG-59 · StaggeredMenu 的 `busyRef` 被 kill 的补间永久锁死，之后菜单打不开
`frontend · 导航菜单`
`files: [frontend/src/components/StaggeredMenu.jsx]`

- **现状**：`playOpen` 用 `busyRef.current` 做门闩，只在 open 时间线的 `onComplete` 里解锁；而 `playClose` 会 `openTlRef.current?.kill()`，被 kill 的时间线不会触发 `onComplete`，close 分支又没有兜底清零。
- **影响**：在打开动画期间点关闭（或点遮罩、动画刚开始就 closeMenu），之后所有 open/toggle 直接 return——菜单再也打不开，只能刷新页面。
- **修法**：`playClose` 入口与 `playOpen` 的早退分支都清零 `busyRef`，或改用时序无关的代际计数。
- **验证**：`StaggeredMenu.test.jsx` 增一例「开→立即关→再开，菜单可见」。

#### BUG-60 · OfficeViewer 的 SDK 加载失败被模块级 Promise 永久缓存，本次会话无法恢复
`frontend · 预览`
`files: [frontend/src/components/Preview/OfficeViewer.jsx]`

- **现状**：模块级 `let sdkPromise = null` 在 `onerror` 时 `reject`，失败后该 Promise 永久保持 rejected；对「页面里已存在但已 load/error 过」的 script 标签重新 `addEventListener` 也不会再 settle。
- **影响**：一次 CDN 抖动/断网（哪怕随后恢复）之后，本次会话所有 Office 预览都直接落到「预览服务出错」，只有整页刷新才能恢复。
- **修法**：`catch` 里把 `sdkPromise = null` 并移除失败的 script 标签，同时给加载加超时兜底。
- **验证**：用例「首次加载失败 → 重试成功渲染 WebOffice」。

#### BUG-61 · 对话流式请求在「清空会话 / 组件卸载」时不中止，且清空后输入被锁死
`frontend · 智能对话`
`files: [frontend/src/components/ChatComposer.jsx]`

- **现状**：清空按钮只 `setMessages([])` 不 abort；`abortRef` 仅在 `send()` 内赋值，唯一的 effect 清理只处理 `snapTimer`；`busy` 要到流结束才复位。
- **影响**：流式回答期间点清空，垃圾桶与发送键双双禁用、用户没有任何中止入口（最长到 90 s 超时）；同时 SSE 仍在消费，`onDelta` 对已不存在的消息反复 setMessages；「停止」之后若缓冲里还有已到达的 delta，会继续在「已停止」文案后追加文本。
- **修法**：清空与卸载都先 `abortRef.current?.abort()`；补 `useEffect(() => () => abortRef.current?.abort(), [])`。
- **验证**：`ChatComposer.test.jsx` 增两例「清空即中止」「卸载即中止」。

#### BUG-64 · 打开全库知识图谱后组件卸载，`graphFull` 不复位 → 悬浮菜单永久消失
`frontend · 知识图谱 / 导航`
`files: [frontend/src/components/KnowledgeGraph.jsx, frontend/src/App.jsx]`

- **现状**：`KnowledgeGraph` 只在 `dialog` 变化时上报 `onFullChange(!!dialog)`，卸载时没有复位；而 App 用 `{!graphFull && <StaggeredMenu/>}`，知识图谱外层条件是 `isBrowse && isLg`（`min-width:1024px`）。
- **影响**：打开全库图谱后把窗口缩到 <1024px（或旋转设备），组件卸载但 `graphFull` 恒为 true，悬浮菜单不再渲染——用户失去站内导航入口，只能手动刷新。
- **修法**：补卸载清理 `useEffect(() => () => onFullChange?.(false), [])`。
- **验证**：`App.test.jsx`/新增用例「图谱组件卸载后菜单重新可见」。

#### BUG-66 · 文件/文件夹行只能鼠标操作，键盘完全不可达
`frontend · 浏览页 · 可访问性`
`files: [frontend/src/pages/Browse/ItemList.jsx]`

- **现状**：行是 `<li draggable onClick>`，没有 `role`/`tabIndex`/`onKeyDown`；进入文件夹、预览文件、重命名、删除都只能点击（同项目 `FolderTree` 的 chevron 已有 role/tabIndex/onKeyDown，标准不一致）。
- **影响**：键盘与读屏用户无法浏览或管理资料库，列表整体不可访问。
- **修法**：行内主操作改为 `<button>`（拖拽手柄单独承担 DnD），或补 `tabIndex=0` + Enter/Space 处理。
- **验证**：`BrowsePage.test.jsx` 增一例「Tab 到行后 Enter 进入文件夹」。

#### BUG-67 · 知识图谱的 d3 模拟停掉后 `tick` 监听未解绑，卸载后仍触发 setState
`frontend · 知识图谱`
`files: [frontend/src/components/KnowledgeGraph.jsx]`

- **现状**：`sim.on('tick', () => setTick(t => t + 1))`，清理里只 `sim.stop()`，没有 `sim.on('tick', null)`；GraphCanvas 在右栏与弹窗各挂一份并共享节点对象，宽度变化会重建 simulation。
- **影响**：节点集每次变化都残留一个 tick 闭包并持续触发无意义渲染；全库视图下逐帧成本明显。
- **修法**：清理里补 `sim.on('tick', null)`。
- **验证**：用例「切换节点集后旧 tick 不再触发」。

#### BUG-79 · `deploy/zyxf.service` 以 `User=www` 运行，但文档没有任何目录属主/权限步骤
`工程·部署`
`files: [deploy/zyxf.service, docs/DEPLOY.md, backend/src/db.js]`

- **现状**：`zyxf.service` 用 `User=www` 且 `WorkingDirectory=/opt/zyxf/backend`，而 `db.js` 要在该工作目录创建/写 `data.db`；`DEPLOY.md` 只说「把项目上传到 `/opt/zyxf`」，全篇没有 `chown`/权限校验步骤。
- **影响**：新机首次部署时若以 root 上传且目录对 `www` 不可写，SQLite 打开失败 → 服务启动即退出 → 线上 502，而文档里没有任何线索指向这个原因（confidence=low：无法在本机验证服务器实际属主）。
- **修法**：`DEPLOY.md` 增加 `chown -R www:www /opt/zyxf`，并在部署清单里加一条「用 `sudo -u www test -w /opt/zyxf/backend` 验证可写」的前置检查。
- **验证**：按新步骤在干净机器上部署一次，确认 `systemctl status zyxf` 为 active。

---

### 1.2 改进建议

当前**无待处理改进建议**——IMPROVE-01/02/10 已全部处置（见 [2.2 已关闭改进项](#22-已关闭改进项18)）；本轮审计新发现的 12 条改进项见下。

#### IMPROVE-13 · sync 的 `ensureFolderChain` 残留 N+1：每个对象、每一层都重查父级全部兄弟
`backend · 性能`
`files: [backend/src/routes/sync.js]`

- **现状**：`findFolderBySegment` 每次 `SELECT id, name FROM folders WHERE parent_id = ?` 拉出全部兄弟再线性比对（含 NFC 归一化 + 正则替换），而它在每个 OSS 对象、每层路径上各调用一次（导入路径两处），循环中 folders 表还在变长。BUG-08 只优化了删除/剪枝段。
- **影响**：复杂度 O(对象数 × 深度 × 兄弟数)——5000 对象 × 3 层 × 20 兄弟 ≈ 1.5 万次查询 + 30 万次归一化；游客配额（2 次/分钟）即可触发，单次 sync 阻塞事件循环数秒。
- **修法**：循环外一次性加载 folders，按 `parent_id + cleanObjectSegment(name)` 建内存索引，链的查找与新建都在内存完成（与同文件已有的 `buildFolderIndex` 用法一致）。
- **验证**：`syncBatch.test.js` 增一例 500+ 对象的同步耗时与正确性。

#### IMPROVE-15 · `GET /folders/tree` 每次全量重建整库树，且前端每次变更请求两遍
`backend · 性能` / `frontend · 重复`
`files: [backend/src/routes/folders.js, frontend/src/hooks/useFolderTree.js]`

- **现状**：接口每次两条无 WHERE 的全表 SELECT，再在内存递归建整棵树（响应含全库每个文件），无缓存/ETag；前端 `useFolderTree` 被侧边栏 `FolderTree` 与 `KnowledgeGraph` 各实例化一次，各自 `load()` 并各自监听 `folders-changed`，同一变更发两次完全相同的请求（hook 注释自述「原来各自实现了一遍…」，但去重并未真正生效）。
- **影响**：每次进站、每次上传/删除/拖拽排序都在事件循环上重建全库 JSON，且翻倍；大库时首屏明显变慢。
- **修法**：接口侧复用 `searchService` 的全库快照缓存或加 ETag；前端把 tree 提升为模块级共享缓存/Provider（SWR 式）。
- **验证**：断言同一变更只发一次请求（可用请求计数 mock）。

#### IMPROVE-16 · 登录/注册用 bcryptjs 同步哈希，单次独占事件循环 40–50 ms
`backend · 性能`
`files: [backend/src/routes/auth.js, backend/package.json]`

- **现状**：`bcrypt.compareSync` / `bcrypt.hashSync`（纯 JS 实现），实测 `hashSync(10)` ≈47 ms、`compareSync` ≈42 ms。
- **影响**：每次登录/注册期间所有并发 API（health、下载、搜索）一并延迟；限流按 IP 10 次/15 分钟，多出口可叠加放大。
- **修法**：改用 `await bcrypt.compare/hash`（bcryptjs 提供 Promise 版）或换原生 bcrypt/argon2 异步实现。
- **验证**：登录用例全绿；并发压测下 health 延迟不再随登录抖动。

#### IMPROVE-17 · 文件夹改名/移动要逐个搬运整棵子树的 OSS 对象，无规模阈值
`backend · 性能`
`files: [backend/src/routes/folders.js]`

- **现状**：`relocateFolderSubtree` 取整棵子树后对每个文件 `copy` → 再逐个 `delete`，并发固定 10（`batchOss`）。
- **影响**：含 1000 个文件的文件夹改名 ≈ 400 次串行网络往返，请求易超 nginx 默认 60 s 超时；若在 copy 完成、DB 事务提交前中断，OSS 留下新键孤儿对象，之后被 sync 导入成重复条目（与 BUG-55 同源）。
- **修法**：设定子树规模阈值（超限返回 409 并提示改批量/后台任务），或改为后台迁移任务并落库迁移状态。
- **验证**：用例「超过阈值的子树改名返回 409」。

#### IMPROVE-18 · `storagePath.js` 同一套 OSS key 规则维护了两份实现（DB 版与 Map 版）
`backend · 重复逻辑`
`files: [backend/src/storagePath.js, backend/src/routes/files.js, backend/src/routes/folders.js]`

- **现状**：`folderPathSegments` 与 `folderPathSegmentsFromMap` 逐行等价、只差父级取法；`objectKeyForFile` / `placeholderKeyForFolder` 同样各有一个 `*FromMap` 孪生，两组都在生产路径上被调用。
- **影响**：改 key 规则（前缀、分隔、去重）只改一侧，上传落库的 key 与移动/改名算出的 key 就会不一致，`copyOssObject` 目标错位，产生重复对象或莫名 409。
- **修法**：只保留 Map 版，DB 版降级成 `folderPathSegmentsFromMap(id, loadFolderMap(db))` 的薄封装。
- **验证**：现有 `storagePath.test.js` 全绿（该文件已覆盖两组函数）。

#### IMPROVE-19 · 前端扩展名分类表有三份硬编码副本，后端白名单是第四份
`frontend · 重复逻辑`
`files: [frontend/src/utils.js, frontend/src/components/FileIcon.jsx, frontend/src/components/Chat/parts.jsx, backend/src/extPolicy.js]`

- **现状**：`utils.js` 的 `OFFICE_EXT`/`ARCHIVE_EXT` 手抄自后端白名单（注释自认 "mirrors backend extPolicy.js"），`FileIcon.jsx` 另有 `EXT_MAP`，`Chat/parts.jsx` 还有 `EXT_TONE`，四张表互不派生。
- **影响**：后端白名单一加类型（xltx/et/wps/ppsx 等），前端 `getPreviewKind` 判为 unknown → 预览退化成「只能下载」，图标与徽章也退成默认色——后端本可签发 WebOffice token。BUG-23 就是其中一次漂移。
- **修法**：由后端下发一份 ext→类别 映射，或构建期由 `extPolicy.js` 生成前端常量，三处共用。
- **验证**：`utils.test.js` 断言前端分类与后端白名单一致（可加脚本化对比）。

#### IMPROVE-20 · `/api/search` 每类截断 20 条，前端却把它当总数展示
`frontend · 契约`
`files: [backend/src/searchService.js, backend/src/routes/search.js, frontend/src/components/SearchBar.jsx]`

- **现状**：`searchLibrary(q, { limit = 20 })` 对 folders/files 各自 `slice(0, limit)`，路由未回传命中总数；前端用两者长度之和渲染 `search.resultsCount`。实测命中超过 20 时界面写死「20 个结果」。
- **影响**：用户以为只有 20 条匹配而漏掉资料（与 BUG-24 同类的截断契约问题）。
- **修法**：接口回传 `total` 或在被截断时带 `truncated`，前端显示「显示 20 / 共 N 条」。
- **验证**：`SearchBar` 用例断言截断提示。

#### IMPROVE-22 · `api.js` 注释仍描述已被 IMPROVE-03 替换掉的同步限流口径
`frontend · 文档`
`files: [frontend/src/api.js, backend/src/limiter.js, backend/src/routes/sync.js]`

- **现状**：`syncOss()` 上方注释写 "Rate-limited server-side to 5/min per IP"，实际是 `tieredLimiter`：游客 2 次/分钟（按 IP）、登录用户 5 次/分钟（按 `u:${user.id}`）、管理员豁免。
- **影响**：前后端评审据此把「5 次/分钟·按 IP」当契约，会误判滥用面（游客实际只有 2 次，登录用户还不占 IP 配额）。
- **修法**：注释改为分层口径描述。
- **验证**：纯注释改动，跑测试即可。

#### IMPROVE-23 · `gsap` 以静态导入常驻首屏（菜单动画本可惰性加载）
`frontend · 性能`
`files: [frontend/src/components/StaggeredMenu.jsx, frontend/vite.config.js]`

- **现状**：`StaggeredMenu` 在 App 层常驻，其 `import { gsap } from 'gsap'` 是模块级静态导入；vite 还把 gsap 与 framer-motion 合并进同一个 `motion` chunk。
- **影响**：只想打开菜单也必须先下载整个 GSAP 运行时；懒加载路由（AboutPage 用 framer-motion）会连带拉 gsap 分包。BUG-21 已做路由级切分，但这条路径仍在首屏链上。
- **修法**：首次开合时 `await import('gsap')`；并把 gsap 从 `motion` chunk 拆出单独 chunk。
- **验证**：`vite build` 产物中首屏 chunk 不再包含 gsap。

#### IMPROVE-24 · `useFolderTree` 的文档承诺与实现不符（去重未生效）
`frontend · 重复`
`files: [frontend/src/hooks/useFolderTree.js, frontend/src/components/FolderTree.jsx, frontend/src/components/KnowledgeGraph.jsx]`

- **现状**：hook 注释声称「原来各自实现了一遍 fetch + alive 守卫 + 事件监听，同一变更会触发两次相同的 GET」是它要解决的问题，但实现只是把重复代码搬进 hook——两处各挂一次实例、各自监听，重复请求依旧。
- **影响**：同一变更仍发两次 `/api/folders/tree`（大库时翻倍开销），注释还会误导后续维护者以为已优化。
- **修法**：模块级共享缓存/Provider（与 IMPROVE-15 同一改动）。
- **验证**：请求计数断言只发一次。

#### IMPROVE-25 · 零引用导出与未使用解构（`useLocale().title`、`App.jsx` 的 `locale`、`imm.js` 的 `immProject`）
`frontend · 冗余`
`files: [frontend/src/hooks/useLocale.js, frontend/src/App.jsx, backend/src/imm.js]`

- **现状**：`useLocale()` 返回的 `title` 全仓无人读取（`document.title` 在 App.jsx 里另设），`const { locale } = useLocale()` 解构后未使用，`immProject` 导出也仅模块内自用。
- **影响**：死接口会让人误以为「改 title 就能改页面标题」，实际无效。
- **修法**：删除零引用导出与未使用解构，或把 `document.title` 改为消费 `title`。
- **验证**：lint/测试通过。

#### IMPROVE-26 · sync 只回收「死根子树」，挂在活根下的空文件夹永不剪枝（**暂缓，改动有破坏性风险**）
`backend · 同步`
`files: [backend/src/routes/sync.js]`

- **现状**：剪枝循环只遍历 `parent_id IS NULL` 的根，对活根调用 `folderAlive` 时不会把其中「已死」的子文件夹收进待删集合，于是这类空文件夹会一直留在库里（与函数文档自述的 "prunes folders that are empty" 不符）。
- **影响**：库内会缓慢积累空文件夹，侧边栏出现点进去什么都没有的节点。
- **修法（暂缓原因）**：改成逐节点剪枝会带来**破坏性风险**——凡是没有 placeholder 对象又没有文件的文件夹都会被删，而历史上存在「建库时未写 placeholder」的部署会因此被整体清空。故先只记录：需要先核对线上 placeholder 覆盖率，再决定是否放开，或改为「仅当该文件夹已存在超过 N 天时剪枝」。
- **验证**：若实施，需先加干跑（只统计不删除）观察一轮同步结果。

---

## 2. 已归档

> **类别**列为便于按区域速查的单一归类；`处置要点` 列记录该项的修法依据、踩坑与验证方式，无额外说明的填 `—`。

### 2.1 已修复缺陷（67）

| 编号 | 严重度 | 类别 | 标题 | 修复位置 | 关闭日期 | 处置要点 |
|---|---|---|---|---|---|---|
| BUG-01 | P0 | 前端 | 上传进度条永远不动，文件卡在「上传中」 | `frontend/src/components/UploadDialog.jsx` | 2026-08-28 | — |
| BUG-02 | P0 | 后端 | Express 4 异步路由不捕获 Promise 拒绝（后端崩溃风险） | `backend/src/routes/files.js`, `backend/src/routes/folders.js` | 2026-08-28 | — |
| BUG-03 | P0 | 后端 | 文件名/键含空格时，IMM 预览 token 签名错误 | `backend/src/imm.js` | 2026-08-28 | — |
| BUG-04 | P1 | 前端 | 知识图谱每次导航都全量重建并重新布局 | `frontend/src/components/KnowledgeGraph.jsx` | 2026-08-27 | — |
| BUG-05 | P1 | 前端 | 快速输入时搜索结果可能被过期响应覆盖 | `frontend/src/components/SearchBar.jsx` | 2026-08-27 | — |
| BUG-06 | P1 | 后端 | 批量/树接口 N+1 查询（后端多次往返） | `backend/src/routes/folders.js` | 2026-08-28 | — |
| BUG-07 | P1 | 后端 | 智能搜索每次输入全库扫描 | `backend/src/searchService.js` | 2026-08-28 | — |
| BUG-08 | P1 | 后端 | sync 全量扫描 + 逐行删除 | `backend/src/routes/sync.js` | 2026-08-28 | — |
| BUG-09 | P2 | 后端 | chat 在响应头已发送后才构建系统 Prompt | `backend/src/routes/chat.js` | 2026-08-28 | — |
| BUG-10 | P2 | 后端 | 搜索 PATH_PENALTY 与其注释矛盾（排序行为） | `backend/src/searchService.js` | 2026-08-28 | — |
| BUG-11 | P2 | 后端 | 文件名/路径含 `/` 与 `-` 导致 OSS key 冲突 | `backend/src/routes/folders.js` | 2026-08-28 | — |
| BUG-12 | P2 | 后端 | llm 在已输出文本后仍抛错 / 截断的 tool_call 被当作完整 | `backend/src/llm.js` | 2026-08-28 | — |
| BUG-13 | P2 | 后端 | IMM RPC 请求无超时 | `backend/src/imm.js` | 2026-08-28 | — |
| BUG-14 | P2 | 后端 | GROUP BY ext 依赖 SQLite 别名遮蔽（脆弱） | `backend/src/routes/stats.js` | 2026-08-27 | — |
| BUG-15 | P2 | 后端 | top_downloads 统计在重命名/删除后行不准 | `backend/src/routes/stats.js` | 2026-08-28 | — |
| BUG-16 | P2 | 后端 | 搜索把 parent_id = 0 当作根（死分支） | `backend/src/searchService.js`, `backend/src/routes/folders.js` | 2026-08-28 | — |
| BUG-17 | P2 | 前端 | 图标按钮缺 aria-label / type | `frontend/src/components/UploadDialog.jsx`, `frontend/src/components/SearchBar.jsx` | 2026-08-28 | — |
| BUG-18 | P2 | 前端 | sizeChip 命名不符合 React 组件约定 | `frontend/src/pages/BrowsePage.jsx` | 2026-08-28 | — |
| BUG-19 | P0 | 工程·CI | deploy workflow 使用可变 tag 的第三方 Action（供应链风险） | `.github/workflows/deploy.yml` | 2026-08-28 | 结论是**第三方 Action 一律固定 commit SHA**，`deploy.yml` 照此执行；同口径推广到 `ci.yml` 见 IMPROVE-08（含升级时重新解析 SHA 的方法）。 |
| BUG-20 | P1 | 安全 | /api/chat 允许用户控制上游 baseUrl（SSRF） | `backend/src/routes/chat.js`, `backend/src/llm.js` | 2026-08-28 | — |
| BUG-25 | P2 | 前端 | 前端使用未配置的 slate-700 色阶 | `frontend/tailwind.config.js` | 2026-08-30 | — |
| BUG-30 | P2 | 后端 | 扩展名策略注释引用已不存在的实现 | `backend/src/extPolicy.js` | 2026-08-30 | — |
| BUG-31 | P2 | 前端 | Primary Dark CTA 的 CSS 注释与实际圆角不一致 | `frontend/src/index.css` | 2026-08-30 | — |
| BUG-32 | P1 | 安全 | 同步接口缺 admin 权限校验，匿名可触发库级改写 | `backend/src/routes/sync.js` | 2026-09-09 | 当时以「`/api/sync` 挂 `requireAdmin`」关闭匿名改写风险，但浏览页「刷新」按钮对所有人可见，收紧后游客/普通用户点击必然 401/403，**权限呈现与 UI 不一致**；产品决策随后改为放开并交由分层限流约束（补偿性控制，见 IMPROVE-03）。 |
| BUG-33 | P1 | 安全 | 生产环境 CORS 默认全开放（`origin: '*'`） | `backend/src/index.js` | 2026-09-09 | — |
| BUG-34 | P2 | 安全 | 改 `ADMIN_PASSWORD` 后旧密码仍可登录（`ensureAdmin` 不更新已存在用户） | `backend/src/db.js` | 2026-09-10 | — |
| BUG-35 | P2 | 安全 | `qs` override 锁在漏洞版本（6.15.3 恰为漏洞区间上界），CI 每轮带 DoS 漏洞 | `backend/package.json`, `backend/package-lock.json` | 2026-09-10 | `package.json` 的 `overrides.qs` 曾为 `^6.15.3`，而漏洞区间恰为 `2.2.5 – 6.15.3`（6.15.3 是**上界**），等于没修；CI 用 `npm ci` 严格按 lockfile 安装，故每轮都带该 DoS 漏洞（`GHSA-x5fp-wj9c-mxmx`/`GHSA-4mjr-xmp4-gh2g`）。处置：override 改 `^6.16.0` 并更新 lockfile，`npm audit` 归零。 |
| BUG-36 | P1 | 安全 | 后端绑 `0.0.0.0`，伪造 `X-Forwarded-For` 可绕过全部限流（含登录爆破） | `backend/src/index.js` | 2026-09-10 | 后端 `app.listen(PORT)` 默认绑 `0.0.0.0`，而 `app.set('trust proxy', 1)` 信任 `X-Forwarded-For`。实测证实：同一来源伪造不同 XFF 可任意重置限流桶（游客配额打满后换个伪造 IP 立即恢复 200），登录爆破/下载/同步限流全部可绕。生产本可依赖 nginx 覆盖 XFF + 安全组不放开 4000，但那是单层防御。处置：后端默认绑 `127.0.0.1`（`HOST` 可覆盖为 `0.0.0.0`）。后端始终在 nginx/Vite 代理之后，本地开发经 Vite `/api` 代理访问不受影响。 |
| BUG-37 | P1 | 安全 | `.env` 的 `DM_ACCESS_KEY_ID` 单字符错误，注册发信功能实际不可用 | `.env`（云端 RAM `zyxf-mail` 新密钥） | 2026-09-10 | 审计中发现：`.env` 的 `DM_ACCESS_KEY_ID` 与 `zyxf-mail` 真实值仅差**第 23 位**一个字符，且 secret 也已被替换过，导致注册验证码功能实际不可用（返回 `InvalidAccessKeyId.NotFound`）。处置：新建 AccessKey（旧 key 保留以免影响生产），先验证「越权被拒 + 发信放行」双条件，通过后才写入 `.env`。📌 **同源教训**：OSS 与 DirectMail 各发生一次「凭证复制后未经验证直接落库」（前者差第 14 位、后者差第 23 位）——**凭证写入 `.env` 前必须先用只读调用验证**（OSS 用 `list`，DM 用 `SingleSendMail` 无效地址，看是否返回权限错误）。 |
| BUG-21 | P2 | 前端 | 前端生产 JS 单块过大，缺少路由级代码分割 | `frontend/src/App.jsx`, `frontend/vite.config.js` | 2026-09-10 | — |
| BUG-23 | P2 | 前端 | 前后端宏格式扩展名策略不一致 | `frontend/src/utils.js`（已对齐后端白名单，b549a73 已修） | 2026-09-10 | — |
| BUG-24 | P2 | 后端 | 统计面板未展示类型数量被低估（截断与 UI 展示契约不一致） | `backend/src/routes/stats.js`, `frontend/src/pages/DashboardPage.jsx` | 2026-09-10 | 后端 `type_breakdown` 截断为 8 类，前端却用「返回长度 − 6」算其余，超 8 类时低估。修法：让接口返回真实总数 `type_total`，前端据此计算。**同源教训**：同一契约在两处各维护一份就会漂移（BUG-24/BUG-26 各发生一次），派生值必须只留一个权威来源。 |
| BUG-26 | P2 | 后端 | 文件 MIME 元数据与扩展名派生值不一致 | `backend/src/routes/files.js`, `backend/src/routes/sync.js`, `frontend/src/api.js` | 2026-09-10 | MIME 有两个来源（浏览器 `file.type` 落库、响应按扩展名派生），且落库值从不被读取。修法：**以扩展名派生为唯一权威**——上传注册与 sync 导入都写 `mimeOf(ext)`，前端不再上报 `mime_type`。**同源教训**：契约两处维护就会漂移（同 BUG-24）。 |
| BUG-27 | P0 | 前后端 | 混合文件夹/文件的手工排序刷新后无法保持 | `backend/src/routes/folders.js`, `frontend/src/pages/BrowsePage.jsx` | 2026-09-10 | `/reorder` 用单一交错索引同时给文件夹与文件赋 `sort_order`，但 `GET /:id/contents` 只返回 `folders`/`files` 两个数组，前端固定「文件夹在前、文件在后」渲染——交错顺序在刷新后丢失。修法取「合并视图」：manual 模式额外返回 `items`（按 `sort_order` 合并排序），前端优先用它渲染，非 manual 模式不返回（由前端按各自规则重排）。前端 `buildReorder` 的顺序基准也改用 `items`，否则拖拽结果会与显示顺序不符。验证：`backend/test/api.test.js` 断言 `items` 的交错序列，并覆盖「非 manual 不返回 items」。 |
| BUG-29 | P2 | 文档 | README 声明的最低 Node 版本已过时 | `README.md`, `backend/package.json`, `frontend/package.json` | 2026-09-10 | — |
| BUG-38 | P2 | 工程·本地开发 | Vite dev server 因源码目录出现临时文件而 EBUSY 崩溃 | `frontend/vite.config.js` | 2026-09-11 | 现象：写源码的工具（编辑器 / agent）常以「临时文件 + 原子替换」落盘，会在被改文件旁留下 `<file>.<pid>.<guid>.tmpdir/xxx.tmp`；这类路径只存活几毫秒，Vite 的 watcher 若抢在它被删除前监听就抛 `EBUSY: resource busy or locked`。根因：该错误是 `FSWatcher` 的 `error` 事件且无人接管，Node 以未捕获错误直接退出——**整个 dev server 挂掉**（实测一次编辑后 5173 端口消失、前端整站无法访问，backend 不受影响）。修法：`server.watch.ignored` 忽略 `**/*.tmpdir/**`、`**/*.tmp`。验证：手工在 `frontend/src/components/` 下建 `.X.jsx.<pid>.<guid>.tmpdir/X.jsx.tmp` 再删除，dev server 保持 HTTP 200 且 err 日志无 EBUSY。 |
| BUG-39 | P1 | 安全 | SSRF 白名单漏掉整个 IPv6 内网地址族，BUG-20 的防护可被绕过 | `backend/src/llm.js` | 2026-09-11 | 现状：`isForbiddenIp` 的 IPv6 分支只判 `::`/`::1`/`::ffff:`，`fc00::/7`（ULA）、`fe80::/10`（链路本地）、`fec0::/10`、`ff00::/8`（组播）全部返回 false。阿里云内网元数据在 IPv6 下正是 `fd00:0:0:0::1`，恰落在未拦截段。影响：任何已注册用户（门槛仅邮箱验证码）提交 `{llm:{baseUrl:'https://[fd00:0:0:0::1]/v1'}}` 即可让服务器以本站身份访问 IPv6 内网（盲 SSRF：请求固定为 POST /chat/completions）。修法：非全局单播 `2000::/3` 一律拒绝，并把 IPv4 兼容地址 `::a.b.c.d` 映射回 IPv4 规则、解析失败时保守拦截。验证：`test/ssrf.test.js` 新增 6 个内网 IPv6 字面量被拒 + 全局单播放行。 |
| BUG-40 | P1 | 安全 | `/api/search` 的 q 无长度上限：一条匿名请求可占住事件循环数秒 | `backend/src/routes/search.js`, `backend/src/searchService.js`, `backend/src/searchMatch.js` | 2026-09-11 | 现状：路由对 q 无长度校验；`searchLibrary` 对全库每个名称跑 `matchScore`，而含拉丁字母的查询会进 pinyin-pro 的 DP 匹配，开销随查询长度线性增长（实测 2000 字 ≈0.5 s、8000 字 ≈2.3 s 跑完整库，而 `gaoshu` 只要 22 ms）。影响：匿名用户发一条 `?q=<8KB 字母>` 即可阻塞单线程 Node，期间 /api/health、登录、上传全部排队，属低成本拒绝服务（全局限流 300 次/分钟拦不住「单请求即卡死」）。修法：路由层超过 `MAX_QUERY_LEN=64` 直接 400（不截断，避免语义歧义），服务层兜底 `slice`（覆盖 AI 工具调用路径），拼音层再加 `MAX_PINYIN_QUERY_LEN=32` 短路。验证：`test/auditFixes.test.js` 覆盖 200 字 → 400、64 字放行、65 字拒绝。 |
| BUG-41 | P1 | 后端 | 文件移动缺 oss_key 冲突检查：先覆盖目标对象、再以 500 失败（他人文件内容被替换） | `backend/src/routes/files.js` | 2026-09-11 | 现状：`PATCH /api/files/:id` 的改名分支有 `oss_key` 唯一性检查，**移动分支没有**；而文件名查重是按**原始 name** 比较（`findSibling`），OSS key 是按 `cleanObjectSegment` 归一化后比较，两者不等价（历史脏数据、Unicode 归一化差异都能让「同名不同 name」）。影响：把 `a/b.pdf`（key 归一化为 `a-b.pdf`）移进含 `a-b.pdf` 的目录时，`findFileByName` 放行 → `copyOssObject` 覆盖目标对象 → UPDATE 撞 `UNIQUE(oss_key)` 抛错 → 500；无辜文件的 DB 行还在，对象内容已被换掉。修法：移动分支补与改名分支同款的 key 冲突 409。验证：`test/auditFixes.test.js` 构造脏数据后断言 409 且原行未变。 |
| BUG-42 | P1 | 后端 | 文件名可含路径分隔符：key 归一化碰撞导致「覆盖后失败」与静默数据丢失 | `backend/src/routes/files.js` | 2026-09-11 | 现状：`sanitizeName` 只删控制字符，不拦 `/`、`\`，而文件夹名那一半早有 `containsPathSeparator` 校验（BUG-11 只修了一半）。`cleanObjectSegment` 把分隔符归一化成 `-`，于是 `a/b.pdf` 与 `a-b.pdf` 落到同一个 key。影响：(1) 上传注册时 `findFileByName` 查重漏过 → INSERT 撞 UNIQUE → 409，前端随即调 cleanup-upload 把该 key **从 OSS 真删**，而该对象可能正被既有文件引用 → 下载/预览永久 404 且不可恢复；(2) 与 BUG-41 叠加可替换他人文件内容。修法：上传与改名入口统一校验分隔符并 400；cleanup-upload 另加「不得删除已被 files 行引用的对象」（见 BUG-43）。验证：`test/auditFixes.test.js` 断言 `a/b.pdf`、`a\b.pdf` 均在 upload-url 阶段被拒。 |
| BUG-43 | P2 | 安全 | cleanup-upload 未配置前缀时可删除桶内任意对象，且不检查该对象是否已被引用 | `backend/src/routes/files.js` | 2026-09-11 | 现状：`oss_key` 只有在前缀**非空**时才做前缀校验——未配置 `OSS_KEY_PREFIX` 的部署里任何 key 都会被照删；且完全不检查该 key 是否已被 `files` 行引用。影响：一个本用于「注册失败后清理孤儿对象」的 best-effort 接口，实际可销毁桶内任意对象（含其它应用的对象、以及线上文件的存储对象）。修法：无前缀直接 400（放弃这次清理最多留个孤儿对象，比无边界删除安全）；被 `files` 行引用时 409。验证：`test/auditFixes.test.js` 覆盖前缀外 400、已引用 409、真孤儿 200。 |
| BUG-44 | P2 | 安全 | 不可预览类型绕过后端 default-deny 内联策略：`force_download` 前端零消费，预览弹层直接导航 OSS 对象 | `backend/src/oss.js`, `backend/src/routes/files.js`, `frontend/src/components/Preview/Body.jsx`, `frontend/src/components/Preview/UnknownViewer.jsx` | 2026-09-11 | 现状：后端算好了 `force_download`（`shouldForceDownload`：svg/html/未知扩展名一律 true），但前端 grep 不到任何消费方；`UnknownViewer` 对这类文件渲染指向签名 URL 的 `<a target="_blank">`，等于让浏览器自行决定如何渲染 OSS 对象。桶绑定站点自有域名时内联 SVG/HTML 会在站点源上执行脚本，而 `sync` 导入 OSS 对象时不做扩展名过滤，这类文件可以合法存在。修法：`signedGetUrl` 支持 `forceDownload`（按签名下发 `Content-Disposition: attachment` + 通用二进制类型），路由对 `shouldForceDownload` 命中即启用；前端 `UnknownViewer` 改走已有的 `onDownload`（blob 下载），不再直接导航对象 URL。验证：前后端测试全绿；预览链路人工核对（PDF/图片仍内联，压缩包与未知类型转 attachment）。 |
| BUG-45 | P2 | 后端 | `?sort=constructor` 命中原型链导致 500 | `backend/src/routes/folders.js` | 2026-09-11 | 现状：排序字段用「查表取不到就回退默认值」的短路写法，而 `SORT_FIELDS` 是对象字面量——`constructor`/`__proto__`/`toString` 都会命中 `Object.prototype` 上的成员（真值）使回退失效，成员被当成排序表达式拼进 SQL 并抛 `near "Object": syntax error` → 500 + 错误栈日志。修法：白名单改用 `Object.hasOwn()` 查询，未知键回退默认排序。验证：`test/auditFixes.test.js` 覆盖 5 个原型键均 200、未知字段回退名称排序。 |
| BUG-46 | P2 | 后端 | `DELETE /api/folders/:id` 不校验存在性：返回 200、计数虚报，并会删除桶里「前缀根」这一伪键 | `backend/src/routes/folders.js` | 2026-09-11 | 现状：只判「id 为空」，随后直接 `collectFolderTree(id)`（PATCH 那边是有 404 校验的）；对不存在的 id，`folderIds=[id]` 而 `folderMap` 查不到 → `placeholderKeyForFolderFromMap` 退化成只剩前缀 → 得到一个 `<prefix>/` 这样的伪键，再交给 `deleteOssObjectIfExists` 真删。影响：`DELETE /api/folders/999999` 报 200 + `removed_files:1` 掩盖 id 错误；配置了前缀的部署会无 DB 依据地删除桶里那个键的对象。修法：补 `getFolder` 存在性校验返回 404，且只对 `folderMap` 里真实存在的 id 计算占位键。验证：`test/auditFixes.test.js` 覆盖 404 与「计数只含真实文件」。 |
| BUG-47 | P2 | 后端 | 搜索快照缓存的失效函数从无调用方：增删改后 30 秒内搜索陈旧 | `backend/src/searchService.js`, `backend/src/routes/files.js`, `backend/src/routes/folders.js`, `backend/src/routes/sync.js` | 2026-09-11 | 现状：非 test 环境启用 30 s 全库 `folders`/`files` 快照缓存（BUG-07 的性能修复），但 `invalidateSearchCache()`（注释自述「可选，供未来接入」）只被测试引用——上传注册、改名、移动、删除、文件夹增删改、sync 导入全都没有失效。影响：管理员刚上传/改名/同步的资料 30 秒内搜不到（甚至 AI 助手回答「没有找到相关内容」），已删除的文件仍被搜出并推荐，点开即 404；同一请求内 prompt 用的是实时目录、结果用的是旧快照，口径不一致。修法：把失效接线到所有写路径（files 的注册/改名/移动/删除、folders 的新建/改名/移动/删除、sync 事务提交后）；reorder 只改 sort_order 而快照不含该字段，故不必失效。验证：`test/auditFixes.test.js` 临时把 NODE_ENV 切到 production 打开缓存，断言「注册后立刻可搜到」。 |
| BUG-48 | P2 | 后端 | sync 先统计 repaired 再删失联行：同一批记录同时计入 repaired 与 removed | `backend/src/routes/sync.js` | 2026-09-11 | 现状：ext 批量修复（统计 `repaired_files += chunk.length`）跑在删除失联记录之前，所以「ext 不符且对象已不在桶里」的行会被两个计数各算一次，一次同步的 `repaired_files` / `removed.files` 无法自洽。影响：同步结果提示不可信——管理员看到「修复了 N 个文件类型」，其中一部分当次就被删掉了。修法：先把「本次将被删除的 id 集合」算出来，ext 修复与统计都排除它们（顺带复用同一个集合，去掉一次全表扫描）。验证：`test/auditFixes.test.js` 断言 removed=1、repaired=1 且烂 ext 归零。 |
| BUG-49 | P2 | 后端 | `mimeOf` 覆盖不全：30 个白名单扩展名里 20 个派生为 null，与 BUG-26 的契约不一致 | `backend/src/mime.js` | 2026-09-11 | 现状：BUG-26 把 MIME 收敛为「扩展名派生是唯一权威」，但 MIME 表只覆盖了 10 个白名单类型；rtf/dotx/wps/et/dps 等 14 个**正式可预览类型**与 6 个压缩包全部派生为 null → 落库 `mime_type = NULL`、对外 `application/octet-stream`。影响：任何按 mime_type 判类型的客户端（以及后续 nginx/OSS 的 Content-Type 逻辑）会把这些正式资料当成未知二进制。修法：补齐白名单全部缺项，并加不变量测试锁住（以后加白名单类型必须同步补 MIME）。验证：`test/auditFixes.test.js` 断言 `ALLOWED_EXTS` 中每个扩展名都能派生出 MIME。 |
| BUG-50 | P2 | 安全 | `ppsm`（宏格式）留在白名单内，与「拒绝宏格式」的自述策略矛盾 | `backend/src/extPolicy.js`, `frontend/src/utils.js` | 2026-09-11 | 现状：`extPolicy.js` 注释写明「Macro-enabled Office formats (docm/dotm/xlsm/xltm/pptm/potm) are rejected: they are the standard vector for distributing malware to students」，但 `ALLOWED_EXTS` 里同时有 `ppsm`（PowerPoint Show with Macros，正是宏格式家族成员），前端 `utils.js` 的 OFFICE_EXT 也抄了一份。BUG-23 当时是「让前端对齐后端白名单」，于是把这份不一致一起固化了。影响：宏格式课件可被上传并分发给学生，与策略声明的保护意图相悖（上传需管理员权限，故定 P2）。修法：从两侧白名单移除 `ppsm`，并核对同族的 `pptm/potm/ppam` 确实都不在表内。验证：`test/extPolicy.test.js` 增加宏格式家族全被拒的断言 + 前端 `utils.test.js` 同步。 |

| BUG-56 | P1 | 前端 | `useFolderContents` 无竞态守卫：过期响应覆盖新目录数据 | `frontend/src/pages/Browse/useFolderContents.js` | 2026-09-11 | IMPROVE-01 拆出的新 hook 漏了 BUG-05 在 SearchBar 用过的守卫：`refresh()` 直接 `then(setData)`，而触发它的 effect 依赖 `[folderId, sort, order]`，切换时会并发新请求且不取消旧的。修法：`reqIdRef` 递增，只在最新请求时 setData/setErr/setLoading（顺带把加载失败文案从 `browse.moveError` 改成 `common.loadFailed`，见 BUG-65）。验证：前端 84 例全绿；该竞态由「上传完成回调持旧 folderId」这类真实时序触发，已在代码注释写明。 |
| BUG-62 | P2 | 前端 | 中文输入法选词回车被当成发送 | `frontend/src/components/ChatComposer.jsx` | 2026-09-11 | `onKeyDown` 只判 `event.key === 'Enter'`，未判 `event.nativeEvent.isComposing`，中文用户按回车选词时半截问题被直接发出。修法：加 `!event.nativeEvent.isComposing`。验证：前端 84 例全绿（IME 合成态在 jsdom 里无法真实模拟，故以代码审查 + 注释为准）。 |
| BUG-63 | P2 | 前端 | `chatStream` 走原生 fetch，401 不清理 token（与 axios 路径不一致） | `frontend/src/api.js` | 2026-09-11 | axios 拦截器 401 时 `clearToken()` + 派发 `auth:expired`，而 `chatStream` 用 fetch，非 2xx 只把文案塞进气泡——token 过期后聊天持续失败而界面仍显示已登录。修法：抽出 `handleUnauthorized(status)` 供两条路径共用，chatStream 的非 2xx 分支先调它。验证：`test/api.test.js` 新增「401 → token 被清、auth:expired 派发一次、抛出后端文案」。 |
| BUG-65 | P2 | 前端 | 失败提示文案与操作不匹配（新建/加载/同步都提示「移动失败」） | `frontend/src/pages/BrowsePage.jsx`, `frontend/src/pages/Browse/useFolderContents.js`, `frontend/src/pages/Browse/useOssSync.js` | 2026-09-11 | 三处 `errMsg` 兜底都传 `browse.moveError`（zh「移动失败」/ en "Move failed"），网络错误或超时时会露出，用户按错误方向排查。修法：新增 `browse.createError`、`browse.syncError`，列表加载失败改用既有的 `common.loadFailed`。验证：`i18n.test.js` 的 en/zh 键对齐用例全绿。 |
| BUG-68 | P2 | 前端 | `zh.js` 同一对象内重复定义 `actionFailed` 与 `today` | `frontend/src/i18n/zh.js`, `frontend/src/test/i18n.test.js` | 2026-09-11 | 后写者生效，改靠前那处完全无效（「改了没反应」），而键集合/取值用例发现不了。修法：删掉重复两行，并新增带自检的重复键守卫——用「跳过注释与字符串」的手写扫描器按花括号层级收集键（字典里有 `{{count}}` 这类含花括号的字符串，朴素计数会误判），先断言检测器本身有效再检字典，避免守卫空转。验证：前端 84 例全绿。 |
| BUG-74 | P1 | 文档 | `DEPLOY.md` 的备份命令在 WAL 模式下备份出空库 | `docs/DEPLOY.md` | 2026-09-11 | 后端启用 `PRAGMA journal_mode = WAL`，而文档只 `cp data.db`——不停服、不带 `-wal`/`-shm`。本仓库开发库就是反例：`data.db` 4 KB、`data.db-wal` 600 KB，单独拷贝后 `SELECT COUNT(*) FROM files` 报 `no such table: files`——备份静默失效，真出事时才发现无库可恢。修法：文档给出三种可用写法（停服后 `cp -a data.db*`、`sqlite3 ".backup"`、无 CLI 时 `node:sqlite` 的 `VACUUM INTO`），并提示定期抽查备份能否打开。验证：本地按 `VACUUM INTO` 实测可得含完整表结构的库。 |
| BUG-75 | P2 | 后端 | 用户可建名为 `.preview` 的文件夹，其内容会被下一次 sync 永久删除记录 | `backend/src/routes/folders.js` | 2026-09-11 | `listOssObjects` 为跳过历史 IMM 影子副本会过滤 `<prefix>/.preview/` 下的全部对象，而文件夹名校验只拦路径分隔符，`.preview` 是合法名。于是该文件夹里的文件永远不进同步列表 → DB 行被判「桶里已不存在」而删除（对象仍在，成孤儿），每次同步重复发生。修法：把 `.preview` 列为保留名（大小写不敏感），创建与改名都 400。验证：`test/auditFixes.test.js` 覆盖创建、改名、大小写变体。 |
| BUG-76 | P1 | 工程·CI | CI 只在 PR→main 触发，`dev` 上开发全程零校验（假绿） | `.github/workflows/ci.yml`, `README.md` | 2026-09-11 | 原 `on:` 只有 `pull_request: branches: [main]`，而 AGENTS.md §2.1 规定直接在 `dev` 上开发、仅在人类要求时才向 main 开 PR——等于所有日常推送都不跑测试与构建，「CI 通过」只在发布那一刻才有意义。修法：加 `push: branches: [dev]`（deploy 仍只挂 main/master，不会误部署），并同步 README 描述。验证：YAML 结构核对 + 本机等价命令（前后端测试与 build）全绿。 |
| BUG-77 | P1 | 工程·部署 | 部署健康检查失败无回滚，线上停在新修订持续 502 | `.github/workflows/deploy.yml`, `docs/DEPLOY.md` | 2026-09-11 | 原脚本以 `curl -fsS /api/health` 收尾：此时新代码与前端 dist 都已覆盖，健康检查失败只让 workflow 变红，服务器仍跑坏修订，只能人工 SSH 救。修法：部署前记录 `PREV=$(git rev-parse HEAD)`，失败则 `cd /opt/zyxf && git reset --hard $PREV` → 重装依赖 → 重建前端 → 重启后端 → `exit 1`（仍判失败，不掩盖事故）。验证：内嵌脚本分支人工核对，回滚分支用绝对路径 `cd`，避免承接前一步的 cwd。 |
| BUG-78 | P2 | 安全 | 生产 CSP 的 `style-src` 缺 `fonts.googleapis.com`，About 页字体样式表被静默拦掉 | `frontend/nginx.conf`, `docs/DEPLOY.md` | 2026-09-11 | `index.html` 引入 Google Fonts 的 DM Sans 样式表，`AboutPage` 又强制 `fontFamily: 'DM Sans'`，而 CSP 的 `style-src` 只有 `'self' 'unsafe-inline'`——样式表被拦，页面字体退回 sans-serif 且控制台持续报违规（IMPROVE-11 建立策略时漏掉这个 origin）。修法：`style-src` 补 `https://fonts.googleapis.com`（server 级与 `/assets/` 两处都要，子级 `add_header` 会屏蔽继承），DEPLOY.md 模板同步。验证：构建产物中确认 `index.html` 确实引用该 origin。 |
| BUG-80 | P2 | 工程·本地开发 | nodemon 的 watcher 因同一类原子写临时文件 EBUSY 而退出，后端整站停服 | `backend/package.json` | 2026-09-11 | BUG-38 只修了 Vite 一侧。本轮继续编辑源码时后端也倒了，`run.err.log` 明确记下根因：`[nodemon] Internal watch failed: EBUSY: resource busy or locked, watch '...\backend\src\routes\files.js~RF85e5fa1.TMP'`——编辑器/agent 的「临时文件 + 原子替换」会在被改文件旁留下 `~RF*.TMP` / `*.tmpdir/`，nodemon 的 watcher 抢在删除前监听即抛 EBUSY，进程随之中止（端口 4000 关闭，Vite 代理返回 500）。修法：`package.json` 加 `nodemonConfig`——`watch: ["src"]` 收窄监听范围，`ignore` 排掉 `**/*.tmp`、`**/*.TMP`、`**/*.tmpdir/**`、`**/*~RF*`。验证：手工在 `backend/src/routes/` 下建 `files.js~RF*.TMP` 与 `.index.js.*.tmpdir/index.js.tmp` 再删除，后端保持 HTTP 200、日志无新重启、err 日志无 EBUSY。 |
| BUG-52 | P1 | 安全 | 改 `ADMIN_USER` 不回收既有管理员行：旧用户名 + 旧密码仍能登录为 admin | `backend/src/db.js`, `backend/test/ensureAdmin.test.js` | 2026-09-11 | `ensureAdmin` 原先只按当前 `ADMIN_USER` 定位那一行，全程不触碰其它 `role='admin'` 的行；而 `POST /api/auth/login` 只查 `users` 表、不看配置，应用内又没有用户管理入口——运维把 `admin` 改成不易猜的名字（常见加固动作）并重启后，旧行仍在、旧密码仍有效，若改名动机正是「怀疑凭据泄漏」，这一步等于没做。处置：`ensureAdmin` 同步完成后把其它管理员降权为 `user` 并自增其 `token_epoch`（立即踢掉旧 token），同时 `console.warn` 打印被降级账号。验证：`test/ensureAdmin.test.js` 新增「换 ADMIN_USER 后旧管理员被降权」，后端 181 例全绿。 |
| BUG-73 | P2 | 安全 | `users.role` 列默认值是 `'admin'`（与「注册即普通用户」的授权模型相反） | `backend/src/db.js`, `backend/test/ensureAdmin.test.js` | 2026-09-11 | 建表时 `role TEXT NOT NULL DEFAULT 'admin'`，而注册流程特意写 `'user'`、只有 `ensureAdmin` 能给 admin——任何漏写 role 的写入（迁移/种子/修复脚本、测试夹具、以后新增的邀请路径）都会静默创建全站写权限账号，且 `requireAdmin` 只看 role 字段，等于直接放行。处置：SQLite 不支持只改列默认值，故按标准「建新表 → 迁数据 → 改名」重建 `users`（仅在 `PRAGMA table_info` 显示 dflt_value 仍是 `'admin'` 的老库执行一次）；`ensureAdmin` 本来就显式写 `'admin'`，不受影响。验证：**用真实 `db.js` 打开一个按老 schema 造出的库**——日志出现 `migrated users.role default: admin -> user`，默认值变为 `'user'`，两条账号（admin/user）与角色、以及新增的 `token_epoch` 列全部完好；`test/ensureAdmin.test.js` 另有「漏写 role 的插入得到普通用户」用例。 |
| BUG-51 | P1 | 安全 | JWT 无撤销机制：改密码 / 降权 / 删号后旧 token 在有效期内仍持有全权 | `backend/src/auth.js`, `backend/src/db.js`, `backend/src/routes/auth.js`, `backend/test/auth.test.js` | 2026-09-11 | `attachUser` 原先只验签就 `req.user = payload`、从不回查数据库，`ensureAdmin` 改密码也只更新哈希——于是改密只让「用户名+密码」这条路失效，被盗 token 在 `exp`（默认 7d）之前仍是有效 admin；被删除或降权的账号同样一路放行。处置：`users` 加 `token_epoch`（改密/回收管理员时自增），签发 token 时带上当时的值，`attachUser` 按 `payload.id` 回查 `username/role/token_epoch` 并要求 epoch 相等，不符即不挂 `req.user`；role 一并取自库中，使降权立即生效。`payload.epoch ?? 0` 让升级前签发的 token 仍可用，一次改密后全部失效（无需强制全员重登）。验证：`test/auth.test.js` 新增 3 例（删号后 token 失效、改密后旧 token 失效而新 token 有效、payload 写 admin 但库里是 user 时不提权）；后端 190 例全绿。 |
| BUG-53 | P1 | 安全 | 登录限流只按出口 IP 计数：NAT 下连坐封锁，对单账号又无上限 | `backend/src/routes/auth.js`, `backend/test/authHardening.test.js` | 2026-09-11 | 用库默认的纯 IP 分桶：校园/办公 NAT 下任何人（无需账号、无需知道用户名）打 10 次错密码，就把该出口所有人锁在登录页外 15 分钟（正确密码也拿 429，实测）；反向对「分布式爆破单个账号」又毫无约束。处置：`keyGenerator` 改为把「IPv6 归并后的出口 IP」与「提交账号的小写形式」拼成桶键（用库导出的 `ipKeyGenerator(req.ip)` 做归并），另叠一层纯 IP 的宽松洪泛桶（100 次/15 分钟）顶住随机用户名的脚本。验证：`test/authHardening.test.js` 用例——同一出口把 alice 打满限流后，bob 仍能 200 登录（改前此处为 429）。 |
| BUG-69 | P2 | 安全 | `/register/code` 先写库再发信：发送失败仍占用 60 秒冷却与当日额度，并作废用户手上的有效码 | `backend/src/routes/auth.js`, `backend/test/authHardening.test.js` | 2026-09-11 | 原顺序是「生成 code → upsert（`sent_count+1`、刷新 `expires_at`）→ await 发信」，失败只返回 502 不回滚。后果：邮件服务抖动（正是 BUG-37 那类故障）时用户重试 10 次即耗光 24 小时额度而一封码都没收到；覆写还会顶掉用户手上仍有效的旧码；额度按邮箱计且无需认证，第三方可替他人邮箱打满。处置：先 `await sendVerificationCode`，成功后才落库（并把新码的 `uses` 归零）。验证：`test/authHardening.test.js` 用新增的 `mailState.failNext` 钩子模拟发信失败——502 后库里无记录、紧接着重试即 200、冷却只在该次成功后才生效。 |
| BUG-70 | P2 | 安全 | 登录响应时间可稳定区分账号是否存在（实测 1.3ms vs 44.8ms） | `backend/src/routes/auth.js`, `backend/test/authHardening.test.js` | 2026-09-11 | `if (!user \|\| !bcrypt.compareSync(...))` 短路：账号不存在时根本不跑 bcrypt，而 401 文案刻意不区分两种失败（设计意图就是不给枚举口子）。处置：模块级预计算 `DUMMY_HASH`，两条分支都跑一次 `compareSync`（先 compare 再判 user，避免又短路）。验证：用例把 `bcrypt.compareSync` 换成计数包装，断言「账号不存在时也被调用一次」，避免用易抖动的耗时断言。 |
| BUG-71 | P2 | 安全 | `/register` 的用户名枚举 oracle：同一枚合法验证码可无限复用 | `backend/src/routes/auth.js`, `backend/src/db.js`, `backend/test/authHardening.test.js` | 2026-09-11 | 重名检查在验证码校验通过之后，而 `DELETE FROM email_codes` 只在 INSERT 成功后执行——失败分支既不删行也不记账，实测同一枚码连打 4 次「已占用用户名」全部 409 且 `attempts` 始终为 0；`registerLimiter` 是 15 次/分钟/IP，枚举速率比 /login 高两个数量级且不产生失败日志。处置：`email_codes` 加 `uses` 列（与输错计数 `attempts` 分开，避免合法用户输错几次再成功被算作滥用），核验通过即 +1，超过 `MAX_CODE_USES=3` 要求重新获取；用户名与邮箱冲突改为同一句文案，不透露是哪个字段。验证：用例断言「同一枚码第 4 次提交被拒且提示使用次数过多」。 |
| BUG-72 | P2 | 安全 | bcrypt 静默截断到 72 字节，注册校验却按字符数：40 个汉字的密码只有前 24 个生效 | `backend/src/routes/auth.js`, `backend/test/authHardening.test.js` | 2026-09-11 | 校验用 `password.length`（UTF-16 码元 8–72），而 bcrypt 只用前 72 **字节**。实测 `hashSync('密'.repeat(40))`（120 字节，注册放行）之后，`compareSync('密'.repeat(24))` 与 `compareSync('密'.repeat(40) + 'ZZZ')` 都返回 true——用户以为设了 40 个汉字，实际只有前 24 个参与校验，掌握该前缀的人即使后缀完全不同也能登录。处置：下限仍按字符数（8 位字符是用户能理解的口径），上限改按 `Buffer.byteLength(password, 'utf8') > 72` 拒绝，并给出「约 24 个汉字」的提示。验证：用例断言 40 个汉字（120 字节）被拒、24 个汉字（恰好 72 字节）放行。 |

### 2.2 已关闭改进项（18）

| 编号 | 严重度 | 类别 | 标题 | 处理位置 | 关闭日期 | 处置要点 |
|---|---|---|---|---|---|---|
| IMPROVE-01 | P2 | 前端 | 页面与组件职责集中，目录结构缺少页面级子模块边界 | `frontend/src/pages/BrowsePage.jsx`, `frontend/src/pages/Browse/*` | 2026-09-11 | 分两步落地。第一步（无状态展示迁移）：`DashboardPage` 640→367 行（抽出 `pages/Dashboard/ActivityHeatmap.jsx`、`pages/Dashboard/primitives.jsx`），`ChatComposer` 517→426 行（抽出 `components/Chat/parts.jsx`）。第二步（本次）：`BrowsePage` 821 行/28.6 KB → 容器 261 行/8.9 KB，`pages/Browse/` 下新增 `ItemList.jsx`(226)、`useItemDragDrop.js`(154)、`SortControl.jsx`(81)、`useOssSync.js`(51)、`useFolderContents.js`(49)、`RenameDialog.jsx`(44)、`primitives.jsx`(32)；`notifyFoldersChanged` 上收到 `utils.js` 供容器与拖拽 hook 共用。约束：DOM 顺序、class 名与请求时序保持不变（`refresh` 读 sort/order ref 的写法原样保留）。验证：新增 `frontend/src/test/BrowsePage.test.jsx` 10 例锁住拆分前行为，其中 2 例专测 BUG-27 的 `items` 合并视图（渲染顺序 + 拖拽重排基准）；前端 81 例、后端 160 例、`vite build` 全绿。 |
| IMPROVE-02 | P2 | 安全 | Mimosa 安全扫描剩余项：均为协议性要求/误报，需批量归类豁免 | `backend/src/routes/folders.js`, `backend/src/imm.js`, `backend/test/env.js`, `frontend/src/test/setup.js` | 2026-09-11 | 三条标记经复核全部是**误报或协议性约束**：`cellCompare`/`sortByName` 是无用户输入的静态比较器，且仓库用 SQLite（`node:sqlite`）而非 MongoDB，不存在 `mongo-sort-injection` 注入面；`imm.js` 的 HMAC-SHA1 是阿里云 OSS 签名协议**固定要求**，换算法会直接签不过；测试里的 `test-key`/`secret123` 是虚构断言值，改名既消不掉标记、还会破坏契约断言。处置：不再依赖外部扫描客户端的豁免配置，改为**就地豁免**——在被标记的代码旁写明判定依据（两个比较器、`hmacSha1`），并在 `backend/test/env.js`、`frontend/src/test/setup.js` 顶部统一声明测试凭据为虚构值，后续任何扫描或人工复核都能直接看到依据。 |
| IMPROVE-03 | P2 | 安全 | 同步接口权限由 admin-only 改为分层限流（游客/用户/管理员递增配额） | `backend/src/limiter.js`, `backend/src/routes/sync.js` | 2026-09-10 | 产品决策：游客与登录用户均可触发同步，滥用面由分层限流约束（补偿性控制）——游客 2 次/分钟 < 登录用户 5 次/分钟 < 管理员豁免；登录用户按 user id 计数（避免同一 NAT 出口共用 IP 配额），游客按 IP 计数（`ipKeyGenerator` 归并 IPv6 子网）。验证：`backend/test/api.test.js` 覆盖三档。安全评审如认为写操作不应向匿名开放，回退方式是给 `syncLimiter` 叠加 `requireUser`。 |
| IMPROVE-04 | P1 | 安全 | OSS 凭证由 `PowerUserAccess` 改为专用 RAM 用户 + 单 bucket 最小权限 | `.env`（云端 RAM 策略 `zyxf-oss-app`）· `docs/DEPLOY.md §2.2` | 2026-09-10 | 原凭证复用个人 `obsidian` RAM 用户，该用户挂着 `PowerUserAccess`（全产品管理权限），一旦泄漏影响面远超本项目。处置为新建专用用户 `zyxf-oss` + 自定义策略 `zyxf-oss-app`，只授 `xjtu-zyxf` bucket 的 `ListObjects`/`GetObject`/`PutObject`/`DeleteObject`/`CopyObject`（按后端实际调用面推导）。验证：新密钥访问 `xjtu-zyxf` 正常、访问另一 bucket `obsidian-aloha` 返回 `AccessDenied`——两者都满足才算最小权限生效。 |
| IMPROVE-05 | P2 | 安全 | 下载日志（含 ip/ua）无保留期，PII 无限期留存 | `backend/src/db.js`, `backend/src/index.js` | 2026-09-10 | `download_logs` 含访问者 `ip`/`ua`，属可定位到个人的访问记录，此前无任何清理逻辑（永久留存）。处置：启动时按 `DOWNLOAD_LOG_RETENTION_DAYS`（默认 400，略大于仪表盘热力图的近一年窗口）删除超期行；无需保留访问明细时可调小。验证：`backend/test/securityFixes.test.js` 覆盖边界（401 天前删除、窗口内保留）。 |
| IMPROVE-06 | P2 | 安全 | JWT 校验未固定算法，未显式 pin `HS256` | `backend/src/auth.js` | 2026-09-10 | — |
| IMPROVE-07 | P2 | 文档 | `.env.example` 管理员描述过时，且漏列 `ALLOWED_DEV_ORIGIN` | `.env.example` | 2026-09-10 | — |
| IMPROVE-08 | P2 | 工程·CI | CI workflow 的 action 用可变 tag，未固定 commit SHA | `.github/workflows/ci.yml` | 2026-09-10 | `ci.yml` 的 `actions/*` 曾用可变 tag，现固定到 commit SHA，与 `deploy.yml` 同口径（BUG-19 的结论）。升级时用 `git ls-remote ... refs/tags/<tag>` 重新解析目标 SHA。 |
| IMPROVE-09 | P1 | 安全 | `zyxf-mail` 持 `AliyunDirectMailFullAccess`（`dm:*`），远超实际所需 | 云端 RAM 策略 `zyxf-dm-send` | 2026-09-10 | `backend/src/mail.js` 只调用 `SingleSendMail`，却授予 `dm:*`（含域名/模板/收件人管理、IP 防护等）。处置为新建 `zyxf-dm-send`（仅 `dm:SingleSendMail`），挂到 `zyxf-mail` 后摘掉 `AliyunDirectMailFullAccess`。验证：以该用户凭证探测，越权只读动作 `GetTrackList`（**参数传齐**）返回 `Forbidden`，`DescAccountSummary`/`GetUser`/`GetIpfilterList` 均被拒；策略内 `SingleSendMail` 返回收件地址校验错误而非权限错误。⚠️ **探测坑**：`DescDomain`/`CreateTemplate`/`DeleteDomain` 返回的是**鉴权前的参数校验错误**，不能当作「策略放行」的证据——判定越权必须用参数完整、且能走到鉴权阶段的动作。 |
| IMPROVE-10 | P2 | 安全 | `/api/chat` 对匿名开放且允许客户端自带 baseUrl（受限公网代理面） | `backend/src/routes/chat.js`, `frontend/src/components/ChatComposer.jsx` · `frontend/src/i18n/zh.js` | 2026-09-11 | 处置：`/api/chat` 在「服务端未配置 `LLM_*` + 请求带自带 `llm` 配置 + 未登录」时返回 401，且判断放在 `resolveClientLlmConfig` **之前**——匿名请求一律不做 DNS 解析，避免被当成匿名 DNS 探测器（SSRF 防护只挡内网，挡不住「以本站身份访问公网」）。不带 `llm` 字段的匿名请求仍走原 503「AI 功能未配置」（登录也解决不了，提示更准确）；服务端已配置 `LLM_*` 时完全不受影响（客户端配置本就被忽略），生产主场景零变化。前端 `ChatComposer` 用 `useAuth()?.user` + `/chat/status` 提前禁用输入并提示 `chat.loginRequired`，不再等发送后才报错；无自带 Key 时不拦。验证：后端新增「匿名自带配置 → 401 且未触达上游」「服务端已配置时匿名照旧可用」两例，原客户端配置用例改为登录态；前端新增「未登录 + 已存自带 Key → 禁用并提示」「未登录 + 无自带 Key → 不提示」两例。 |
| IMPROVE-11 | P2 | 前端 | CSP 配置在 nginx 层（后端关闭有意为之）+ nosniff/Referrer-Policy | `frontend/nginx.conf`, `backend/src/index.js` · `docs/DEPLOY.md §4.2` | 2026-09-10 | CSP 必须由**托管 HTML 的那一层**下发——后端只服务 `/api`（JSON），在那儿配 CSP 对页面无效，所以后端 `contentSecurityPolicy: false` 是有意的（已加注释）。策略落在 `frontend/nginx.conf`：`script-src 'self'`（构建产物无内联脚本）、`style-src 'unsafe-inline'`（React 内联 style）、`connect-src https:`（API/OSS/用户自带 LLM）、`frame-src https:`（IMM 预览）、`font-src`（Google Fonts）；同时补 `nosniff` 与 `Referrer-Policy`。⚠️ **nginx 坑**：`add_header` 不会被子级 location 继承——凡自己写了 `add_header` 的 location（如 `/assets/` 的长缓存）都必须**重复声明**安全头，否则静默丢失（已在该 location 重复声明）。 |
| IMPROVE-12 | P1 | 性能 | 统计接口缺支撑索引：`files(created_at)` 与 `download_logs(file_id, downloaded_at)` | `backend/src/db.js`, `backend/src/routes/stats.js`, `backend/test/auditFixes.test.js` | 2026-09-11 | stats 的 `ORDER BY created_at DESC LIMIT 8`、两次 `WHERE created_at >= ?`、上传日序列都要扫 / 排序整张 `files`；`top_downloads` 是 `GROUP BY dl.file_id` + 每组「取最近一次」相关子查询，只有单列 `downloaded_at` 索引时每组都要扫窗口内全部日志。node:sqlite 同步执行，全表扫描直接占住事件循环。处置：补 `idx_files_created` 与 `idx_download_logs_file(file_id, downloaded_at DESC)`（沿用既有 `CREATE INDEX IF NOT EXISTS` 风格）。验证：`test/auditFixes.test.js` 断言两个索引存在；后端 178 例全绿。 |
| IMPROVE-14 | P2 | 性能 | 循环内反复 `db.prepare`，且 reorder 的 `order` 无长度上限 | `backend/src/routes/folders.js`, `backend/test/auditFixes.test.js` | 2026-09-11 | 子树搬迁对每个文件重新解析一次 SQL；reorder 校验逐项 `prepare` + SELECT，而 `order` 直接来自 body（1mb 限制下可达数万项），随后又逐项 UPDATE，全部同步执行。处置：两条语句移到循环外 prepare 复用；`order.length > MAX_REORDER_ITEMS(2000)` 直接 400。验证：`test/auditFixes.test.js` 覆盖 2001 项被拒；既有 reorder 用例全绿。 |
| IMPROVE-21 | P2 | 冗余 | `largeFileHint` 导出零引用，且 20 MB 阈值以字面量硬写在两本字典 | `frontend/src/utils.js`, `frontend/src/i18n/zh.js`, `frontend/src/i18n/en.js`, `frontend/src/components/Preview/index.jsx` | 2026-09-11 | 该导出全仓零引用（真正渲染处直接用 `t('preview.largeFileHint')`），而文案把「>20MB」写死——改阈值就会与实际判定不符（两份阈值改一处即漂移）。处置：删掉零引用导出；文案改 `{{size}}` 占位，由 `formatSize(LARGE_FILE_THRESHOLD)` 注入。验证：前端 84 例全绿（`utils.test.js` 已覆盖阈值边界）。 |
| IMPROVE-27 | P1 | 工程·CI | CI 对 lockfile 漏洞完全无感（`npm ci --no-audit` 且无 audit 步骤） | `.github/workflows/ci.yml` | 2026-09-11 | BUG-35 的 `qs` 曾锁在漏洞区间上界却照样过 CI，说明这类回归无人拦。处置：两个 job 各加 `npm audit --omit=dev --audit-level=high`（只查会进生产运行时的依赖）。验证：本机两个项目均 `found 0 vulnerabilities`（不会一上来就红），命令语义为门禁而非提示。 |
| IMPROVE-28 | P2 | 工程·CI | 前端 job 只跑 build、不校验产物，空 `dist` 也能绿 | `.github/workflows/ci.yml` | 2026-09-11 | 产物由 nginx 直接托管（`nginx.conf` 的 root 指向 `frontend/dist`），「build 退出 0 但 dist 为空」属典型「CI 绿、线上白屏」。处置：新增 Verify build artifact 步骤，断言 `dist/index.html` 非空且 `dist/assets` 下有 .js/.css。验证：用真实 dist 与空 dist 双向核对过判定。 |
| IMPROVE-29 | P2 | 安全 | 两个 workflow 未声明最小 `permissions` | `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` | 2026-09-11 | Action 与内嵌脚本按仓库默认 `GITHUB_TOKEN` 权限运行，而 CI 只需要读仓库（部署凭据走 SSH secrets）。处置：两处各加 `permissions: contents: read`。验证：本轮无写操作需求，YAML 结构核对通过。 |
| IMPROVE-30 | P2 | 工程·部署 | deploy 无 concurrency：两次 push 并发在同一台服务器互相覆盖 | `.github/workflows/deploy.yml` | 2026-09-11 | 同一机器上并发执行 `git reset --hard` + `npm install` + `npm run build` + `systemctl start`，会交叉重置代码与 dist、重复启停服务，可能停在两次修订的混合态。处置：`concurrency: { group: deploy-production, cancel-in-progress: false }`，让排队的那次等前一次跑完（不取消进行中的部署）。验证：内嵌脚本分支人工核对。 |
