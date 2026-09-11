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
条目总数: 133        # 缺陷 93 + 改进 40
待处理: 10           # 缺陷 2 + 改进 8（26 暂缓；31/32 已建档、待决策后修；33 可访问性权衡；34 视觉一致性；38 名称层语义（代码已移除、教训保留）；39 内容级索引；40 内容分类组织）
已归档: 123          # 缺陷 91 + 改进 32
# 本批（内容分类组织）：按人类要求，图谱内容档不再按目录摊开，改用「学科 → 内容细分 → 文件」的
#   内容语义分类，细分由 k-means 产生、名字由 LLM 起一次并缓存；同时去掉图例（名字直接写在节点上）。
#   两级的来源取舍、LLM 命名的成本、三个真实 bug（丢单文件细分、重复节点、悬空边）写进 IMPROVE-40。
# 本批（知识图谱语义层）：先是名称层聚类（IMPROVE-38），随后内容级索引落地（IMPROVE-39）并按人类要求
#   把名称视图整档移除，图谱只保留「内容视图 / 目录视图」两档。
# 本批（知识图谱退化）：进文件夹再回主页后图谱只剩一个点——d3-force 就地改写共享 memo 的 link 端点/节点坐标，
#   导致字符串端点比较失配、度数记到 "[object Object]"；已改为每次基于拷贝构建并归一化端点（BUG-98），补 6 条回归。
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

