# 问题与改进追踪（ISSUES）

> 本文件是项目的「待办清单 + 处置档案」：追踪**缺陷**与**改进建议**，并沉淀关键决策依据。

## 阅读与维护约定

- **编号**：`BUG-<n>` 缺陷 · `IMPROVE-<n>` 改进。编号一经分配永不复用，因此**不连续属正常**（如 `BUG-22`、`BUG-28` 为空号）。
- **状态流转**：新条目先进「[1. 待处理](#1-待处理)」；处理完成后移入「[2. 已归档](#2-已归档)」并补记关闭日期。
- **归档表是索引，不是文档**：只留编号 / 严重度 / 类别 / 标题 / 位置 / 日期，一行一条。不显眼的「为什么」写成修复处的**一行**注释（`grep -rn "BUG-54" backend/src frontend/src`），其余细节看 commit message；不为历史条目批量回填注释，也不写多段式说明。
- **待处理条目的头部固定两行**：第一行 `#### 编号 · 标题`；第二行 `**影响范围**：文件路径 · 文件路径（层级 · 类别）`——路径在前便于直接点开文件，类别放括号里，不用 `backend · 性能` + `files: [...]` 这种要两次解读的写法。
- **待处理条目的正文写全背景**（现状 / 影响 / 修法 / 验证）：给「以后接手的人」看，保留具体数值、复现路径、约束与踩坑，不为了短而丢信息。
- **严重度**：`P0` 功能错误或崩溃风险 · `P1` 性能退化或逻辑隐患 · `P2` 健壮性 / 规范 / 边缘 case / 轻微改进。

## 当前进度

```yaml
更新日期: 2026-09-11
条目总数: 129        # 缺陷 92 + 改进 37
待处理: 7            # 缺陷 2 + 改进 5（26 暂缓；31/32 已建档、待决策后修；33 为可访问性权衡；34 为视觉一致性）
已归档: 122          # 缺陷 90 + 改进 32
# 本批（SPA 深链 404）：生产 nginx（宝塔托管）缺 `location / { try_files ... }`，刷新任意前端路由都 404。
#   已写入面板「伪静态」文件并 reload，DEPLOY.md 补宝塔专属一节（BUG-97）。
# 本批（预览故障复盘）：线上「预览服务出错」定位为两处配置问题——① 生产 .env 里的 AccessKey 已被删除（OSS 回
#   InvalidAccessKeyId，上传/下载/预览全线失效）；② 该 RAM 用户缺 imm:GenerateWebofficeToken 授权。DEPLOY.md
#   补：IMM 授权 statement（含「不支持资源级授权、Resource 必须为 *」）、密钥轮换必须同步服务器 .env 的告警、
#   排查表按 InvalidAccessKeyId / AccessDenied / InvalidProjectName 分流（IMPROVE-36/37，均已关闭）。
# 本批（设置页改造）：修复 BUG-95（保存不校验三项齐全——提示文案承诺了却没人执行），并调左栏样式
#   （灰底 #ECECEE + 「设置」标题、条目交互统一为「往白靠」两档，见 DESIGN.md §4）；另把白屏兜底
#   改成「友好提示 + 刷新按钮，堆栈只在开发环境展开」（IMPROVE-35，抽到 bootError.js 并补测试）。
# 设计规范审计批：DESIGN.md 逐段中文化并逐条对照代码校正，删掉未实现的 Vercel 通用内容；新增
#   BUG-93（热力图星期标签错位一天）、BUG-94（侧栏时长/缓动的类名被模板插值拼掉，退化成 150ms）
#   与 IMPROVE-34（聊天未知类型徽章被品牌色规则染黑），按「只改文档」口径只建档未动代码。
#   注：该批编号初版误用 91/92（与既有后端条目重号），已在本批更正为 93/94。
# 第五批（上一轮）：IMPROVE-15/16/17/20/24 落地并归档 —— 目录树快照与前端去重、密码哈希改 scrypt、
# 子树搬迁阈值、搜索截断契约。本批新增 IMPROVE-31/32（预览凭证配额、搜索与统计缺专属限流）仅建档。
# 另新增 IMPROVE-33：按「无界」设计去掉表单控件的聚焦视觉（用户要求），记录其可访问性权衡。
# 条目总数 = 待处理 + 已归档；已归档数 = 2.1 与 2.2 两张表的行数之和。
```

---

## 1. 待处理

### 1.1 缺陷

上一轮审计新发现的 11 条缺陷已全部处置并归档（BUG-54～61、64/66/67/79/85～90 见 [2.1 已修复缺陷](#21-已修复缺陷)（89））；设计规范审计批新发现 **2 条**（BUG-93、BUG-94），只建档、未改代码；设置页改造批新发现的 **1 条**（BUG-95）当轮修复并归档；本轮（预览/下载故障复盘）新发现的 **1 条**（BUG-96）也已当轮修复。

> 审计方式：上一轮为 9 路并行只读审计（安全/后端正确性/后端基础设施/性能/前端状态/前端组件/重复与死代码/工程配置与文档），再由人工逐条读码复核、剔除误报，另做了 4 路针对「SQL 与接口契约 / 前端状态与可访问性 / 安全与文件处理 / 冗余与工程配置」的复核审计。本轮是 4 路并行只读审计 + 2 路对抗性复核，逐段核对 `docs/DESIGN.md` 与代码（色值 / 字号 / 圆角 / 断点 / 组件行为 / 生成产物），发现 2 条真实缺陷（BUG-91、BUG-92）与 1 条视觉一致性改进（IMPROVE-34），其余差异均为文档描述过时（已在 DESIGN.md 内修正）。

#### BUG-93 · 下载热力图的星期标签比格子错开一天（周一开头的网格配了周日开头的字典）
**影响范围**：`frontend/src/pages/Dashboard/ActivityHeatmap.jsx` · `frontend/src/i18n/zh.js` · `frontend/src/i18n/en.js`（前端 · 正确性 / i18n）

- **现状**：网格由 `buildWeeks` 按**周一开头**构建（`ActivityHeatmap.jsx:38` 的 `gridStart = first - ((new Date(first).getDay() + 6) % 7) * DAY_MS`，并补齐两端成整周），但左侧星期标签是把字典数组按下标直接取：`dashboard.weekdays` 在 `zh.js:128` 是 `['日','一','二','三','四','五','六']`、`en.js:129` 是 `['S','M','T','W','T','F','S']`，**都是周日开头**；渲染时 `weekdays.map((name, i) => i % 2 === 0 ? name : '')`（`ActivityHeatmap.jsx:182-190`）用的是网格行号。于是周一起的第一行标成「日」、第三行「二」、第五行「四」、第七行「六」——**每行都比真实星期早一天**。代码注释已自认 `labels may not align perfectly`，但未修。
- **影响**：统计面板的下载热力图左侧标签整体错位一天，按标签读日期会读错星期；中英双语都错（两本字典都是周日开头）。
- **修法**：让标签按网格的真实星期取。最省事的是按 `(i + 1) % 7` 取（周日开头数组里「周一」在下标 1），或把两本字典都改成周一起头（后者要同步所有 `dashboard.weekdays` 读取点）。隔行显示策略（`i % 2 === 0`）保持不变。
- **验证**：给标签渲染补一条单测，断言「第一行（周一）标签是『一』、最后一行（周日）标签是『日』」；改完在中英两种语言下各看一眼热力图左侧标签。

#### BUG-94 · 左栏开合的时长 / 缓动被写成模板插值类名，Tailwind 扫不到 → 实际退化成默认 150ms
**影响范围**：`frontend/src/App.jsx`（前端 · 视觉 / 构建）

- **现状**：`App.jsx:85-86` 定义 `SIDEBAR_MS = 320`、`SIDEBAR_EASE = EASE_COLLAPSE`（`cubic-bezier(0.22, 1, 0.36, 1)`），然后在**模板字符串**里拼类名：中列 padding 过渡 `lg:duration-[${SIDEBAR_MS}ms] lg:ease-[${SIDEBAR_EASE}]`（`App.jsx:152`）、左栏滑入滑出 `transition-transform lg:duration-[...] lg:ease-[...]`（`:191`）、品牌行图标淡出（`:199`）、收起后浮出的展开按钮（`:220`）。Tailwind 是**静态扫描源码文本**的：插值处构建期不存在字面量类名，这些类一个都没生成。已实测（全新 `npm run build`，产物仍是 `dist/assets/index-DVDdAZCL.css`）：全文搜不到 `320ms`，也搜不到 `cubic-bezier(0.22,1,0.36,1)`；对照之下，同文件里字面量写的 `duration-[360ms]`、`duration-[180ms]`、`ease-[cubic-bezier(0.22,1,0.36,1)]`（关于页）与 `lg:transition-[padding]`、`lg:pl-[calc(250px+1rem)]` 都正常生成——即问题只在插值那几处。
- **影响**：左栏滑入/滑出、展开按钮淡入淡出、中列 padding 收放全部退化成 Tailwind `transition-*` 的默认 150ms + 默认缓动，与设计规范写的 320ms + `EASE_COLLAPSE` 不符：动效比意图更急、更「弹」。功能与布局正常，只是观感，因此长期没暴露。
- **修法（二选一）**：① 把这几处改成字面量类名（`lg:duration-[320ms] lg:ease-[cubic-bezier(0.22,1,0.36,1)]`），或把这几个类名加进 `tailwind.config.js` 的 `safelist`；② 更稳的做法是绕开类名，直接用内联样式驱动：`style={{ transitionDuration: `${SIDEBAR_MS}ms`, transitionTimingFunction: SIDEBAR_EASE }}`（保留 `transition-transform` / `transition-opacity` 这类字面量类）。⚠️ `KnowledgeGraph` / `ChatComposer` 的 `duration-[360ms]` 是字面量，别一起改坏。
- **验证**：`npm run build` 后 grep 产物 CSS，应能搜到 `320ms` 与 `cubic-bezier(0.22,1,0.36,1)`；手动收起/展开左栏，确认是 320ms 的从容滑动而不是 150ms 的急停（可临时把 `SIDEBAR_MS` 调到 1200 对比）。

---

### 1.2 改进建议

上一轮审计新发现的 14 条改进项里，已处置 13 条（13/14/15/16/17/18/19/20/21/22/23/24/25，见 [2.2 已关闭改进项](#22-已关闭改进项)（29））；另有 **1 条暂缓**（26）、**2 条来自复核审计、本轮只建档待决策**（31/32）、**1 条设计取舍记账**（33：表单控件无聚焦视觉），以及本轮（设计规范审计）新增的 **1 条**（34：聊天未知类型徽章被品牌色覆盖规则染黑）。这几条都写全背景，便于以后接手时不必重新调研。

#### IMPROVE-31 · 预览凭证（IMM WebOffice token）匿名可签发，且与下载共用配额
**影响范围**：`backend/src/routes/files.js` · `backend/src/imm.js` · `frontend/src/components/Preview/index.jsx`（后端 · 配额 / 安全）

- **现状**：`GET /api/files/:id/weboffice-token` 与 `POST /api/files/:id/weboffice-refresh` 都挂在 `downloadLimiterShort`（60 次/分钟/IP）+ `downloadLimiterLong`（240 次/小时/IP）上，**不要求登录**（下载匿名可用是有意的产品设计，见 BUG-32 的处置记录）。每次命中都会真调一次阿里云 IMM `GenerateWebofficeToken`（付费转换），并把返回的 `WebofficeURL + AccessToken` 交给浏览器。
- **影响**：① 一个匿名 IP 每小时可触发 240 次付费 IMM 调用，遍历 `file.id` 即可对全库可预览文件放量；② 返回的预览 URL 在 30 分钟有效期内**不绑定请求者**，转发即成为可复现的整库读取入口，而这条链路不走本站，下载日志与 IP 限流都拦不住；③ 与 `/api/files/:id/url` 共用同一个桶配额，正常下载会被预览流量挤占。
- **修法（三条路线，代价从小到大）**：① 给预览类端点单独一层更紧的匿名配额（如 10 次/分钟/IP），与下载桶分开；② 预览凭证要求登录（下载保持匿名），前端已有「未登录就提示」的先例（`ChatComposer` 的 `loginRequired`）；③ 保持匿名预览但抬高「按 id 遍历」的成本——对同一 IP 的**不同 file.id** 计数（同一文件反复预览不计），或让 IMM 预览走服务端中转而不直接下发 URL。
- **验证**：断言「匿名连续请求预览 token 到配额后 429，而下载配额不受影响」；若走路线 ②，补「匿名 → 401、登录用户 → 200」。⚠️ 动手前先确认产品是否允许匿名预览（当前是允许的）。

#### IMPROVE-32 · `/api/search` 与 `/api/stats` 没有专属限流，只有全局兜底 300 次/分钟
**影响范围**：`backend/src/routes/search.js` · `backend/src/routes/stats.js` · `backend/src/index.js`（后端 · 性能 / 配额）

- **现状**：全站唯一的匿名限流是 `index.js:52` 的 `publicLimiter`（300 次/分钟/IP），`/api/search`、`/api/stats`、`/api/stats/heatmap` 都没有自己的配额。而这三条都是**全库扫描**：搜索对每个名称跑 `matchScore`（含拉丁串时还进 pinyin-pro 的 DP 匹配，BUG-40 已确认开销随查询长度线性增长）；stats 概览与 heatmap（按天聚合近一年）同样要扫全表。
- **影响**：单 IP 每分钟 300 次全表扫描即可把单线程事件循环压满（`/api/health`、下载、上传一并排队）。对比参照：`/api/chat` 是 6 次/分钟、`/api/sync` 游客 2 次/分钟——昂贵端点的分层配额口径已经存在，只是这两类没跟上；`stats.js` 的注释写着「rate limiter covers anonymous scraping」，实际依赖的就是那层 300/分钟兜底。
- **修法**：给这两类挂 `tieredLimiter`（游客最紧、登录更宽、管理员豁免，与 sync/chat 同口径）：建议搜索 30 次/分钟、stats/heatmap 20 次/分钟，登录用户可放宽（仪表盘本身是登录后高频访问的页面）。注意 `/api/search` 也被 AI 工具复用（`chat.js` 直接调服务函数、不走 HTTP），限流只影响 HTTP 路径。
- **验证**：断言「匿名打满配额后 429、登录用户仍可访问、管理员豁免」，并确认前端在 429 时给出可读提示而不是一直转圈。

#### IMPROVE-26 · sync 只回收「死根子树」，挂在活根下的空文件夹永不剪枝（**暂缓，改动有破坏性风险**）
**影响范围**：`backend/src/routes/sync.js`（后端 · 同步）

- **现状**：剪枝循环只遍历 `parent_id IS NULL` 的根；对「活根」（仍有 placeholder 或有文件）调用 `folderAlive` 时，不会把它内部已死的子文件夹收进待删集合，于是这类空文件夹一直留在库里（与函数自述的 "prunes folders that are empty" 不符）。
- **影响**：库内缓慢积累空文件夹，侧边栏出现点进去什么都没有的节点；也会让 `/folders/tree` 的响应与目录树 UI 变脏。
- **修法（暂缓原因）**：改成逐节点剪枝会把「既没有 placeholder 对象、又没有文件」的文件夹全部删除，而历史上存在「建库时未写 placeholder」的部署，会被整体清空（这是破坏性操作，无法从 DB 单独判定安全）。可行路线：先核对线上 placeholder 覆盖率（`sync` 加只统计不删除的干跑模式观察一轮），或改为「仅当文件夹已存在超过 N 天且为空时剪枝」。
- **验证**：若实施，先加干跑（只统计不删除）观察一轮同步结果，再在测试库上验证「活根下的空文件夹被回收、有 placeholder 的保留」。

#### IMPROVE-33 · 表单控件去掉聚焦视觉后，键盘用户失去可见焦点指示（可访问性权衡）
**影响范围**：`frontend/src/index.css` · `frontend/src/components/SettingsModal.css`（前端 · 可访问性）

- **现状**：按「无界」设计并应人类要求，输入框聚焦**不再有任何视觉变化**——`index.css:427` 的 `.app-theme input:focus` 只保留常驻态的 shadow-as-border（+`outline: none`，否则浏览器会画默认焦点环），全局 `:focus-visible` 蓝色 2px outline 也已从 `input/select/textarea` 收回，只留给按钮/链接；设置弹窗的 `.settings-input` 同理（浅灰底 `#F5F5F5`，无描边无光晕）。
- **影响**：用 Tab 键在表单里移动时（设置弹窗 3 个字段、重命名对话框、上传对话框、资料库搜索等），**看不到焦点在哪**；鼠标用户无感，键盘/读屏用户需要靠记忆位置。这是有意的视觉取舍，不是遗漏——本条目只是把它显式记账，避免以后被当成 bug 反复「修」回去。
- **修法（若要兼顾）**：只对键盘路径给最小提示，例如 `input:focus-visible { box-shadow: var(--line-strong) 0 0 0 1px }`（细线）或底色加深一档（`#EFEFEF` → `#E8E8E8`），鼠标点击不触发（`:focus-visible` 天然区分）；也可只在标签文字上做加粗/变色。⚠️ 改动前先确认人类是否接受「鼠标聚焦也出现细线」。
- **验证**：`Tab` 键在表单内移动能看出当前字段；鼠标点击不产生任何视觉变化；`npm test` 全绿（现有 115 条测试未断言聚焦样式）。

#### IMPROVE-34 · 聊天文件胶囊的「未知类型」徽章被品牌色覆盖规则染成纯黑
**影响范围**：`frontend/src/components/Chat/parts.jsx` · `frontend/src/index.css`（前端 · 视觉一致性）

- **现状**：AI 回复里的文件胶囊按族别给徽章上色——word/ppt/txt 橙（`--orange`）、excel 绿（`--green`）、pdf 红（`--red`）、archive 与文件夹灰 `#808080`；未知扩展名回落到 `DEFAULT_TONE = 'bg-brand-500'`（`parts.jsx:85`，取用于 `parts.jsx:94`）。但 `index.css:253-257` 的 `.app-theme .bg-brand-500, .app-theme .bg-brand-600 { background: var(--ink) !important }` 会把这个填充改成墨黑，于是「未知类型」徽章渲染成纯黑——既不是品牌蓝（作者的本意），也不是中性灰（`archive` / 文件夹用的那种）。
- **影响**：助手引用未知后缀文件（如 `.md`、未列入族别表的自定义后缀）时，胶囊上会出现一个突兀的黑色方块徽章，和同排其他族别色不一致；读起来像「强调」而不是「未知」。
- **修法（二选一）**：① 把 `DEFAULT_TONE` 换成中性灰 `bg-[#808080]`，与 `archive` / 文件夹同色，语义上更贴「未知」；② 若要保留品牌蓝语义，则改用不受覆盖规则影响的内联样式或新增一个真正生效的蓝色 token（不要继续用 `bg-brand-*`——它在本项目里永远渲染为墨黑，见 `docs/DESIGN.md` §2）。
- **验证**：在聊天里让助手引用一个未知后缀文件，确认徽章为中性灰且与其余族别色亮度一致；`npm test` 全绿（现有测试未断言该色调）。

---

## 2. 已归档

> 归档表只作索引（编号 / 严重度 / 类别 / 标题 / 位置 / 日期）。修法依据、踩坑与验证方式写在**代码注释**里（`grep -rn "BUG-54" backend/src`）与 commit message 中。

### 2.1 已修复缺陷（90）

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
| BUG-35 | P2 | 安全 | `qs` override 锁在漏洞版本（6.15.3 恰为漏洞区间上界），CI 每轮带 DoS 漏洞 | `backend/package.json`, `backend/package-lock.json` | 2026-09-10 |
| BUG-36 | P1 | 安全 | 后端绑 `0.0.0.0`，伪造 `X-Forwarded-For` 可绕过全部限流（含登录爆破） | `backend/src/index.js` | 2026-09-10 |
| BUG-37 | P1 | 安全 | `.env` 的 `DM_ACCESS_KEY_ID` 单字符错误，注册发信功能实际不可用 | `.env`（云端 RAM `zyxf-mail` 新密钥） | 2026-09-10 |
| BUG-21 | P2 | 前端 | 前端生产 JS 单块过大，缺少路由级代码分割 | `frontend/src/App.jsx`, `frontend/vite.config.js` | 2026-09-10 |
| BUG-23 | P2 | 前端 | 前后端宏格式扩展名策略不一致 | `frontend/src/utils.js`（已对齐后端白名单，b549a73 已修） | 2026-09-10 |
| BUG-24 | P2 | 后端 | 统计面板未展示类型数量被低估（截断与 UI 展示契约不一致） | `backend/src/routes/stats.js`, `frontend/src/pages/DashboardPage.jsx` | 2026-09-10 |
| BUG-26 | P2 | 后端 | 文件 MIME 元数据与扩展名派生值不一致 | `backend/src/routes/files.js`, `backend/src/routes/sync.js`, `frontend/src/api.js` | 2026-09-10 |
| BUG-27 | P0 | 前后端 | 混合文件夹/文件的手工排序刷新后无法保持 | `backend/src/routes/folders.js`, `frontend/src/pages/BrowsePage.jsx` | 2026-09-10 |
| BUG-29 | P2 | 文档 | README 声明的最低 Node 版本已过时 | `README.md`, `backend/package.json`, `frontend/package.json` | 2026-09-10 |
| BUG-38 | P2 | 工程·本地开发 | Vite dev server 因源码目录出现临时文件而 EBUSY 崩溃 | `frontend/vite.config.js` | 2026-09-11 |
| BUG-39 | P1 | 安全 | SSRF 白名单漏掉整个 IPv6 内网地址族，BUG-20 的防护可被绕过 | `backend/src/llm.js` | 2026-09-11 |
| BUG-40 | P1 | 安全 | `/api/search` 的 q 无长度上限：一条匿名请求可占住事件循环数秒 | `backend/src/routes/search.js`, `backend/src/searchService.js`, `backend/src/searchMatch.js` | 2026-09-11 |
| BUG-41 | P1 | 后端 | 文件移动缺 oss_key 冲突检查：先覆盖目标对象、再以 500 失败（他人文件内容被替换） | `backend/src/routes/files.js` | 2026-09-11 |
| BUG-42 | P1 | 后端 | 文件名可含路径分隔符：key 归一化碰撞导致「覆盖后失败」与静默数据丢失 | `backend/src/routes/files.js` | 2026-09-11 |
| BUG-43 | P2 | 安全 | cleanup-upload 未配置前缀时可删除桶内任意对象，且不检查该对象是否已被引用 | `backend/src/routes/files.js` | 2026-09-11 |
| BUG-44 | P2 | 安全 | 不可预览类型绕过后端 default-deny 内联策略：`force_download` 前端零消费，预览弹层直接导航 OSS 对象 | `backend/src/oss.js`, `backend/src/routes/files.js`, `frontend/src/components/Preview/Body.jsx`, `frontend/src/components/Preview/UnknownViewer.jsx` | 2026-09-11 |
| BUG-45 | P2 | 后端 | `?sort=constructor` 命中原型链导致 500 | `backend/src/routes/folders.js` | 2026-09-11 |
| BUG-46 | P2 | 后端 | `DELETE /api/folders/:id` 不校验存在性：返回 200、计数虚报，并会删除桶里「前缀根」这一伪键 | `backend/src/routes/folders.js` | 2026-09-11 |
| BUG-47 | P2 | 后端 | 搜索快照缓存的失效函数从无调用方：增删改后 30 秒内搜索陈旧 | `backend/src/searchService.js`, `backend/src/routes/files.js`, `backend/src/routes/folders.js`, `backend/src/routes/sync.js` | 2026-09-11 |
| BUG-48 | P2 | 后端 | sync 先统计 repaired 再删失联行：同一批记录同时计入 repaired 与 removed | `backend/src/routes/sync.js` | 2026-09-11 |
| BUG-49 | P2 | 后端 | `mimeOf` 覆盖不全：30 个白名单扩展名里 20 个派生为 null，与 BUG-26 的契约不一致 | `backend/src/mime.js` | 2026-09-11 |
| BUG-50 | P2 | 安全 | `ppsm`（宏格式）留在白名单内，与「拒绝宏格式」的自述策略矛盾 | `backend/src/extPolicy.js`, `frontend/src/utils.js` | 2026-09-11 |
| BUG-56 | P1 | 前端 | `useFolderContents` 无竞态守卫：过期响应覆盖新目录数据 | `frontend/src/pages/Browse/useFolderContents.js` | 2026-09-11 |
| BUG-62 | P2 | 前端 | 中文输入法选词回车被当成发送 | `frontend/src/components/ChatComposer.jsx` | 2026-09-11 |
| BUG-63 | P2 | 前端 | `chatStream` 走原生 fetch，401 不清理 token（与 axios 路径不一致） | `frontend/src/api.js` | 2026-09-11 |
| BUG-65 | P2 | 前端 | 失败提示文案与操作不匹配（新建/加载/同步都提示「移动失败」） | `frontend/src/pages/BrowsePage.jsx`, `frontend/src/pages/Browse/useFolderContents.js`, `frontend/src/pages/Browse/useOssSync.js` | 2026-09-11 |
| BUG-68 | P2 | 前端 | `zh.js` 同一对象内重复定义 `actionFailed` 与 `today` | `frontend/src/i18n/zh.js`, `frontend/src/test/i18n.test.js` | 2026-09-11 |
| BUG-74 | P1 | 文档 | `DEPLOY.md` 的备份命令在 WAL 模式下备份出空库 | `docs/DEPLOY.md` | 2026-09-11 |
| BUG-75 | P2 | 后端 | 用户可建名为 `.preview` 的文件夹，其内容会被下一次 sync 永久删除记录 | `backend/src/routes/folders.js` | 2026-09-11 |
| BUG-76 | P1 | 工程·CI | CI 只在 PR→main 触发，`dev` 上开发全程零校验（假绿） | `.github/workflows/ci.yml`, `README.md` | 2026-09-11 |
| BUG-77 | P1 | 工程·部署 | 部署健康检查失败无回滚，线上停在新修订持续 502 | `.github/workflows/deploy.yml`, `docs/DEPLOY.md` | 2026-09-11 |
| BUG-78 | P2 | 安全 | 生产 CSP 的 `style-src` 缺 `fonts.googleapis.com`，About 页字体样式表被静默拦掉 | `frontend/nginx.conf`, `docs/DEPLOY.md` | 2026-09-11 |
| BUG-80 | P2 | 工程·本地开发 | nodemon 的 watcher 因同一类原子写临时文件 EBUSY 而退出，后端整站停服 | `backend/package.json` | 2026-09-11 |
| BUG-52 | P1 | 安全 | 改 `ADMIN_USER` 不回收既有管理员行：旧用户名 + 旧密码仍能登录为 admin | `backend/src/db.js`, `backend/test/ensureAdmin.test.js` | 2026-09-11 |
| BUG-73 | P2 | 安全 | `users.role` 列默认值是 `'admin'`（与「注册即普通用户」的授权模型相反） | `backend/src/db.js`, `backend/test/ensureAdmin.test.js` | 2026-09-11 |
| BUG-51 | P1 | 安全 | JWT 无撤销机制：改密码 / 降权 / 删号后旧 token 在有效期内仍持有全权 | `backend/src/auth.js`, `backend/src/db.js`, `backend/src/routes/auth.js`, `backend/test/auth.test.js` | 2026-09-11 |
| BUG-53 | P1 | 安全 | 登录限流只按出口 IP 计数：NAT 下连坐封锁，对单账号又无上限 | `backend/src/routes/auth.js`, `backend/test/authHardening.test.js` | 2026-09-11 |
| BUG-69 | P2 | 安全 | `/register/code` 先写库再发信：发送失败仍占用 60 秒冷却与当日额度，并作废用户手上的有效码 | `backend/src/routes/auth.js`, `backend/test/authHardening.test.js` | 2026-09-11 |
| BUG-70 | P2 | 安全 | 登录响应时间可稳定区分账号是否存在（实测 1.3ms vs 44.8ms） | `backend/src/routes/auth.js`, `backend/test/authHardening.test.js` | 2026-09-11 |
| BUG-71 | P2 | 安全 | `/register` 的用户名枚举 oracle：同一枚合法验证码可无限复用 | `backend/src/routes/auth.js`, `backend/src/db.js`, `backend/test/authHardening.test.js` | 2026-09-11 |
| BUG-72 | P2 | 安全 | bcrypt 静默截断到 72 字节，注册校验却按字符数：40 个汉字的密码只有前 24 个生效 | `backend/src/routes/auth.js`, `backend/test/authHardening.test.js` | 2026-09-11 |
| BUG-57 | P1 | 前端 | 仪表盘切换时间区间时过期响应覆盖新区间统计 | `frontend/src/pages/DashboardPage.jsx` | 2026-09-11 |
| BUG-58 | P1 | 前端 | 设置里保存大模型配置后，常驻右栏仍用挂载时读到的旧配置 | `frontend/src/llmConfig.js`, `frontend/src/components/ChatComposer.jsx` | 2026-09-11 |
| BUG-59 | P1 | 前端 | StaggeredMenu 的 `busyRef` 被 kill 的补间永久锁死，之后菜单打不开 | `frontend/src/components/StaggeredMenu.jsx` | 2026-09-11 |
| BUG-60 | P2 | 前端 | OfficeViewer 的 SDK 加载失败被模块级 Promise 永久缓存，本次会话无法恢复 | `frontend/src/components/Preview/OfficeViewer.jsx` | 2026-09-11 |
| BUG-61 | P1 | 前端 | 流式对话在「清空会话 / 组件卸载」时不中止，且迟到的增量继续入账 | `frontend/src/components/ChatComposer.jsx` | 2026-09-11 |
| BUG-64 | P2 | 前端 | 打开全库知识图谱后组件卸载，`graphFull` 不复位 → 悬浮菜单永久消失 | `frontend/src/components/KnowledgeGraph.jsx` | 2026-09-11 |
| BUG-67 | P2 | 前端 | 知识图谱的 d3 模拟停掉后 `tick` 监听未解绑，卸载后仍触发 setState | `frontend/src/components/KnowledgeGraph.jsx` | 2026-09-11 |
| BUG-79 | P2 | 工程·部署 | `deploy/zyxf.service` 以 `User=www` 运行，文档没有任何目录属主/权限步骤 | `docs/DEPLOY.md`, `README.md` | 2026-09-11 |
| BUG-81 | P1 | 前端 | 搜索失败被空 catch 吞掉，下拉继续展示上一次查询的结果 | `frontend/src/components/SearchBar.jsx` | 2026-09-11 |
| BUG-82 | P2 | 前端 | `useFolderTree` 缺请求序号守卫：连续变更时旧响应覆盖新目录树 | `frontend/src/hooks/useFolderTree.js` | 2026-09-11 |
| BUG-83 | P2 | 前端 | 仪表盘热力图加载漏了 BUG-57 的守卫（旧响应覆盖 + 卸载后 setState） | `frontend/src/pages/DashboardPage.jsx` | 2026-09-11 |
| BUG-84 | P1 | 安全 | 对象段名不拦 `..`：OSS key 可越出 `OSS_KEY_PREFIX`，cleanup-upload 的前缀白名单形同虚设 | `backend/src/storagePath.js`, `backend/src/routes/files.js`, `backend/test/auditFixes.test.js` | 2026-09-11 |
| BUG-85 | P1 | 后端 | 上传注册只按原始 name 查重、不按算出的 oss_key 查重，而 key 归一化不是单射 → 覆盖既有对象后才 409 | `backend/src/routes/files.js` | 2026-09-11 |
| BUG-86 | P2 | 后端 | PATCH 空 body / 未知字段被解释成「移动到根」，静默搬动资源 | `backend/src/routes/files.js`, `backend/src/routes/folders.js` | 2026-09-11 |
| BUG-87 | P2 | 前端 | Preview / UploadDialog / RenameDialog 三个手写浮层缺 dialog 语义、Esc 与焦点陷阱 | `frontend/src/hooks/useModalDialog.js`, `frontend/src/components/Preview/index.jsx`, `frontend/src/components/UploadDialog.jsx`, `frontend/src/pages/Browse/RenameDialog.jsx` | 2026-09-11 |
| BUG-88 | P2 | 前端 | 不可见控件仍在 Tab 顺序里（关闭态菜单面板、收起态对话卡片） | `frontend/src/components/StaggeredMenu.jsx`, `frontend/src/components/ChatComposer.jsx` | 2026-09-11 |
| BUG-89 | P2 | 前端 | 热力图每日数值只能鼠标悬停获取，键盘/读屏拿不到 | `frontend/src/pages/Dashboard/ActivityHeatmap.jsx` | 2026-09-11 |
| BUG-90 | P2 | 前端 | 类型分布 props 变化后不重置选中项，高亮状态自相矛盾 | `frontend/src/components/InsightCards.jsx` | 2026-09-11 |
| BUG-91 | P1 | 后端 | `PATCH /api/folders/:id` 的环校验与写库之间隔了 OSS 往返：并发可写入 parent 环 | `backend/src/routes/folders.js`, `backend/test/auditFixes.test.js` | 2026-09-11 |
| BUG-92 | P1 | 后端 | 文件夹改名/移动的 OSS 复制无补偿：孤儿对象会被下一次 sync 当成新文件导入 | `backend/src/routes/folders.js` | 2026-09-11 |
| BUG-95 | P2 | 前端 | 自定义 LLM 配置保存不校验三项齐全：提示文案承诺「三项都填才生效」，实际会写入半份配置 | `frontend/src/components/SettingsModal.jsx` | 2026-09-11 |
| BUG-96 | P1 | 后端 | 下载签名 URL 带了 OSS 拒绝的 `response-content-type`：所有「下载」按钮一律 400 失败（`InvalidRequest: Can not override response header on content-type`） | `backend/src/oss.js` | 2026-09-11 |
| BUG-97 | P1 | 部署·运维 | 生产 nginx（宝塔托管）缺 SPA 回退：刷新/直开任意前端路由（`/folder/6`、`/dashboard`、`/settings`…）都 404 | `/www/server/panel/vhost/rewrite/zyxf.top.conf`, `docs/DEPLOY.md` | 2026-09-11 |

### 2.2 已关闭改进项（32）

| 编号 | 严重度 | 类别 | 标题 | 处理位置 | 关闭日期 |
|---|---|---|---|---|---|
| IMPROVE-01 | P2 | 前端 | 页面与组件职责集中，目录结构缺少页面级子模块边界 | `frontend/src/pages/BrowsePage.jsx`, `frontend/src/pages/Browse/*` | 2026-09-11 |
| IMPROVE-02 | P2 | 安全 | Mimosa 安全扫描剩余项：均为协议性要求/误报，需批量归类豁免 | `backend/src/routes/folders.js`, `backend/src/imm.js`, `backend/test/env.js`, `frontend/src/test/setup.js` | 2026-09-11 |
| IMPROVE-03 | P2 | 安全 | 同步接口权限由 admin-only 改为分层限流（游客/用户/管理员递增配额） | `backend/src/limiter.js`, `backend/src/routes/sync.js` | 2026-09-10 |
| IMPROVE-04 | P1 | 安全 | OSS 凭证由 `PowerUserAccess` 改为专用 RAM 用户 + 单 bucket 最小权限 | `.env`（云端 RAM 策略 `zyxf-oss-app`）· `docs/DEPLOY.md §2.2` | 2026-09-10 |
| IMPROVE-05 | P2 | 安全 | 下载日志（含 ip/ua）无保留期，PII 无限期留存 | `backend/src/db.js`, `backend/src/index.js` | 2026-09-10 |
| IMPROVE-06 | P2 | 安全 | JWT 校验未固定算法，未显式 pin `HS256` | `backend/src/auth.js` | 2026-09-10 |
| IMPROVE-07 | P2 | 文档 | `.env.example` 管理员描述过时，且漏列 `ALLOWED_DEV_ORIGIN` | `.env.example` | 2026-09-10 |
| IMPROVE-08 | P2 | 工程·CI | CI workflow 的 action 用可变 tag，未固定 commit SHA | `.github/workflows/ci.yml` | 2026-09-10 |
| IMPROVE-09 | P1 | 安全 | `zyxf-mail` 持 `AliyunDirectMailFullAccess`（`dm:*`），远超实际所需 | 云端 RAM 策略 `zyxf-dm-send` | 2026-09-10 |
| IMPROVE-10 | P2 | 安全 | `/api/chat` 对匿名开放且允许客户端自带 baseUrl（受限公网代理面） | `backend/src/routes/chat.js`, `frontend/src/components/ChatComposer.jsx` · `frontend/src/i18n/zh.js` | 2026-09-11 |
| IMPROVE-11 | P2 | 前端 | CSP 配置在 nginx 层（后端关闭有意为之）+ nosniff/Referrer-Policy | `frontend/nginx.conf`, `backend/src/index.js` · `docs/DEPLOY.md §4.2` | 2026-09-10 |
| IMPROVE-12 | P1 | 性能 | 统计接口缺支撑索引：`files(created_at)` 与 `download_logs(file_id, downloaded_at)` | `backend/src/db.js`, `backend/src/routes/stats.js`, `backend/test/auditFixes.test.js` | 2026-09-11 |
| IMPROVE-14 | P2 | 性能 | 循环内反复 `db.prepare`（子树搬迁 / reorder / sync 批量导入），且 reorder 的 `order` 无长度上限 | `backend/src/routes/folders.js`, `backend/src/routes/sync.js`, `backend/src/dbHelpers.js`, `backend/test/auditFixes.test.js` | 2026-09-11 |
| IMPROVE-21 | P2 | 冗余 | `largeFileHint` 导出零引用，且 20 MB 阈值以字面量硬写在两本字典 | `frontend/src/utils.js`, `frontend/src/i18n/zh.js`, `frontend/src/i18n/en.js`, `frontend/src/components/Preview/index.jsx` | 2026-09-11 |
| IMPROVE-27 | P1 | 工程·CI | CI 对 lockfile 漏洞完全无感（`npm ci --no-audit` 且无 audit 步骤） | `.github/workflows/ci.yml` | 2026-09-11 |
| IMPROVE-28 | P2 | 工程·CI | 前端 job 只跑 build、不校验产物，空 `dist` 也能绿 | `.github/workflows/ci.yml` | 2026-09-11 |
| IMPROVE-29 | P2 | 安全 | 两个 workflow 未声明最小 `permissions` | `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` | 2026-09-11 |
| IMPROVE-30 | P2 | 工程·部署 | deploy 无 concurrency：两次 push 并发在同一台服务器互相覆盖 | `.github/workflows/deploy.yml` | 2026-09-11 |
| IMPROVE-13 | P1 | 后端 | sync 的 `ensureFolderChain` 残留 N+1：每个对象、每一层都重查父级全部兄弟 | `backend/src/routes/sync.js`, `backend/test/syncBatch.test.js` | 2026-09-11 |
| IMPROVE-18 | P2 | 后端 | `storagePath.js` 同一套 OSS key 规则维护了两份实现（DB 版与 Map 版） | `backend/src/storagePath.js` | 2026-09-11 |
| IMPROVE-19 | P2 | 前端 | 前端扩展名分类表有三份硬编码副本，后端白名单是第四份 | `frontend/vite.config.js`, `frontend/src/utils.js`, `frontend/src/components/FileIcon.jsx`, `frontend/src/components/Chat/parts.jsx`, `frontend/src/test/extPolicySync.test.js` | 2026-09-11 |
| IMPROVE-22 | P2 | 前端 | `api.js` 注释仍描述已被替换掉的同步限流口径 | `frontend/src/api.js` | 2026-09-11 |
| IMPROVE-23 | P1 | 前端 | `gsap` 以静态导入常驻首屏（菜单动画本可惰性加载） | `frontend/src/components/StaggeredMenu.jsx`, `frontend/vite.config.js` | 2026-09-11 |
| IMPROVE-25 | P2 | 前端 | 零引用导出与未使用解构（`useLocale().title`、`App.jsx` 的 `locale`、`imm.js` 的 `immProject`、`clearTheme`、`LOCALES`、`ossPublicHost`） | `frontend/src/hooks/useLocale.js`, `frontend/src/App.jsx`, `frontend/src/ui.js`, `frontend/src/i18n/index.js`, `backend/src/imm.js`, `backend/src/oss.js` | 2026-09-11 |
| IMPROVE-15 | P1 | 后端 | `GET /folders/tree` 每次全量重建整库树（前端去重部分并入 IMPROVE-24） | `backend/src/routes/folders.js`, `backend/src/treeCache.js`, `backend/test/auditFixes.test.js` | 2026-09-11 |
| IMPROVE-16 | P1 | 后端 | 登录/注册的密码哈希独占事件循环 40–50 ms | `backend/src/password.js`, `backend/src/routes/auth.js`, `backend/src/db.js`, `backend/test/authHardening.test.js` | 2026-09-11 |
| IMPROVE-17 | P2 | 后端 | 文件夹改名/移动逐对象搬运子树，无规模阈值 | `backend/src/routes/folders.js`, `backend/test/auditFixes.test.js` | 2026-09-11 |
| IMPROVE-20 | P2 | 前后端 | `/api/search` 每类截断 20 条却被前端当总数展示 | `backend/src/searchService.js`, `backend/src/routes/search.js`, `frontend/src/components/SearchBar.jsx` | 2026-09-11 |
| IMPROVE-24 | P2 | 前端 | `useFolderTree` 未去重：同一变更发两次 GET | `frontend/src/hooks/useFolderTree.js`, `frontend/src/test/useFolderTree.test.jsx` | 2026-09-11 |
| IMPROVE-35 | P2 | 前端 | 白屏兜底把原始错误与堆栈直接展示给终端用户 | `frontend/src/bootError.js`, `frontend/src/main.jsx`, `frontend/src/test/bootError.test.js` | 2026-09-11 |
| IMPROVE-36 | P1 | 文档·运维 | 部署指南的最小权限策略只有 `oss:*`，照做必然缺 `imm:GenerateWebofficeToken`（该动作还不支持资源级授权，策略需 `Resource: *`） | `docs/DEPLOY.md` | 2026-09-11 |
| IMPROVE-37 | P1 | 文档·运维 | 部署指南未说明「轮换 AccessKey 后必须同步服务器 `.env`」：漏做后 OSS 回 `InvalidAccessKeyId`，上传/下载/预览全线失效而接口仍返回 200 | `docs/DEPLOY.md` | 2026-09-11 |
