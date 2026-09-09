# 问题与改进追踪（ISSUES）

> 长期追踪「缺陷」与「改进建议」。缺陷按严重度分组（`P0` 最高）；改进建议独立编号。
> 编号体系：**`BUG-<n>`** 缺陷 · **`IMPROVE-<n>`** 改进。标题下第一行 = 分类（`layer · component`），第二行 = 受影响文件；正文为 现象 / 根因 / 影响 / 修法 / 验证。
> 列出的条目均为**待处理**；已处理的归入文末「已归档」。

**当前进度**：31 个缺陷 + 2 个改进；已修复 22 个，待处理 11 个。

```yaml
updated: 2026-09-09
entries: 33
fixed: 22
pending: 11
severity_levels:
  P0: 明确功能错误或崩溃风险，优先修复
  P1: 性能退化或逻辑隐患
  P2: 健壮性、规范、边缘 case、轻微改进
```

---

## 待处理

### P0

#### BUG-27 · 混合文件夹/文件的手工排序刷新后无法保持
`frontend/backend · 资料库排序`
`files: [frontend/src/pages/BrowsePage.jsx, backend/src/routes/folders.js]`

- **现象**：跨类型拖拽排序成功后，刷新仍固定先显示全部文件夹、再显示全部文件，交错顺序无法保持。
- **根因**：后端 `/reorder` 用单一交错索引同时给文件夹与文件赋 `sort_order`；`GET /:id/contents` 却分别返回 `folders`/`files` 两个数组，前端也固定先 folders 后 files，从不合并。
- **影响**：排序操作成功但刷新失效，与持久化结果不一致。
- **修法**：混排 → 后端合并返回按 `sort_order` 排序的 items，前端统一渲染；分组 → 禁止跨类型混排并分别提交排序。
- **验证**：补充文件夹/文件交错排序的 API + UI 集成测试，覆盖提交、刷新、再次拖拽。

### P1

#### BUG-24 · 统计面板的未展示类型数量可能被低估
`frontend/backend · 统计面板`
`files: [backend/src/routes/stats.js, frontend/src/pages/DashboardPage.jsx]`

- **现象**：后端 `type_breakdown` 只返回前 8 类；前端只展示前 6 类，却用返回值长度减 6 计“其余”，真实类型超 8 时最多显示 `+2 类`。
- **根因**：接口截断数量与 UI 展示数量不是同一契约，前端无从得知被截断的真实总数。
- **影响**：类型覆盖范围统计失真，可能误导管理判断。
- **修法**：后端返回总类型数或将剩余类型聚合为 `other`，前端按接口字段展示。
- **验证**：用超过 8 种扩展名的统计 fixture 验证接口与面板文案。

### P2

#### BUG-21 · 前端生产 JS 单块过大，缺少路由级代码分割
`frontend · 构建产物`
`files: [frontend/src/App.jsx, frontend/vite.config.js]`

- **现象**：`vite build` 生成 `index-DedTrFFW.js` 约 1.18 MB（gzip 约 375 KB），并提示“chunks larger than 500 kB”。
- **根因**：入口静态引入多个页面及重量级依赖，构建配置未设路由级 `import()` 或合理的 `manualChunks`。
- **影响**：首屏下载并解析完整应用代码，弱网/移动设备上变慢（首屏性能优化，非功能阻塞）。
- **修法**：对 `DashboardPage`/`BrowsePage`/`AboutPage` 等按路由懒加载，结合构建产物复核拆分，保持加载态与错误态可用。
- **验证**：实施后运行 `npm run build`，记录各 chunk 体积，并覆盖懒加载路由的前端测试。

#### BUG-23 · 前后端宏格式扩展名策略不一致
`frontend/backend · 扩展名策略`
`files: [frontend/src/utils.js, backend/src/extPolicy.js, backend/src/routes/files.js]`

- **现象**：前端把 `docm`/`xlsm`/`pptm` 等宏格式归为可预览 office 文件；后端上传与 WebOffice token 校验明确拒绝并返回 415。
- **根因**：前端展示用扩展名集合与后端安全准入集合分别维护，未共享能力契约。
- **影响**：宏格式上传即被 415 拒绝，正常不入库；仅历史 OSS 同步对象会露出「前端想预览、后端 415」的矛盾，属边缘 case。
- **修法**：以后端返回的 previewable 能力为展示依据，或移除前端宏格式预览分类；后端安全策略作唯一准入权威。
- **验证**：补充宏格式上传、预览与前端分类契约测试。

#### BUG-26 · 文件 MIME 元数据可能与扩展名派生值不一致
`frontend/backend · 文件注册`
`files: [frontend/src/api.js, backend/src/routes/files.js]`