上一轮审计新发现的 11 条缺陷已全部处置并归档（BUG-54～61、64/66/67/79/85～90 见 [2.1 已修复缺陷](#21-已修复缺陷)（89））；设计规范审计批新发现 **2 条**（BUG-93、BUG-94），只建档、未改代码；设置页改造批新发现的 **1 条**（BUG-95）当轮修复并归档；本轮（预览/下载故障复盘）新发现的 **1 条**（BUG-96）也已当轮修复；随后 SPA 深链批与知识图谱批各新发现 **1 条**（BUG-97、BUG-98），均当轮修复。

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

#### IMPROVE-38 · 知识图谱只有目录层级、没有语义组织；名称层分词要避开四个实测过的翻车点（**代码已在 IMPROVE-39 落地后移除**）
**影响范围**：`frontend/src/components/KnowledgeGraph.jsx` · `frontend/src/index.css` · `frontend/src/test/KnowledgeGraph.test.jsx` · `frontend/src/test/KnowledgeGraphView.test.jsx`（前端 · 功能 / 可读性）

> **处置（2026-09-11，人类要求）**：名称视图（`tokenizeNodeName` / `buildSemanticEdges` / `buildClusters` 与两张词表）已从代码中**移除**，图谱只保留「内容视图 / 目录视图」两档——内容视图上手后名称层成了冗余档（同一份资料被两套判据各聚一次），且它需要维护一张手工词表。词表本身不进 `backend/src/`（它服务于前端组件），因此是删除而非搬移。**下面这些实测教训保留**：换库或将来再做名称层聚类时，这四个翻车点仍然成立。

- **现状**：原图谱的边只有「父文件夹 → 子节点」一种（目录结构图），`files` 表里除名称外没有任何内容信息，所以「按语义组织」必须先在名称层造信号。本轮按人类选择落地「在目录层级之上叠加语义层」：`tokenizeNodeName`（去扩展名 → NFKC → 小写 → 分隔符归一 → 中文按停用字切片段后在片段内出 2/3-gram）→ `buildSemanticEdges`（同类型节点间按 idf 加权相似度连虚线边）→ `buildClusters`（连通分量 + 簇色 + 标签），默认开启、可一键切回目录视图，簇色/图例见 `docs/DESIGN.md` §4。**文件内容级语义（embedding / 标签表）本轮不做**：人类已同意「可读内容并发给模型」，但那需要 OSS 取文件 + PPT/PDF 文本抽取 + 任务队列，是独立的一轮工程（后来由 IMPROVE-39 落地）。
- **影响**：名称层语义的上限就是名称里写了什么；优点是零后端改动、零额外调用、当场可见。四个参数（`MAX_SEMANTIC_DF=15`、共享 ≥2、覆盖率 ≥1/2、idf 加权 Jaccard ≥0.6）都是用本地真实库（908 节点 / 850 文件）跑出来的，不是拍的：
  1. **df 上限必须同时压「权重」和「共享计数」**。只压权重时「数学」（df=68）命中一条就能成边，实测把 282 个节点连成一簇；补上计数后仍有 265 个节点的巨簇。
  2. **idf 加权 Jaccard 是拆巨簇的关键**。「西安/交通」这类库内高频词即使命中多，权重也被压低；仅这一条就把 265 节点的簇拆成 ~100 个主题簇（最大 17）。
  3. **单字 token 不能进主题集**。停用字切出的「案」（答案）、「章」（第X章）df 都有 80+，两个文件各命中一个就凑够 2 个共享 token，实测把 331 个节点连成一片；纯缩写（「高数.pdf」）改由同目录弱边接回。
  4. **弱边的判据必须是「token 为空」而不是「主题为空」**。否则一个把单字全过滤掉的纯缩写名会变成空壳，再多连几个同目录资料就能桥接不同主题的簇（实测 348 个节点连成一片）。
  另有两个「填词表」教训：「复习提纲」曾让 28 条边把「生命科学」和「思想道德」连起来（已把「提纲」补进 STOP_WORDS）；`学/期/末` 之类字进停用字会切碎「数学/期中」，停用字只收「单独成词没有主题信息」的字。
- **已知不足**：① 名称层分不出「同一门课的不同写法」（「线代」vs「线性代数」）——仅靠名称层相似度确实能连上，但整簇的判据仍是共享 token，缩写与全称各成半簇，靠文件夹与 `--kg-cn` 兜底；② 局部视图里 f0 / 顶层文件夹多数自成一簇（文件夹名之间差异大），簇色主要体现在文件节点上；③ 实测最大簇 57 个是「医用有机化学课件 + 生命科学基础复习提纲」的合并（两者共享学科 token），属名称层误并，继续收敛需要内容级语义；④ 停用字表是经验值，换库 / 换学科要按上面四条重新验证。
- **成簇是同步计算的**：908 节点实测 11 ms（分词 ~2 ms、建边 9 ms、成簇 2 ms），跟着整库规模增长。原先建边是全库两两比对（54 ms），已改成只从「共享某个非套话主题 token」的倒排表取候选对——边集合与簇结果与改前逐字节一致（934 边 / 526 簇 / 标签完全一致）。再大一个数量级（上千文件）仍要挪进 Worker 或分批。
- **验证**：`npm test` 全绿（167 条，其中图谱 21 条：纯函数 17 条 + 渲染层 4 条断言图例、虚线语义边、簇色与开关行为）。真实库实测：908 节点 → 934 条语义边 / 526 簇（其中 92 个多成员簇）/ 最大簇 57，标签订单为「有机化学类 57 · 大物 28 · 复变积变 27 · 离散 18 · 数理统计 17 …」，主题归并已可用。

#### IMPROVE-39 · 内容级语义索引：覆盖率实测只有 49%，OCR 与老格式是本轮明确不做的缺口
**影响范围**：`backend/src/textExtract.js` · `backend/src/ooxml.js` · `backend/src/embed.js` · `backend/src/indexPipeline.js` · `backend/src/routes/indexing.js` · `frontend/src/components/KnowledgeGraph.jsx` · `docs/DEPLOY.md`（前后端 · 功能 / 运维）

- **现状**：图谱的语义边原先只来自**文件名**（IMPROVE-38，该名称层已随本轮落地而移除）。本轮补上内容级：`text_extractions`（正文，全存）/ `file_embeddings`（512 维 float32 BLOB）/ `index_jobs`（队列）/ `index_usage`（每日配额）四张表，上传与 `/api/sync` 后自动入队，后台单并发 worker 下载 → 抽正文 → 本地嵌入，图谱新增「内容视图」档（默认，与目录档构成仅有的两档）。该档的组织方式随后由 **IMPROVE-40** 改为内容分类（本条目最初实现的是「向量相似边 + 图例」，那个 `/semantics` 端点已删除）。
- **为什么本地嵌入**：`LLM_BASE_URL` 用的 StepFun（`api.stepfun.com/step_plan/v1`）只有对话接口、**没有 `/embeddings`**；云端方案还要多一家凭证。本地 `Xenova/bge-small-zh-v1.5` 量化版 22.9 MB，实测模型加载 81 ms、编码 4 段文本 7 ms（850 个文件约 1–2 分钟），且资料内容不外发。依赖 `onnxruntime-node` + `@huggingface/tokenizers`：前者 npm 包内含全平台原生库，装完 **282 MB**（只用得上其中一个平台那份）——这是为了避开「下载 vs 本地编译」的不确定性接受的代价，已写进 DEPLOY.md §6.2。
- **实测覆盖率（本机真实库 850 个文件跑完全量索引；另做过等距抽样校准，避免按大小抽样带来的偏差）**：

  | 类别 | 实际数量 | 占比 | 处理 |
  |---|---|---|---|
  | `pdf_text`（PDF 有文本层） | 409 | 48% | 正常入内容视图 |
  | `office_text`（docx/pptx/pptm） | 92 | 11% | 同上 |
  | `text`（txt） | 8 | 1% | 同上 |
  | `image_only`（扫描件 / 图片版 Office） | 122 | 14% | 只在目录视图里出现 |
  | `unsupported`（.doc/.ppt/压缩包/图片） | 216 | 25% | 只在目录视图里出现 |
  | 失败 | 3 | — | 记 `last_error`，不影响其他文件 |

  **能进内容视图的是 61%（518/850）**，剩下 39% 只能在目录视图里按文件夹浏览（比方案阶段按抽样估的 49% 好一些）。全量抽取耗时约 25 分钟（单并发，含 154 MB 的模电课本）。本轮取舍（人类已确认）：不做 OCR、老格式不做，但把位置留好——`doc_kind` 已预留 `pdf_ocr`，下一轮接本地 Tesseract 不用改表结构。**不接 OCR 的后果要正视**：抽样里那几本扫描教材（复变函数 365 页、数据结构 479 页等）正是复习主力，它们在内容视图里目前是缺位的。
- **成簇判据的标定过程（记录在此，供将来若重做「相似边」方案参考）**：单靠相似度阈值**解决不了链式串簇**——518 个文件 2943 条边里，0.78 时最大簇 125 个成员（数学类试题资料靠「试卷/题目/答案」这一文体逐级串起来）、0.82 时仍有 64 个且纯度只有 25%。改成「阈值 ≥0.84 **且互为 top-4 最近邻**」后最大簇降到 17，且 线性代数 / 思政 / 概率论 / 流体力学 / 生命科学 这些真主题保持 100% 纯度。原理：桥接文件不再能单向把两团拉近——它必须也在对方的前 4 名里，而弱连接通常不是相互的。**IMPROVE-40 换成了 k-means 分类，这个「互为最近邻」技巧也就随之不用了**（k-means 每个点只属于一个簇，不存在链式桥接）。
- **两个必须记住的抽取坑**：① **OOXML 不能用正则抽文本**。`<a:t[^>]*>([\s\S]*?)</a:t>` 遇到属性里含 `<`/`>` 的（`<a:ln><a:solidFill>`）会跨标签吞掉整段 XML——实测同一个 20 MB 的 pptm 抽出 **1226 万字**（真实值 2093 字），向量会因此完全失真；必须按标签流单遍扫描（`extractTextTag`，单测里有畸形样本）。② **docx/pptx 是 zip 不是文本**，用 `node:zlib` 自己读中央目录即可（`readZipEntries`），无需第三方解压库；注意本地头与中央目录的长度字段可能不同，必须按本地头重算条目偏移。
- **降级链（都验证过）**：模型文件缺失 → `isEmbeddingEnabled()` 为 false，只抽正文、不出向量，进程不报错、上传不受影响，`/api/index/status` 里给出原因；前端内容视图在数据未就绪时提示「正在读取内容索引…」、索引为空时提示「可切到目录视图」，都不白屏。
- **已知不足**：① 扫描件与老格式（39%）没有内容语义，想要覆盖需 OCR；② 向量只存整篇均值、没有分块，长教材里「某一章讲了什么」这种细粒度检索还没有（搜索混合排序留到下一轮）。
- **验证**：后端 270 条、前端 162 条全绿（新增 `textExtract.test.js` 13 条、`indexPipeline.test.js` 11 条）。真实库端到端：850 个文件入队后 worker 正常消化（847 done / 3 failed / 0 卡住），`/api/index/status` 可见各 `doc_kind` 分布与失败清单。

#### IMPROVE-40 · 图谱改为按内容语义分类组织（学科 → 内容细分），并去掉图例
**影响范围**：`backend/src/semanticTaxonomy.js` · `backend/src/routes/indexing.js` · `backend/src/db.js` · `frontend/src/components/KnowledgeGraph.jsx` · `frontend/src/api.js` · `frontend/src/i18n/zh.js` · `docs/DESIGN.md`（前后端 · 功能）

- **现状（人类要求）**：「既然已经拿到了内容，组织方式就可以不按目录来——自定义一些节点，比如数学，再细分」。原内容档是「目录骨架 + 向量相似虚线边 + 图例」，文件仍挂在文件夹下、语义只是叠加上去的一层；现在改成**用内容分类直接做骨架**：`根 → 学科分类（大类）→ 内容细分 → 文件`，细分节点是内容自己产生的，不再画目录层级边。
- **两级的来源（这是实测出来的取舍）**：**大类 = 顶层目录**，**细分 = 单个学科目录内部做 k-means**。试过让向量自己产生大类：k-means 的簇心之间余弦普遍 >0.9，按簇心相似度归并时 0.72 就把 518 个文件里的 **447 个**并成一坨、0.82 仍有 366 个——**两层结构从向量几何里长不出来**；而顶层目录本身就是可靠的人工学科划分，拿它当骨架反而稳。细分那一层向量很有效：生命科学基础分出「细胞生物学 / 分子生物学 / 细胞代谢 / 细胞信号受体」，高数上分出「基础考点复习 / 积分与微分方程 / 习题模拟汇编 / 高数复习小助手」。细分粒度 = 每约 8 个文件一个簇，上限 5 个（`FILES_PER_CLUSTER` / `MAX_CLUSTERS`）。
- **细分名字：LLM 起一次并落库缓存**。文件名起不出可读名字（试过「文件名里本簇独有的词」：线代 4 个细分里 3 个都是「XX期末」，覆盖率与区分度都不够）。LLM 命名质量明显更好（「极限与导数」「一元积分学」「分子遗传学基础」），成本是**按簇只调一次**（本次 84 个细分约 50 次调用，273 秒，一次性），结果存进新表 `taxonomy_cache`（含 `version` + `fingerprint`：向量数量或最新时间变了自动重算），之后请求 **7.9 ms** 返回。没有 LLM 时自动回落到文件名独有词，仍起不出就不显示名字（不编造）。
- **前端建图（`buildTopicGraph`，纯函数，可直接单测）**：学科节点复用目录节点 id（点击照常下钻到该学科目录）；细分节点 id 为 `k:<clusterKey>`，点击进入所属学科；**未被索引的文件不进图**（扫描件/老格式没有归属边，画了只会变成游离点，它们在目录档照常可见）；**只有一个文件的细分不建节点但文件不能丢**（直接挂学科下——这条是真实 bug：初版丢了这些文件，等于它们在内容视图里凭空消失）。建图后必须**滤掉悬空边**：分类图的边都从根出发，而局部子图里可能没有根节点，d3 的 forceLink 会直接抛 `node not found: f0`（初版就是拿目录边先渲染了一帧导致）。
- **图例已去掉**（人类要求）：分类名直接写在节点上，内容档标签默认全部显示（节点少、语义重），不需要图例去对照颜色；原先的「悬停图例点亮某簇」也随之移除，改为**悬停节点时亮起「文件 → 细分 → 学科 → 根」这条归属骨架**。
- **已知不足**：① 大类就是顶层目录，所以**目录起得乱的库，大类也会乱**（本库里「各类往年题」「思政类」这类归档目录本身不是学科，它们下面按内容分出的细分仍是对的，但大类名不理想）；② k-means 是硬聚类，一个文件只能属于一个细分（跨学科资料如「入学考试数学+物理」会被塞进其中一个）；③ 分类是整库重算的，新增文件要等缓存指纹失效才更新（没有做增量）。
- **验证**：后端 270 条 / 前端 162 条全绿（图谱 16 条：建图纯函数 7 条 + 渲染 4 条 + 局部子图回归 6 条）。真实库端到端：`deriveTaxonomy` 产出 **53 个大类 / 84 个细分 / 85% 有名字**，用真实数据跑 `buildTopicGraph`：全库 653 节点 / 652 边 / **0 重复 id / 0 悬空边 / 分类覆盖的 518 个文件一个不缺**，根的第一层就是「线性代数 / 生命科学基础 / 各类往年题 / 高数上复习助手 / 大学计算机基础-大计基 / 思想政治-思修 …」，进入「线性代数」展开出「期末真题汇编 / 复习辅导资料 / 试题资料合集 / 习题与复习」。

---

## 2. 已归档

> 归档表只作索引（编号 / 严重度 / 类别 / 标题 / 位置 / 日期）。修法依据、踩坑与验证方式写在**代码注释**里（`grep -rn "BUG-54" backend/src`）与 commit message 中。

### 2.1 已修复缺陷（91）

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
| BUG-98 | P1 | 前端 | 知识图谱在「进文件夹再回主页」后只剩一个点：d3-force 就地改写共享 memo 的 link 端点（字符串→对象）与节点坐标，字符串比较全部失配、度数记到 `"[object Object]"` | `frontend/src/components/KnowledgeGraph.jsx` | 2026-09-11 |

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
