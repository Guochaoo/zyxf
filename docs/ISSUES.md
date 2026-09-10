# 问题与改进追踪（ISSUES）

> 本文件是项目的「待办清单 + 处置档案」：追踪**缺陷**与**改进建议**，并沉淀关键决策依据。

## 阅读与维护约定

- **编号**：`BUG-<n>` 缺陷 · `IMPROVE-<n>` 改进。编号一经分配永不复用，因此**不连续属正常**（如 `BUG-22`、`BUG-28` 为空号）。
- **状态流转**：新条目先进「[1. 待处理](#1-待处理)」；处理完成后移入「[2. 已归档](#2-已归档)」并补记关闭日期。
- **关键处置记录**：设计取舍、踩坑、验证方法等需要留存的说明，统一写在「[3. 关键处置记录](#3-关键处置记录)」并**按主题**（而非编号）组织；归档表中以 `★` 标记哪些条目在此有说明。
- **条目字段**：缺陷 = 现象 / 根因 / 影响 / 修法 / 验证；改进 = 现状 / 根因 / 影响 / 建议 / 验证。条目首行是分类（`layer · component`），次行是受影响文件。
- **严重度**：`P0` 功能错误或崩溃风险 · `P1` 性能退化或逻辑隐患 · `P2` 健壮性 / 规范 / 边缘 case / 轻微改进。

## 当前进度

```yaml
updated: 2026-09-10
entries: 46           # 缺陷 35 + 改进 11
pending: 10           # 缺陷 6  + 改进 4
fixed: 36             # 已归档：缺陷 29 + 改进 7
```

---

## 1. 待处理

### 1.1 缺陷

**P0**

#### BUG-27 · 混合文件夹/文件的手工排序刷新后无法保持
`frontend/backend · 资料库排序`
`files: [frontend/src/pages/BrowsePage.jsx, backend/src/routes/folders.js]`

- **现象**：跨类型拖拽排序成功后，刷新仍固定先显示全部文件夹、再显示全部文件，交错顺序无法保持。
- **根因**：后端 `/reorder` 用单一交错索引同时给文件夹与文件赋 `sort_order`；`GET /:id/contents` 却分别返回 `folders`/`files` 两个数组，前端也固定先 folders 后 files，从不合并。
- **影响**：排序操作成功但刷新失效，与持久化结果不一致。
- **修法**：混排 → 后端合并返回按 `sort_order` 排序的 items，前端统一渲染；分组 → 禁止跨类型混排并分别提交排序。
- **验证**：补充文件夹/文件交错排序的 API + UI 集成测试，覆盖提交、刷新、再次拖拽。

**P1**

#### BUG-24 · 统计面板的未展示类型数量可能被低估
`frontend/backend · 统计面板`
`files: [backend/src/routes/stats.js, frontend/src/pages/DashboardPage.jsx]`

- **现象**：后端 `type_breakdown` 只返回前 8 类；前端只展示前 6 类，却用返回值长度减 6 计“其余”，真实类型超 8 时最多显示 `+2 类`。
- **根因**：接口截断数量与 UI 展示数量不是同一契约，前端无从得知被截断的真实总数。
- **影响**：类型覆盖范围统计失真，可能误导管理判断。
- **修法**：后端返回总类型数或将剩余类型聚合为 `other`，前端按接口字段展示。
- **验证**：用超过 8 种扩展名的统计 fixture 验证接口与面板文案。

**P2**

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

### 1.2 改进建议

> 编号不连续（03–09 已关闭归档），按分配顺序排列即可。

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

#### IMPROVE-10 · `/api/chat` 对匿名开放且允许客户端自带 baseUrl（受限公网代理面）
`backend · AI 对话`
`files: [backend/src/routes/chat.js, backend/src/llm.js, frontend/src/components/ChatComposer.jsx]`

- **现状**：服务端未配 `LLM_*` 时，任意匿名访客可让后端以自己指定的 `baseUrl` 发起请求并流式回传。
- **已缓解**：SSRF 防护仅允许 https 且拒绝回环/私网/链路本地/云元数据（BUG-20）；对话有短/长双层限流；前端在**服务端已配置 AI 时不再上传用户自带 Key**（后端本就忽略，避免密钥无谓外传）。
- **影响**：残余面是「受限公网 HTTPS 代理」——够不到内网，但可被用于以本站身份向公网发起请求。是否接受取决于产品对匿名 AI 的定位。
- **建议**：若不需要匿名 AI，给 `/api/chat` 叠加 `requireUser`；若保留匿名，可考虑只允许白名单内的 LLM 主机。
- **验证**：改后覆盖「匿名被拒」与「登录用户可用」两例，并确认前端不再发送被忽略的 Key。

#### IMPROVE-11 · helmet 的 CSP 处于关闭状态
`backend · 响应头`
`files: [backend/src/index.js]`

- **现状**：`helmet({ contentSecurityPolicy: false })`。当前前端无 `dangerouslySetInnerHTML`/`innerHTML`，未发现注入面；但登录 token 存于 localStorage，一旦出现 XSS 即可被窃取，CSP 是那道纵深防御。
- **根因**：早期为兼容 Vite/HMR 与内联样式而关闭，未再回补。
- **建议**：先梳理 `script-src`/`style-src` 与 Vite 构建产物对齐（内联样式/脚本），生产可先上 `Content-Security-Policy-Report-Only` 观察，再切正式策略。
- **验证**：开启后用浏览器控制台确认无 CSP 违规，且预览/图谱/聊天等重交互功能正常。

---

## 2. 已归档

> `★` = 在「[3. 关键处置记录](#3-关键处置记录)」有说明；**类别**列为便于按区域速查的单一归类。

### 2.1 已修复缺陷（29）

| 编号 | 严重度 | 类别 | 标题 | 修复位置 | 关闭日期 |
|---|---|---|---|---|---|
| BUG-01 | P0 | 前端 | 上传进度条永远不动，文件卡在「上传中」 | `frontend/src/components/UploadDialog.jsx` | 2026-08-28 |
| BUG-02 | P0 | 后端 | Express 4 异步路由不捕获 Promise 拒绝（后端崩溃风险） | `backend/src/routes/files.js`, `backend/src/routes/folders.js` | 2026-08-28 |
| BUG-03 | P0 | 后端 | 文件名/键含空格时，IMM 预览 token 签名错误 | `backend/src/imm.js` | 2026-08-28 |
| BUG-04 | P1 | 前端 | 知识图谱每次导航都全量重建并重新布局 | `frontend/src/components/KnowledgeGraph.jsx` | 2026-08-27 |
| BUG-05 | P1 | 前端 | 快速输入时搜索结果可能被过期响应覆盖 | `frontend/src/components/SearchBar.jsx` | 2026-08-27 |
| BUG-06 | P1 | 后端 | 批量/树接口 N+1 查询（后端多次往返） | `backend/src/routes/folders.js` | 2026-08-28 |
| BUG-07 | P1 | 后端 | 智能搜索每次输入全库扫描 | `backend/src/searchService.js` | 2026-08-28 |
| BUG-08 | P1 | 后端 | sync 全量扫描 + 逐行删除 | `backend/src/routes/sync.js` | 2026-08-28 |
| BUG-09 | P2 | 后端 | chat 在响应头已发送后才构建系统 Prompt | `backend/src/routes/chat.js` | 2026-08-28 |
| BUG-10 | P2 | 后端 | 搜索 PATH_PENALTY 与其注释矛盾（排序行为） | `backend/src/searchService.js` | 2026-08-28 |
| BUG-11 | P2 | 后端 | 文件名/路径含 `/` 与 `-` 导致 OSS key 冲突 | `backend/src/routes/folders.js` | 2026-08-28 |
| BUG-12 | P2 | 后端 | llm 在已输出文本后仍抛错 / 截断的 tool_call 被当作完整 | `backend/src/llm.js` | 2026-08-28 |
| BUG-13 | P2 | 后端 | IMM RPC 请求无超时 | `backend/src/imm.js` | 2026-08-28 |
| BUG-14 | P2 | 后端 | GROUP BY ext 依赖 SQLite 别名遮蔽（脆弱） | `backend/src/routes/stats.js` | 2026-08-27 |
| BUG-15 | P2 | 后端 | top_downloads 统计在重命名/删除后行不准 | `backend/src/routes/stats.js` | 2026-08-28 |
| BUG-16 | P2 | 后端 | 搜索把 parent_id = 0 当作根（死分支） | `backend/src/searchService.js`, `backend/src/routes/folders.js` | 2026-08-28 |
| BUG-17 | P2 | 前端 | 图标按钮缺 aria-label / type | `frontend/src/components/UploadDialog.jsx`, `frontend/src/components/SearchBar.jsx` | 2026-08-28 |
| BUG-18 | P2 | 前端 | sizeChip 命名不符合 React 组件约定 | `frontend/src/pages/BrowsePage.jsx` | 2026-08-28 |
| BUG-19 | P0 | 工程·CI | deploy workflow 使用可变 tag 的第三方 Action（供应链风险） | `.github/workflows/deploy.yml` | 2026-08-28 |
| BUG-20 | P1 | 安全 | /api/chat 允许用户控制上游 baseUrl（SSRF） | `backend/src/routes/chat.js`, `backend/src/llm.js` | 2026-08-28 |
| BUG-25 | P2 | 前端 | 前端使用未配置的 slate-700 色阶 | `frontend/tailwind.config.js` | 2026-08-30 |
| BUG-30 | P2 | 后端 | 扩展名策略注释引用已不存在的实现 | `backend/src/extPolicy.js` | 2026-08-30 |
| BUG-31 | P2 | 前端 | Primary Dark CTA 的 CSS 注释与实际圆角不一致 | `frontend/src/index.css` | 2026-08-30 |
| BUG-32 | P1 | 安全 | 同步接口缺 admin 权限校验，匿名可触发库级改写 | `backend/src/routes/sync.js` | 2026-09-09 |
| BUG-33 | P1 | 安全 | 生产环境 CORS 默认全开放（`origin: '*'`） | `backend/src/index.js` | 2026-09-09 |
| BUG-34 | P2 | 安全 | 改 `ADMIN_PASSWORD` 后旧密码仍可登录（`ensureAdmin` 不更新已存在用户） | `backend/src/db.js` | 2026-09-10 |
| ★ BUG-35 | P2 | 安全 | `qs` override 锁在漏洞版本（6.15.3 恰为漏洞区间上界），CI 每轮带 DoS 漏洞 | `backend/package.json`, `backend/package-lock.json` | 2026-09-10 |
| ★ BUG-36 | P1 | 安全 | 后端绑 `0.0.0.0`，伪造 `X-Forwarded-For` 可绕过全部限流（含登录爆破） | `backend/src/index.js` | 2026-09-10 |
| ★ BUG-37 | P1 | 安全 | `.env` 的 `DM_ACCESS_KEY_ID` 单字符错误，注册发信功能实际不可用 | `.env`（云端 RAM `zyxf-mail` 新密钥） | 2026-09-10 |

### 2.2 已关闭改进项（7）

| 编号 | 严重度 | 类别 | 标题 | 处理位置 | 关闭日期 |
|---|---|---|---|---|---|
| ★ IMPROVE-03 | P2 | 安全 | 同步接口权限由 admin-only 改为分层限流（游客/用户/管理员递增配额） | `backend/src/limiter.js`, `backend/src/routes/sync.js` | 2026-09-10 |
| ★ IMPROVE-04 | P1 | 安全 | OSS 凭证由 `PowerUserAccess` 改为专用 RAM 用户 + 单 bucket 最小权限 | `.env`（云端 RAM 策略 `zyxf-oss-app`）· `docs/DEPLOY.md §2.1` | 2026-09-10 |
| IMPROVE-05 | P2 | 安全 | 下载日志（含 ip/ua）无保留期，PII 无限期留存 | `backend/src/db.js`, `backend/src/index.js` | 2026-09-10 |
| IMPROVE-06 | P2 | 安全 | JWT 校验未固定算法，未显式 pin `HS256` | `backend/src/auth.js` | 2026-09-10 |
| IMPROVE-07 | P2 | 文档 | `.env.example` 管理员描述过时，且漏列 `ALLOWED_DEV_ORIGIN` | `.env.example` | 2026-09-10 |
| ★ IMPROVE-08 | P2 | 工程·CI | CI workflow 的 action 用可变 tag，未固定 commit SHA | `.github/workflows/ci.yml` | 2026-09-10 |
| ★ IMPROVE-09 | P1 | 安全 | `zyxf-mail` 持 `AliyunDirectMailFullAccess`（`dm:*`），远超实际所需 | 云端 RAM 策略 `zyxf-dm-send` | 2026-09-10 |

---

## 3. 关键处置记录

> 按**主题**组织（非编号顺序），记录「为什么这样做」与「怎么验证的」。归档表中带 `★` 的条目在此有对应说明。

### 3.1 凭证与最小权限

涉及：★IMPROVE-04（OSS）、★IMPROVE-09（DirectMail）、★BUG-37（DM 密钥损坏）

**OSS（IMPROVE-04）**：原凭证复用个人 `obsidian` RAM 用户，该用户挂着 `PowerUserAccess`（全产品管理权限），一旦泄漏影响面远超本项目。处置为新建专用用户 `zyxf-oss` + 自定义策略 `zyxf-oss-app`，只授 `xjtu-zyxf` bucket 的 `ListObjects`/`GetObject`/`PutObject`/`DeleteObject`/`CopyObject`（按后端实际调用面推导）。验证：新密钥访问 `xjtu-zyxf` 正常、访问另一 bucket `obsidian-aloha` 返回 `AccessDenied`——两者都满足才算最小权限生效。落地步骤见 `docs/DEPLOY.md §2.1`。

**DirectMail（IMPROVE-09）**：`backend/src/mail.js` 只调用 `SingleSendMail`，却授予 `dm:*`（含域名/模板/收件人管理、IP 防护等）。处置为新建 `zyxf-dm-send`（仅 `dm:SingleSendMail`），挂到 `zyxf-mail` 后摘掉 `AliyunDirectMailFullAccess`。验证：以该用户凭证探测，越权只读动作 `GetTrackList`（**参数传齐**）返回 `Forbidden`，`DescAccountSummary`/`GetUser`/`GetIpfilterList` 均被拒；策略内 `SingleSendMail` 返回收件地址校验错误而非权限错误。

> ⚠️ **探测坑**：`DescDomain`/`CreateTemplate`/`DeleteDomain` 返回的是**鉴权前的参数校验错误**，不能当作「策略放行」的证据——判定越权必须用参数完整、且能走到鉴权阶段的动作。

**BUG-37（审计中发现的真实故障）**：`.env` 的 `DM_ACCESS_KEY_ID` 与 `zyxf-mail` 真实值仅差**第 23 位**一个字符，且 secret 也已被替换过，导致注册验证码功能实际不可用（返回 `InvalidAccessKeyId.NotFound`）。处置：新建 AccessKey（旧 key 保留以免影响生产），先验证「越权被拒 + 发信放行」双条件，通过后才写入 `.env`。

> 📌 **教训（同源问题出现两次）**：OSS 与 DirectMail 各发生一次「凭证复制后未经验证直接落库」——前者 key 差第 14 位、后者差第 23 位。**凭证写入 `.env` 前必须先用只读调用验证**（OSS 用 `list`，DM 用 `SingleSendMail` 无效地址，看是否返回权限错误）。

### 3.2 暴露面与限流

涉及：★BUG-36（XFF 绕过）、★IMPROVE-03（同步接口分层限流）、关联 BUG-32

**BUG-36**：后端 `app.listen(PORT)` 默认绑 `0.0.0.0`，而 `app.set('trust proxy', 1)` 信任 `X-Forwarded-For`。实测证实：同一来源伪造不同 XFF 可任意重置限流桶（游客配额打满后换个伪造 IP 立即恢复 200），登录爆破/下载/同步限流全部可绕。生产本可依赖 nginx 覆盖 XFF + 安全组不放开 4000，但那是单层防御。处置：后端默认绑 `127.0.0.1`（`HOST` 可覆盖为 `0.0.0.0`）。后端始终在 nginx/Vite 代理之后，本地开发经 Vite `/api` 代理访问不受影响。

**IMPROVE-03**：BUG-32 曾以「`/api/sync` 挂 `requireAdmin`」关闭匿名改写风险，但浏览页「刷新」按钮对所有人可见，收紧后游客/普通用户点击必然 401/403，**权限呈现与 UI 不一致**。产品决策改为游客与登录用户均可触发同步，滥用面由分层限流约束（补偿性控制）：游客 2 次/分钟 < 登录用户 5 次/分钟 < 管理员豁免；登录用户按 user id 计数（避免同一 NAT 出口共用 IP 配额），游客按 IP 计数（`ipKeyGenerator` 归并 IPv6 子网）。验证：`backend/test/api.test.js` 覆盖三档。安全评审如认为写操作不应向匿名开放，回退方式是给 `syncLimiter` 叠加 `requireUser`。

### 3.3 依赖与供应链

涉及：★BUG-35（qs）、★IMPROVE-08（CI action）、关联 BUG-19

**BUG-35**：`package.json` 的 `overrides.qs` 曾为 `^6.15.3`，而漏洞区间恰为 `2.2.5 – 6.15.3`（6.15.3 是**上界**），等于没修；CI 用 `npm ci` 严格按 lockfile 安装，故每轮都带该 DoS 漏洞（`GHSA-x5fp-wj9c-mxmx`/`GHSA-4mjr-xmp4-gh2g`）。处置：override 改 `^6.16.0` 并更新 lockfile，`npm audit` 归零。

**IMPROVE-08**：`ci.yml` 的 `actions/*` 曾用可变 tag，现固定到 commit SHA，与 `deploy.yml` 同口径（BUG-19 的结论）。升级时用 `git ls-remote ... refs/tags/<tag>` 重新解析。

### 3.4 数据与隐私

涉及：IMPROVE-05

`download_logs` 含访问者 `ip`/`ua`，属可定位到个人的访问记录，此前无任何清理逻辑（永久留存）。处置：启动时按 `DOWNLOAD_LOG_RETENTION_DAYS`（默认 400，略大于仪表盘热力图的近一年窗口）删除超期行；无需保留访问明细时可调小。验证：`backend/test/securityFixes.test.js` 覆盖边界（401 天前删除、窗口内保留）。

### 3.5 外部变更观察（非本仓库改动）

审计期间账号下的 RAM 用户由 4 个变为 2 个：`obsidian` 与 `power-application-user` 消失（`ListUsers` 仅余 `zyxf-oss`、`zyxf-mail`，`GetUser` 对二者返回 `EntityNotExist.User`）。**本次会话未执行任何删除用户的命令**，判定为外部在控制台完成的清理。影响：账号权限面显著收窄（两个 `PowerUserAccess` 持有者均已移除）；但若 `obsidian-aloha` bucket 或其个人用途仍需使用，应确认替代凭证已就位。