- **现象**：前端把浏览器提供的可空 `file.type` 原样提交，后端原样落库；文件 URL 响应却按扩展名重新派生 MIME。
- **根因**：持久化 MIME 与响应 MIME 使用两套来源。
- **影响**：库内元数据与下载响应类型可能不同；因响应始终按扩展名派生，不构成 Content-Type 矛盾，主要是元数据冗余/不一致。
- **修法**：以服务端规范化扩展名派生的 MIME 为权威，客户端 MIME 仅作提示或不落库。
- **验证**：覆盖空 MIME、错误 MIME、大小写扩展名的注册与 URL 响应测试。

#### BUG-29 · README 声明的最低 Node 版本已过时
`docs/deploy · 运行时版本`
`files: [README.md, backend/src/db.js, docs/DEPLOY.md, .github/workflows/ci.yml]`

- **现象**：README 写 Node.js ≥ 20，代码用 `node:sqlite`（Node 22.5+ 内置），部署文档与 CI 实际统一用 Node 24。
- **根因**：数据库驱动迁移到 Node 内置模块后，README 环境要求未同步。
- **影响**：按 README 用 Node 20 部署可能无法运行（`node:sqlite` 不存在），增加排查成本。
- **修法**：统一文档与 CI 的最低 Node 版本为 24，并在 package manifest 声明 `engines.node`。
- **验证**：用声明的最低版本执行依赖安装、测试与启动检查。

---

## 改进建议

#### IMPROVE-01 · 页面与组件职责集中，目录结构缺少页面级子模块边界
`frontend · 页面结构`
`files: [frontend/src/pages/BrowsePage.jsx, frontend/src/pages/DashboardPage.jsx, frontend/src/components/ChatComposer.jsx]`

- **现状**：三文件均超 20 KB（BrowsePage ≈ 27.7 KB、DashboardPage ≈ 23.9 KB、ChatComposer ≈ 20.5 KB），各自同时承载数据请求、状态编排、交互事件与大量展示；源码目录只有通用 `components`/`hooks`/`pages` 分层，无页面级子模块边界。
- **根因**：功能迭代持续追加到页面/复合组件文件，页面专属的列表、统计卡片、聊天消息等未按职责拆分。
- **影响**：修改局部需理解较大上下文，复用与单测粒度受限，更易产生回归（技术债务，非功能缺陷）。
- **建议**：以页面为边界拆出 `pages/<Page>/` 下的容器、数据 hook 与纯展示组件；先迁无状态展示，再迁副作用逻辑，确保 DOM 顺序与接口调用时序不变。
- **验证**：每次拆分后跑前后端测试与生产构建，并补充对应组件行为测试。

#### IMPROVE-02 · Mimosa 安全扫描剩余项：均为协议性要求/误报，需批量归类豁免
`backend · 安全扫描`
`files: [backend/src/routes/folders.js, backend/src/imm.js, frontend/src/test/*, backend/test/*]`

- **现状**：生产已修复的三项真实问题（sync 权限、生产 CORS 拒绝 `'*'`、dev CORS 显式来源）之外，Mimosa 仍对以下做静态标记，经复核均为**误报或协议性要求**、无法在源码层面合法消除：
  - `backend/src/routes/folders.js:207/244/266` — `mongo-sort-injection`。仓库使用 **SQLite**（`node:sqlite`），无 MongoDB；`cellCompare`/`sortByName` 是静态比较函数，无用户输入注入面。
  - `backend/src/imm.js:32` — `hmacSha1`。阿里云 **OSS 签名协议强制固定用 HMAC-SHA1**，不可更换，否则无法调用 OSS。
  - 前后端测试伪凭据（`test-key`/`secret123` 等）。均为单测断言虚构值，非真实凭据；改值会破坏 API 契约断言，且 Mimosa 对改名后的变量同样拦截。
- **建议**：在 Mimosa 客户端为上述规则配置扫描豁免（按文件/路径/规则），以「生产严格校验 + 误报归类」为边界，避免每次提交被误拦截。
- **验证**：豁免后重新跑 Mimosa 扫描，确认真实风险被拦截、误报不再阻塞提交。

---

## 已归档

### 已修复缺陷

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
| BUG-25 | P2 | 前端使用未配置的 slate-700 色阶 | `frontend/tailwind.config.js` | 2026-08-30 |
| BUG-30 | P2 | 扩展名策略注释引用已不存在的实现 | `backend/src/extPolicy.js` | 2026-08-30 |
| BUG-31 | P2 | Primary Dark CTA 的 CSS 注释与实际圆角不一致 | `frontend/src/index.css` | 2026-08-30 |
| BUG-32 | P1 | 同步接口缺 admin 权限校验，匿名可触发库级改写 | `backend/src/routes/sync.js` | 2026-09-09 |
| BUG-33 | P1 | 生产环境 CORS 默认全开放（`origin: '*'`） | `backend/src/index.js` | 2026-09-09 |

### 已关闭改进项

| 编号 | 严重度 | 标题 | 处理位置 | 关闭日期 |
|---|---|---|---|---|
| （暂无） | | | | |
