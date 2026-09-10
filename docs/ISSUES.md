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
entries: 47           # 缺陷 36 + 改进 11
pending: 0            # 缺陷 0  + 改进 0
fixed: 47             # 已归档：缺陷 36 + 改进 11
```

---

## 1. 待处理

### 1.1 缺陷

当前**无待处理缺陷**——BUG-21/23/24/26/27/29 已全部处置（见 [2.1 已修复缺陷](#21-已修复缺陷36)）。

### 1.2 改进建议

当前**无待处理改进建议**——IMPROVE-01/02/10 已全部处置（见 [2.2 已关闭改进项](#22-已关闭改进项11)）。

---

## 2. 已归档

> **类别**列为便于按区域速查的单一归类；`处置要点` 列记录该项的修法依据、踩坑与验证方式，无额外说明的填 `—`。

### 2.1 已修复缺陷（36）

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

### 2.2 已关闭改进项（11）

| 编号 | 严重度 | 类别 | 标题 | 处理位置 | 关闭日期 | 处置要点 |
|---|---|---|---|---|---|---|
| IMPROVE-01 | P2 | 前端 | 页面与组件职责集中，目录结构缺少页面级子模块边界 | `frontend/src/pages/BrowsePage.jsx`, `frontend/src/pages/Browse/*` | 2026-09-11 | 分两步落地。第一步（无状态展示迁移）：`DashboardPage` 640→367 行（抽出 `pages/Dashboard/ActivityHeatmap.jsx`、`pages/Dashboard/primitives.jsx`），`ChatComposer` 517→426 行（抽出 `components/Chat/parts.jsx`）。第二步（本次）：`BrowsePage` 821 行/28.6 KB → 容器 261 行/8.9 KB，`pages/Browse/` 下新增 `ItemList.jsx`(226)、`useItemDragDrop.js`(154)、`SortControl.jsx`(81)、`useOssSync.js`(51)、`useFolderContents.js`(49)、`RenameDialog.jsx`(44)、`primitives.jsx`(32)；`notifyFoldersChanged` 上收到 `utils.js` 供容器与拖拽 hook 共用。约束：DOM 顺序、class 名与请求时序保持不变（`refresh` 读 sort/order ref 的写法原样保留）。验证：新增 `frontend/src/test/BrowsePage.test.jsx` 10 例锁住拆分前行为，其中 2 例专测 BUG-27 的 `items` 合并视图（渲染顺序 + 拖拽重排基准）；前端 81 例、后端 160 例、`vite build` 全绿。 |
| IMPROVE-02 | P2 | 安全 | Mimosa 安全扫描剩余项：均为协议性要求/误报，需批量归类豁免 | `backend/src/routes/folders.js`, `backend/src/imm.js`, `backend/test/env.js`, `frontend/src/test/setup.js` | 2026-09-11 | 三条标记经复核全部是**误报或协议性约束**：`cellCompare`/`sortByName` 是无用户输入的静态比较器，且仓库用 SQLite（`node:sqlite`）而非 MongoDB，不存在 `mongo-sort-injection` 注入面；`imm.js` 的 HMAC-SHA1 是阿里云 OSS 签名协议**固定要求**，换算法会直接签不过；测试里的 `test-key`/`secret123` 是虚构断言值，改名既消不掉标记、还会破坏契约断言。处置：不再依赖外部扫描客户端的豁免配置，改为**就地豁免**——在被标记的代码旁写明判定依据（两个比较器、`hmacSha1`），并在 `backend/test/env.js`、`frontend/src/test/setup.js` 顶部统一声明测试凭据为虚构值，后续任何扫描或人工复核都能直接看到依据。 |
| IMPROVE-03 | P2 | 安全 | 同步接口权限由 admin-only 改为分层限流（游客/用户/管理员递增配额） | `backend/src/limiter.js`, `backend/src/routes/sync.js` | 2026-09-10 | 产品决策：游客与登录用户均可触发同步，滥用面由分层限流约束（补偿性控制）——游客 2 次/分钟 < 登录用户 5 次/分钟 < 管理员豁免；登录用户按 user id 计数（避免同一 NAT 出口共用 IP 配额），游客按 IP 计数（`ipKeyGenerator` 归并 IPv6 子网）。验证：`backend/test/api.test.js` 覆盖三档。安全评审如认为写操作不应向匿名开放，回退方式是给 `syncLimiter` 叠加 `requireUser`。 |
| IMPROVE-04 | P1 | 安全 | OSS 凭证由 `PowerUserAccess` 改为专用 RAM 用户 + 单 bucket 最小权限 | `.env`（云端 RAM 策略 `zyxf-oss-app`）· `docs/DEPLOY.md §2.1` | 2026-09-10 | 原凭证复用个人 `obsidian` RAM 用户，该用户挂着 `PowerUserAccess`（全产品管理权限），一旦泄漏影响面远超本项目。处置为新建专用用户 `zyxf-oss` + 自定义策略 `zyxf-oss-app`，只授 `xjtu-zyxf` bucket 的 `ListObjects`/`GetObject`/`PutObject`/`DeleteObject`/`CopyObject`（按后端实际调用面推导）。验证：新密钥访问 `xjtu-zyxf` 正常、访问另一 bucket `obsidian-aloha` 返回 `AccessDenied`——两者都满足才算最小权限生效。 |
| IMPROVE-05 | P2 | 安全 | 下载日志（含 ip/ua）无保留期，PII 无限期留存 | `backend/src/db.js`, `backend/src/index.js` | 2026-09-10 | `download_logs` 含访问者 `ip`/`ua`，属可定位到个人的访问记录，此前无任何清理逻辑（永久留存）。处置：启动时按 `DOWNLOAD_LOG_RETENTION_DAYS`（默认 400，略大于仪表盘热力图的近一年窗口）删除超期行；无需保留访问明细时可调小。验证：`backend/test/securityFixes.test.js` 覆盖边界（401 天前删除、窗口内保留）。 |
| IMPROVE-06 | P2 | 安全 | JWT 校验未固定算法，未显式 pin `HS256` | `backend/src/auth.js` | 2026-09-10 | — |
| IMPROVE-07 | P2 | 文档 | `.env.example` 管理员描述过时，且漏列 `ALLOWED_DEV_ORIGIN` | `.env.example` | 2026-09-10 | — |
| IMPROVE-08 | P2 | 工程·CI | CI workflow 的 action 用可变 tag，未固定 commit SHA | `.github/workflows/ci.yml` | 2026-09-10 | `ci.yml` 的 `actions/*` 曾用可变 tag，现固定到 commit SHA，与 `deploy.yml` 同口径（BUG-19 的结论）。升级时用 `git ls-remote ... refs/tags/<tag>` 重新解析目标 SHA。 |
| IMPROVE-09 | P1 | 安全 | `zyxf-mail` 持 `AliyunDirectMailFullAccess`（`dm:*`），远超实际所需 | 云端 RAM 策略 `zyxf-dm-send` | 2026-09-10 | `backend/src/mail.js` 只调用 `SingleSendMail`，却授予 `dm:*`（含域名/模板/收件人管理、IP 防护等）。处置为新建 `zyxf-dm-send`（仅 `dm:SingleSendMail`），挂到 `zyxf-mail` 后摘掉 `AliyunDirectMailFullAccess`。验证：以该用户凭证探测，越权只读动作 `GetTrackList`（**参数传齐**）返回 `Forbidden`，`DescAccountSummary`/`GetUser`/`GetIpfilterList` 均被拒；策略内 `SingleSendMail` 返回收件地址校验错误而非权限错误。⚠️ **探测坑**：`DescDomain`/`CreateTemplate`/`DeleteDomain` 返回的是**鉴权前的参数校验错误**，不能当作「策略放行」的证据——判定越权必须用参数完整、且能走到鉴权阶段的动作。 |
| IMPROVE-10 | P2 | 安全 | `/api/chat` 对匿名开放且允许客户端自带 baseUrl（受限公网代理面） | `backend/src/routes/chat.js`, `frontend/src/components/ChatComposer.jsx` · `frontend/src/i18n/zh.js` | 2026-09-11 | 处置：`/api/chat` 在「服务端未配置 `LLM_*` + 请求带自带 `llm` 配置 + 未登录」时返回 401，且判断放在 `resolveClientLlmConfig` **之前**——匿名请求一律不做 DNS 解析，避免被当成匿名 DNS 探测器（SSRF 防护只挡内网，挡不住「以本站身份访问公网」）。不带 `llm` 字段的匿名请求仍走原 503「AI 功能未配置」（登录也解决不了，提示更准确）；服务端已配置 `LLM_*` 时完全不受影响（客户端配置本就被忽略），生产主场景零变化。前端 `ChatComposer` 用 `useAuth()?.user` + `/chat/status` 提前禁用输入并提示 `chat.loginRequired`，不再等发送后才报错；无自带 Key 时不拦。验证：后端新增「匿名自带配置 → 401 且未触达上游」「服务端已配置时匿名照旧可用」两例，原客户端配置用例改为登录态；前端新增「未登录 + 已存自带 Key → 禁用并提示」「未登录 + 无自带 Key → 不提示」两例。 |
| IMPROVE-11 | P2 | 前端 | CSP 配置在 nginx 层（后端关闭有意为之）+ nosniff/Referrer-Policy | `frontend/nginx.conf`, `backend/src/index.js` · `docs/DEPLOY.md §4.2` | 2026-09-10 | CSP 必须由**托管 HTML 的那一层**下发——后端只服务 `/api`（JSON），在那儿配 CSP 对页面无效，所以后端 `contentSecurityPolicy: false` 是有意的（已加注释）。策略落在 `frontend/nginx.conf`：`script-src 'self'`（构建产物无内联脚本）、`style-src 'unsafe-inline'`（React 内联 style）、`connect-src https:`（API/OSS/用户自带 LLM）、`frame-src https:`（IMM 预览）、`font-src`（Google Fonts）；同时补 `nosniff` 与 `Referrer-Policy`。⚠️ **nginx 坑**：`add_header` 不会被子级 location 继承——凡自己写了 `add_header` 的 location（如 `/assets/` 的长缓存）都必须**重复声明**安全头，否则静默丢失（已在该 location 重复声明）。 |

> **外部变更观察（非本仓库改动）**：审计期间账号下的 RAM 用户由 4 个变为 2 个——`obsidian` 与 `power-application-user` 消失（`ListUsers` 仅余 `zyxf-oss`、`zyxf-mail`，`GetUser` 对二者返回 `EntityNotExist.User`）。**本次会话未执行任何删除用户的命令**，判定为外部在控制台完成的清理。影响：账号权限面显著收窄（两个 `PowerUserAccess` 持有者均已移除）；但若 `obsidian-aloha` bucket 或其个人用途仍需使用，应确认替代凭证已就位。
