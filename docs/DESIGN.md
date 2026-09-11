# Design System Inspired by Vercel

> **Brand Adaptation (仲英学辅)**
> This system is Vercel-inspired for the 仲英书院学业辅导中心 (Zhongying College Academic Counseling Center) material library website. Brand-owned assets are kept as-is and override the generic system:
>
> - **Brand font:** OPPO Sans 4.0 replaces Geist as the primary font (brand-owned, `frontend/public/fonts/OPPO Sans 4.0.ttf`). The *principles* of Geist typography (compression, three-weight hierarchy, tight tracking) still apply, but letter-spacing is adapted for CJK legibility — see §3.
> - **Brand identity:** The brand logo (`favicon.png`) and brand names (仲英学辅资料库, 仲英书院学业辅导中心, 仲英学辅) are always preserved verbatim.
> - **Language:** All user-facing copy is Chinese (zh-CN); uppercase mono technical labels (TODAY, DOWNLOADS…) remain in English as decorative metadata, per the Geist Mono tradition.
> - **Accent colors:** The old brand blue (#276DAB) is replaced by the Vercel interaction palette (§2) — Link Blue #0072f5, Develop Blue #0a72ef, Focus Blue hsla(212, 100%, 48%, 1). Primary CTAs are Vercel Black (#171717).
> - **Data-viz accent tokens** for the stats dashboard — 下载蓝 `--accent` (#3d9aff), 上传橙 `--orange` (#f68f3c), 今日红 `--red` (#ee5c61), 占用绿 `--green` (#3fae6b) — the only permitted accent use (see the heatmap spec in §4).
> - **无界 (Borderless) philosophy — 本项目的核心设计理念：** This site deliberately moves *away* from Vercel's line-dominated separation (shadow-as-border everywhere). 边界不靠边框线表达，而靠**颜色对比与其他效果**：表面色块深浅（#FAFAFA / #EFEFEF / #ECECEE）、留白间距、投影海拔（multi-layer shadow）。CSS `border` 仅在功能确有必要时使用（e.g., table rows, dashed dropzone, form input hairline）。There is **no topbar** — navigation is a StaggeredMenu hamburger on every layout; the brand, search and folder tree live in the left rail (see §4).

## 1. Visual Theme & Atmosphere

Vercel's website is the visual thesis of developer infrastructure made invisible — a design system so restrained it borders on philosophical. The page is overwhelmingly white (#ffffff) with near-black (#171717) text, creating a gallery-like emptiness where every element earns its pixel. This isn't minimalism as decoration; it's minimalism as engineering principle. The Geist design system treats the interface like a compiler treats code — every unnecessary token is stripped away until only structure remains.

The custom Geist font family is the crown jewel. Geist Sans uses aggressive negative letter-spacing (-2.4px to -2.88px at display sizes), creating headlines that feel compressed, urgent, and engineered — like code that's been minified for production. At body sizes, the tracking relaxes but the geometric precision persists. Geist Mono completes the system as the monospace companion for code, terminal output, and technical labels. Both fonts enable OpenType "liga" (ligatures) globally, adding a layer of typographic sophistication that rewards close reading.

> **Brand adaptation:** This project substitutes **OPPO Sans 4.0** for Geist Sans (the brand-owned typeface). OPPO Sans has no mono companion, so system monospace stacks are used for technical labels. OPPO Sans is a CJK font without OpenType "liga" — no ligature features are enabled. Negative letter-spacing is applied at reduced (em-based) values for CJK legibility: see the hierarchy table in §3.

What distinguishes Vercel from other monochrome design systems is its shadow-as-border philosophy. Instead of traditional CSS borders, Vercel uses box-shadow: 0px 0px 0px 1px rgba(0,0,0,0.08) — a zero-offset, zero-blur, 1px-spread shadow that creates a border-like line without the box model implications. This technique allows borders to exist in the shadow layer, enabling smoother transitions, rounded corners without clipping, and a subtler visual weight than traditional borders. The entire depth system is built on layered, multi-value shadow stacks where each layer serves a specific purpose: one for the border, one for soft elevation, one for ambient depth.

Key Characteristics:
- OPPO Sans (brand) with negative letter-spacing at display sizes — text as compressed infrastructure
- System monospace (ui-monospace stack) for code/technical labels; uppercase for metadata captions
- **无界 (Borderless) separation:** whitespace and #FAFAFA surface tints, not lines, divide the page. Shadow-as-border remains available as a *technique* (never a CSS `border`), but is used sparingly — cards are separated by whitespace and elevation, not by outlining everything
- Multi-layer shadow stacks for nuanced depth (border + elevation + ambient in single declarations)
- Near-pure white canvas with #171717 text — not quite black, creating micro-contrast softness
- Data-viz accent tokens for the stats dashboard: 下载蓝 `--accent` (#3d9aff), 上传橙 `--orange` (#f68f3c), 动态红 `--red` (#ee5c61), 占用绿 `--green` (#3fae6b) — the only accent colors in the system, reserved for the dashboard cards (see §2 / §4)
- Focus ring system using hsla(212, 100%, 48%, 1) — a saturated blue for accessibility, reserved for buttons/links (form controls get no focus ring; see §2 / §6)
- Pill badges (9999px) with tinted backgrounds for status indicators

## 2. Color Palette & Roles

### Primary
- Vercel Black (#171717): Primary text, headings, dark surface backgrounds. Not pure black — the slight warmth prevents harshness.
- Pure White (#ffffff): Page background, card surfaces, button text on dark.
- True Black (#000000): Secondary use, used in dark hover states (`hover:bg-brand-700` on the dark CTA) and `.rb-btn-dark:hover`.

### Brand / Interactive (via Tailwind `brand` tokens)
- Link Blue (#0072f5, `brand-600`): Primary links, primary CTA backgrounds.
- Develop Blue (#0a72ef, `brand-500`): Brand mark hover, progress-bar default fill.
- Badge Blue Text (#0068d6, `brand-700`): CTA hover state (darkens the blue).
- Focus Blue (hsla(212, 100%, 48%, 1)): keyboard focus outline on buttons/links. 表单控件（input/textarea/select）不加任何聚焦描边或光晕——无界理念下聚焦态 = 常驻态（灰底色块），见 §6。
- **Icons are monochrome on light surfaces** — `FileIcon` renders file/folder icons with the `text-slate-600` class (actual color is forced to `#000000` by `.app-theme svg { color: #000000 }`); white icons appear on dark CTA buttons and colored icon badges (see §4).

### Data-viz tokens (stats dashboard only — the one permitted accent use)
Defined as CSS variables in `index.css :root` and consumed through Tailwind tokens (`bg-accent`, `text-orange`, …):
- `--accent` #3d9aff — 下载 (downloads): heatmap ramp, 下载排行 badge, 下载热力图 badge
- `--orange` #f68f3c — 上传 (uploads): 最近上传 badge
- `--red` #ee5c61 — 今日动态 (today's anomaly card badge)
- `--green` #3fae6b — 存储 (storage): 占用排行 badge
- These four are the *only* accent colors in the system; nothing else (buttons, links, rows, icons) uses them.

### Neutral Scale (via Tailwind `slate` tokens)
- Gray 900 (#171717, `slate-900` / `--ink`): Primary text, headings, nav text.
- Gray 700 (#404040, `slate-700`): hover text on sidebar toggle buttons.
- Gray 600 (#4d4d4d, `slate-600`): Secondary text, file icons.
- Gray 500 (#666666, `slate-500`): Tertiary text, muted links.
- Gray 400 (#808080, `slate-400`): Placeholder text, disabled states.
- Gray 200 (#ebebeb, `slate-200`): Borders, card outlines, dividers.
- Gray 100 (#f5f5f5, `slate-100`): Soft fill.
- Gray 50 (#fafafa, `slate-50`): Subtle surface tint, inner shadow highlight.

### Insight-card tokens (light theme; consumed by `bg-surface`, `text-ink`, …)
- `--ink` #171717 · `--ink-2` rgba(23,23,23,.65) · `--ink-3` rgba(23,23,23,.45) — text hierarchy
- `--page` #f8f8f8 (page background) · `--surface` #ffffff (card/panel background) · `--inset` #f7f8f9 (chart/inset panels) · `--field` #efefef (empty heatmap cells, toggle groups) · `--hover` rgba(23,23,23,.05) · `--line` rgba(23,23,23,.08) · `--line-strong` rgba(23,23,23,.14)

### Surface & Overlay
- Overlay Backdrop (hsla(0, 0%, 98%, 1)): modal/dialog backdrop — *kept from the original spec.*
- Selection Text (hsla(0, 0%, 95%, 1)): text selection highlight — *kept from the original spec.*
- Badge Blue Bg (#ebf5ff) / Badge Blue Text (#0068d6): *not in use — superseded by the dashboard's colored icon badges (solid accents, white glyph).*

### Shadows & Depth (卡片阴影为 CSS 类 `.rb-card`，非 tailwind token)
- Card Stack（`.rb-card`，index.css 内联定义）: rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 2px, rgba(0,0,0,0.04) 0px 8px 8px -8px, #fafafa 0px 0px 0px 1px — 仅用于上传 / 重命名弹窗。Dashboard 卡片为 `bg-surface` 无阴影（无界）。
- Button（`shadow-btn`，tailwind token）: rgba(23,23,23,.12) 0px 1px 2px, rgba(23,23,23,.06) 0px 0px 0px 1px — raised toggle pills / refresh button.
- Border Shadow (rgba(0,0,0,0.08) 0px 0px 0px 1px) and Ring Border (rgb(235,235,235) 0px 0px 0px 1px) — *removed from the config; nothing references `shadow-ring` / `shadow-ringlight`.* Inputs still use the border-shadow inline in CSS.

## 3. Typography Rules

### Font Family
- Primary: OPPO Sans (brand), with fallbacks: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Roboto, Arial, sans-serif
- Monospace: ui-monospace, SFMono-Regular, Roboto Mono, Menlo, Monaco, Liberation Mono, DejaVu Sans Mono, Courier New
- OpenType Features: none globally (OPPO Sans has no "liga"); "tnum" (tabular numbers) on numeric metrics/captions via `font-variant-numeric: tabular-nums`.
- **CJK adaptation:** Negative letter-spacing is halved and em-based for CJK glyphs (which are full-width): Display −0.03em, Section −0.025em, Sub-heading −0.02em, Card Title −0.02em, Body Medium −0.01em, 14px and below normal.

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display Hero | OPPO Sans | 48px (3.00rem) | 600 | 1.00–1.17 (tight) | -1.44px (−0.03em) | Maximum compression, billboard impact |
| Section Heading | OPPO Sans | 40px (2.50rem) | 600 | 1.20 (tight) | -1.0px (−0.025em) | Feature section titles |
| Sub-heading Large | OPPO Sans | 32px (2.00rem) | 600 | 1.25 (tight) | -0.64px (−0.02em) | Card headings, sub-sections |
| Sub-heading | OPPO Sans | 32px (2.00rem) | 400 | 1.50 | -0.64px (−0.02em) | Lighter sub-headings |
| Card Title | OPPO Sans | 24px (1.50rem) | 600 | 1.33 | -0.48px (−0.02em) | Feature cards |
| Card Title Light | OPPO Sans | 24px (1.50rem) | 500 | 1.33 | -0.48px (−0.02em) | Secondary card headings |
| Body Large | OPPO Sans | 20px (1.25rem) | 400 | 1.80 (relaxed) | normal | Introductions, feature descriptions |
| Body | OPPO Sans | 18px (1.13rem) | 400 | 1.56 | normal | Standard reading text |
| Body Small | OPPO Sans | 16px (1.00rem) | 400 | 1.50 | normal | Standard UI text |
| Body Medium | OPPO Sans | 16px (1.00rem) | 500 | 1.50 | -0.16px (−0.01em) | Navigation, emphasized text |
| Body Semibold | OPPO Sans | 16px (1.00rem) | 600 | 1.50 | -0.16px (−0.01em) | Strong labels, active states |
| Button / Link | OPPO Sans | 14px (0.88rem) | 500 | 1.43 | normal | Buttons, links, captions |
| Button Small | OPPO Sans | 14px (0.88rem) | 400 | 1.00 (tight) | normal | Compact buttons |
| Caption | OPPO Sans | 12px (0.75rem) | 400–500 | 1.33 | normal | Metadata, tags |
| Mono Body | Mono stack | 16px (1.00rem) | 400 | 1.50 | normal | Code blocks |
| Mono Caption | Mono stack | 13px (0.81rem) | 500 | 1.54 | normal | Code labels |
| Mono Small | Mono stack | 12px (0.75rem) | 500 | 1.00 (tight) | normal | text-transform: uppercase, technical labels |
| Micro Badge | OPPO Sans | 7px (0.44rem) | 700 | 1.00 (tight) | normal | text-transform: uppercase, tiny badges |

### Principles
- Compression as identity: display headings use negative letter-spacing (−0.03em at 48px) — CJK-adjusted from Geist's −2.4px. Tracking relaxes as size decreases: −0.02em at 32px/24px, −0.01em at 16px, normal at 14px.
- Three weights, strict roles: 400 (body/reading), 500 (UI/interactive), 600 (headings/emphasis). No bold (700) except for tiny micro-badges. This narrow weight range creates hierarchy through size and tracking, not weight.
- Mono for identity: uppercase mono labels ("TODAY", "DOWNLOADS") serve as the "console" voice — compact technical labels that connect the marketing site to the product.

## 4. Component Stylings

### Buttons

Primary Dark (`rb-btn-dark`)
- Background: #171717, hover #000000
- Text: #ffffff
- Padding: 8px 16px, Radius: 14px
- Use: Primary CTA — 上传、新建文件夹、重命名保存、刷新

Ghost (`rb-btn-ghost`)
- Background: #ffffff
- Text: #171717
- Border: shadow-as-border — rgba(0,0,0,0.08) 0px 0px 0px 1px (inline in CSS), Radius: 6px
- Hover: background shifts toward dark / #fafafa
- Use: Secondary button — 取消、取消重命名

Dashboard Pill Toggle / Refresh (`shadow-btn`)
- Background: `bg-surface` (#fff), Radius: 9999px (rounded-full)
- Shadow: rgba(23,23,23,.12) 0px 1px 2px, rgba(23,23,23,.06) 0px 0px 0px 1px
- Active state: raised `bg-surface shadow-btn`; inactive: plain `text-ink-3 hover:text-ink-2`
- Use: 统计面板的时间范围切换（7日/30日/90日）、今日下载的 下载/上传 指标切换

Colored Icon Badge（彩色图标徽章 — dashboard 卡片标题的统一视觉锚点）
- 14px 圆形（`size-3.5 rounded-full`）、纯色实底、白色 8px 图标（lucide，strokeWidth 3）
- 颜色遵循数据语义：下载蓝 `bg-accent`、上传橙 `bg-orange`、今日红 `bg-red`、存储绿 `bg-green`、类型分布随选中类型色
- 用于：下载热力图、今日下载/上传、下载排行、最近上传、占用排行、文件类型分布 的全部卡片标题
- 取代了原 spec 的 tinted pill badge（#ebf5ff 底 + 深蓝字）

### Cards & Containers
- Dashboard 卡片（`rounded-card bg-surface p-3`）: 白色、12px 圆角、**无阴影**（无界，靠留白与表面色分层）、12px 内边距；同栏卡片间距 12px，区块间也是 12px（无界，不画分割线）
- 图表/内嵌面板（`rounded-control bg-inset`）: 10px 圆角、`#f7f8f9` 底，用于今日下载曲线、AnomalyCard 图表区
- 热力图面板: `bg-surface` **无边框无阴影**，直接融入页面
- 列表行 hover: `#fafafa` 表面微 tint（`bg-slate-50`，经 GlideList 滑动高亮条），无描边（无界）
- 浏览页三卡片（文件列表 / 知识图谱 / 智能对话）: 纯白 `bg-white rounded-[14px]`，**无边框无阴影**（无界）；头部条 `#EFEFEF` + `p-1.5`，标题 13px weight 500，操作图标按钮 24px / 圆角 6px
- 卡片阴影（CSS 类 `.rb-card`）现存用途仅弹窗（上传 / 重命名 `rb-card`），Dashboard 卡片无阴影: rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 2px, rgba(0,0,0,0.04) 0px 8px 8px -8px, #fafafa 0px 0px 0px 1px

### Knowledge Graph (知识库卡片)
- forestry.md "Connected Pages" style, sits in the fixed **right rail** (300px, `lg`+) with the 智能对话 card below it; below `lg`（1024px）它随右栏一同隐藏（无内联回退）
- 头部条可经 chevron 按钮收起为一条灰底胶囊（360ms 高度动画），收起时 globe / 放大按钮隐藏，收起状态跨路由保留
- Force-directed layout (d3-force): circular nodes, **radius scaled by degree** (`2 + sqrt(degree) * 2.2`), monochrome — folders solid `#171717`, files white with `rgba(23,23,23,0.45)` ring; current folder gets an outer ring
- **Local view**: current folder + direct neighbors; globe button opens a full-library modal
- Hover highlights the node + its neighbors (others dim to 0.12, links 0.7/0.05); labels appear on hover or when zoomed past 1.2×
- Pan by dragging background, wheel zoom (0.25–2.5), drag nodes, click (no drag) navigates — folder enters, file previews; auto-fits the graph after settling
- Refetches on the `folders-changed` event

### Chat Card (智能对话卡片)
- 与知识图谱卡片同款外壳：纯白无边框无阴影、`#EFEFEF` 头部条 + 13px 标题 + 24px 图标按钮（清空 / 设置 / 收起）
- 收起/展开同款交互；实现上以像素高度冻结内容（内容不重排，由外层容器从下往上裁剪），消息列表始终 `overflow-y-auto` + `scrollbar-gutter: stable`（滚动条槽位恒定），展开时卡片本体随容器一起平滑长高
- 输入框：`bg-field` 圆角 10px、**无描边**、仅极浅投影（聚焦微调）；发送按钮深色圆角方块，流式生成中变为停止按钮
- 消息区：用户消息右对齐灰底气泡；AI 回复带小节头（检索中 / 生成中 / 完成 / 出错）+ 时间，流式打字机渲染，【文件N】引用渲染为可点击文件行（跳转 / 预览）；空态显示三条建议 chip
- 智能对话配置：头部齿轮**不就地展开表单**，而是打开全局设置弹窗（设置 → 智能对话配置；弹窗固定 **800×580**，视口更小时按 `100vw/vh - 32px` 收窄，左右两栏 = 220px 侧栏 + 内容区；**≤640px 窄屏（手机）改为上下布局**：卡片铺满遮罩内可用区域，侧栏变成顶部条（关闭按钮 + 搜索框各一行 + 导航项改成可横滑的胶囊），否则固定 220px 侧栏会把右栏挤成一条竖线、底部按钮溢出）；配置存 localStorage，请求时随 body 下发覆盖服务端 env（服务端已配置时不再下发用户 Key）。设置页右栏：顶部为**配置来源二选一**（小圆点单选，**纵向排列**：`使用服务器配置` / `使用自定义配置`，原生 radio 去外观后自绘，未选=1px `--line-strong` 环，选中=`--ink` 环 + 实心点；**选中只换颜色、不改字重**，避免文字宽度跳动）；选「服务器配置」时**整块隐藏四个字段**并只显示 server 提示，选「自定义配置」才显示字段（字段**自上而下为 API 地址 → API 协议 → API Key → 模型**；分组不再套底色块/内边距——卡片本身白底，套白块只会多出一圈假缩进，改为纯靠留白分组：块间距 20px / 字段间距 14px / 标签到输入框 6px；**除 API 地址给一个通用格式示例 `https://api.example.com/v1` 外，其余字段不给占位文字**——占位容易被误读成已填的值，写具体厂商又会误导；地址与协议同款外观：浅灰底 `#F5F5F5`（暗色改 `var(--field)`）、**无细线描边**、**聚焦也不加光晕/描边**，与登录页输入框同款；协议用**自绘下拉**（按钮触发器 + Level 3 浮层，与「外观」页语言下拉共用 `.settings-popover` / `.settings-popover-option`；**不用原生 `<select>`**——它的 option 列表由系统绘制，跟不上暗色主题与无界风格；字段容器用 `div` 而不是 `label`，否则 label 会把点击转发给触发器，「API 协议」整行都变成可点区域，故只有触发器本身可点、命名靠触发器的 `aria-label`），三项用官方叫法：`OpenAI Chat Completions` / `OpenAI Responses` / `Anthropic Messages`，与 id `openai-completions` / `openai-responses` / `anthropic-messages` 一一对应）；「保存」在服务器配置下会清掉本地存储，「恢复默认设置」= 回到服务器配置 + 清空；两个操作按钮为右栏**底部固定条**（`.settings-actions` 在滚动区之外，始终钉在右下角，「次级 `rb-btn-ghost` + 主 `rb-btn-dark`」；配对展示故条内 ghost 圆角对齐为 14px，其他页面的 ghost 仍是 6px 规范）

- 协议支持：上游三选一 —— **`openai-completions`**（`${baseUrl}/chat/completions`，`Authorization: Bearer`）、**`openai-responses`**（`${baseUrl}/responses`，system 走顶层 `instructions`、工具是独立的 `function_call` 条目、工具结果 `function_call_output` 用 `call_id` 关联、`store:false` 不在上游留副本）、**`anthropic-messages`**（`${baseUrl}/messages`，`x-api-key` + `anthropic-version`，system 顶层，工具调用换成 `tool_use` / `tool_result` 内容块）。差异全部收敛在 `backend/src/llmProtocols.js`（纯函数 + `PROTOCOL_IMPLS` 分发表），`chat.js` 的工具回路与前端事件形状都不感知协议；服务端由 `LLM_PROTOCOL` 选（旧值 `openai` / `anthropic` 仍兼容），浏览器端由设置页的「API 协议」选，两者都会给地址接上各自协议对应的路径，所以地址只填到版本层。

### File List (资料库中列)
- Monochrome throughout (no accent colors): rows on white, dividers rgba(23,23,23,0.08)
- Row hover: `#FAFAFA`（`bg-slate-50`，经 GlideList 滑动高亮条）surface tint only — no ring/outline (无界)
- Header row: 12px on `#EFEFEF`（与右栏卡片头部同款灰底；文字色被 `.rb-table-heading` 强制为 `#171717`）
- Metadata (size/date): 12px #808080
- Row action buttons (download/rename/delete): black icons, hover `rgba(0,0,0,0.05)` — no red/blue tints
- Drag/drop indicators: neutral — drop-into `rgba(0,0,0,0.05)` + 1px `rgba(0,0,0,0.1)` inset ring, insert lines `inset 0 2px 0 rgba(0,0,0,0.6)`
- Floating hint pills: neutral (`rgba(0,0,0,0.05)` bg, `rgba(0,0,0,0.1)` border); error states stay red (semantic)

### Inputs & Forms
- Radio: standard styling with focus var(--ds-gray-200) background
- Focus shadow: 1px 0 0 0 var(--ds-gray-alpha-600)
- Focus: 表单控件**不加任何聚焦描边/光晕**（无界——聚焦态与常驻态一致，边界只由底色/细线表达）；蓝色 Focus Blue 仅用于按钮/链接的键盘焦点环
- Border: via shadow technique, not traditional border

### Navigation
- **No topbar on any layout** — the page is three columns (left rail + content + right rail)
- Navigation lives in the **StaggeredMenu** (hamburger) on **all** screen sizes: right-side slide-out panel with the main items (资料库 / 统计 / 关于我们 / 登录（未登录）/账号卡片 + 展开式用户菜单：登录 · 退出登录 · 预留设置项) + social channels
- Brand logo + brand name (仲英学辅资料库) sit at the top of the **left rail** (desktop) / a slim mobile-only top row
- Menu toggle: white shadow-border button, 6px radius, 14px weight 500, fixed at top-right
- Active: weight 600 or underline
- CTA: dark pill buttons (`rb-btn-dark`, 上传 / 新建文件夹)

### Docs Layout & Sidebar (Folder Tree)
- Vercel-docs-style **three-column layout** on **browse routes only** (`/` and `/folder/:id`); every other page (统计 / 关于我们 / 登录) is **standalone** (no fixed rails)
- Browse routes (desktop ≥1024px):
  - **Left rail** — **full-bleed to the viewport's left edge** (no white gap), **250px**, full viewport height `#ECECEE` tint (no border line, 无界), `fixed`; contains, top to bottom:
    1. **Brand logo + brand name** (brand identity, verbatim)
    2. **Search field** (Vercel-docs pattern)
    3. **Folder tree** (fills the remaining rail height, scrolls internally) — folders **and files**: file leaves show the file-type icon, indented under their folder; clicking a file jumps to its folder and opens the preview. Root-level files sit under the 首页 node, which is **expanded by default**. Chevron toggles any folder that contains folders or files.
  - **Middle column** (`flex-1`, scrolls internally): toolbar row (white background) — sort segments (默认 / 名称 / 时间 / 大小), refresh, 新建文件夹, 上传 — above the file list
  - **Right rail** (fixed full-height, 300px): **knowledge-graph card** below (the graph's local view is `sticky` to the rail; the full-library modal is unaffected) then the **AI 资料助手 card** (`lg`+ only): streaming chat panel (SSE) that answers file-finding questions with smart-search tool calls; replies render typewriter-style with 【文件N】 citations rendered as clickable file rows (jump/preview); welcome state shows three suggestion chips; composer doubles as a stop button while streaming. Requires `LLM_*` env (otherwise 503 → 「AI 功能未配置」); the rail scrolls when both cards overflow. The StaggeredMenu toggle button floats separately at the top-right.
  - Below `lg` (1024px) the right rail hides (no inline fallback); the left rail hides below `lg` — browse pages get a slim mobile brand row + search below it, navigation via StaggeredMenu
- Content column: browse is full-width between the rails (no max-width); standalone pages are `mx-auto w-full`; login is `max-w-7xl`
- Standalone pages (统计 / 关于我们): a single full-width column (`mx-auto w-full`, no fixed rails)
- Login page is standalone (no rail, no brand row)
- Sidebar = the library's folder tree (GET `/api/folders/tree`):
  - Section label "目录" — 12px weight 500, #666
  - Rows: 14px weight 400, `#4d4d4d`, height 32px, radius 6px
  - Active folder (current route): `#F5F5F5` background + weight 500 + #171717 — a *tint*, not an outline
  - Hover: `#FAFAFA` background; indent per depth: 8px base + 16px per level
  - Chevron (12px, rotates 90° when open) toggles a subtree; clicking the name navigates
  - Ancestor chain of the current folder auto-expands
  - Refreshes on the global `folders-changed` event (dispatched after admin create/rename/move/delete/reorder)
- Brand + rail content align to the left edge (full-bleed)
- Responsive: right rail hidden below `lg` (1024px), left sidebar hidden below `lg` (1024px); navigation falls back to StaggeredMenu + search

### Image Treatment
- Product screenshots with 1px solid #ebebeb border
- Top-rounded images: 12px 12px 0px 0px radius
- Dashboard/code preview screenshots dominate feature sections
- Soft gradient backgrounds behind hero images (pastel multi-color)

### Distinctive Components

Workflow Pipeline
- Three-step horizontal pipeline: Develop → Preview → Ship
- Each step has its own accent color: Blue → Pink → Red
- Connected with lines/arrows
- The visual metaphor for Vercel's core value proposition
- *Not implemented in this app* — kept as the inspiration's reference concept; the project's accent use lives entirely in the dashboard data-viz tokens (§2).

Trust Bar / Logo Grid
- Company logos (Perplexity, ChatGPT, Cursor, etc.) in grayscale
- Horizontal scroll or grid layout
- Subtle #ebebeb border separation

Metric Cards
- Large number display (e.g., "10x faster")
- Geist 48px weight 600 for the metric
- Description below in gray body text
- Shadow-bordered card container

Download Heatmap（下载热力图，`/dashboard` 首行左卡）
- GitHub 风格年度网格：周一开头的周列 × 7 行（一 三 五 日 标签，偶数行留空），顶部月份轴（1月…12月，`whitespace-nowrap` 单行，允许向右溢出到空格位）
- 颜色 = 5 档蓝色 ramp：`var(--field)` → `rgba(61,154,255,.35/.55/.78)` → `var(--accent)`；档位按 **sqrt(当日下载数/峰值)×4** 取整，避免单日尖峰压平其余活跃日
- 格子自适应：12–22px（内边距 `px-3 pb-3`、单元格间隙 5px），优先按高度撑满并与同行卡片等高（`h-full flex-col`），宽度不足时从**最左侧（最旧周）裁剪**而非滚动——无滚动条；网格在剩余空间内居中
- 白色无边框面板（bg-surface，无 shadow），标题行 = 蓝色圆底徽章 + 白色下载箭头（lucide ArrowDown，与其他卡片图标徽章同款）+ 「下载热力图」+ 右侧「少□□□□□多」图例
- 悬停 tooltip：日期 + 当日下载数（ChartTooltip 风格），优先显示在格子上方、顶部行翻转到下方，绝不遮挡被悬停格子
- 数据源：`GET /api/stats/heatmap`（近 365 天，独立于页面右上 7/30/90 范围切换）

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 1px, 2px, 3px, 4px, 5px, 6px, 8px, 10px, 12px, 14px, 16px, 32px, 36px, 40px
- Notable gap: jumps from 16px to 32px — no 20px or 24px in primary scale

### Grid & Container
- Browse pages: left rail full-bleed to viewport edge (250px), content fills `flex-1` between the rails
- Standalone pages: single full-width column (`mx-auto w-full`); login uses `max-w-7xl`
- Browse routes: three-column docs layout — 250px folder-tree sidebar + `flex-1` content + 300px right rail (knowledge graph + AI chat card)
- Hero: centered single-column with generous top padding
- Feature sections: 2–3 column grids for cards
- No full-width divider lines — sections are separated by whitespace and surface tints only (无界)
- Side whitespace is kept tight: browse rails are full-bleed to both viewport edges, content fills the middle; standalone pages at 1280px
- Code/dashboard screenshots as full-width or contained with border

### Whitespace Philosophy
- Gallery emptiness: Massive vertical padding between sections (80px–120px+). The white space IS the design — it communicates that the site has nothing to prove and nothing to hide.
- Compressed text, expanded space: The aggressive negative letter-spacing on headlines is counterbalanced by generous surrounding whitespace. The text is dense; the space around it is vast.
- Section rhythm: Sections are separated by spacing and soft #FAFAFA surface tints first; lines are the exception, not the rule. When a divider is unavoidable, prefer a subtle surface tint or shadow ring over a hard line.

### Border Radius Scale
- Micro (2px): Inline code snippets, small spans
- Subtle (4px): Small containers
- Standard (6px): Buttons, links, functional elements
- Comfortable (8px): Cards, list items
- Image (12px): Featured cards, image containers (top-rounded)
- Large (64px): Tab navigation pills
- XL (100px): Large navigation links
- Full Pill (9999px): Badges, status pills, tags
- Circle (50%): Menu toggle, avatar containers

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat (Level 0) | No shadow | Page background, text blocks, **heatmap panel** (deliberately borderless) |
| Inset Panel (Level 1) | `#f7f8f9` tint, no shadow (`bg-inset`) | Chart stages, anomaly-card plot area |
| Card (Level 2) | `.rb-card` (CSS 类): rgba(0,0,0,0.08) 0 0 0 1px, rgba(0,0,0,0.04) 0 2px 2px, rgba(0,0,0,0.04) 0 8px 8px -8px, inner #fafafa ring | Upload/rename dialogs (`rb-card`). Dashboard cards are `bg-surface` with **no shadow** (无界) |
| Popover (Level 3) | 纯投影浮层，**无任何描边/光晕圈**（连 shadow-as-border ring 都不用）：rgba(0,0,0,0.06) 0 4px 10px + rgba(0,0,0,0.12) 0 12px 32px 双层柔和投影 | 设置弹窗内的下拉浮层（统一走 `.settings-popover` / `.settings-popover-option`：语言切换菜单 `.settings-lang-menu`、协议下拉 `.settings-select-menu`）与页面顶部 Toast（`Toast` 组件，error 红 / success 绿 / info 蓝 / warning 橙 四类型通知卡）；无界——浮层边界完全由投影海拔表达 |
| Raised Toggle (Level 2b) | `shadow-btn`: rgba(23,23,23,.12) 0 1px 2px, rgba(23,23,23,.06) 0 0 0 1px | Active pill toggles, refresh button |
| Input Border (inline) | rgba(0,0,0,0.08) 0 0 0 1px，**聚焦态同款**（不加蓝色光晕） | All form inputs/selects (CSS, not a token) |
| Focus (Accessibility) | 2px solid hsla(212, 100%, 48%, 1) outline | Keyboard focus on buttons/links only；input/textarea/select 无聚焦效果（无界，见 §2） |

> Removed from the config: `shadow-card`, `shadow-ring`, `shadow-ringlight`, `shadow-card-subtle`, `shadow-hairline` — nothing references them (the card stack lives only as the CSS class `.rb-card`).

Shadow Philosophy: Vercel has arguably the most sophisticated shadow system in modern web design. Rather than using shadows for elevation in the traditional Material Design sense, Vercel uses multi-value shadow stacks where each layer has a distinct architectural purpose: one creates the "border" (0px spread, 1px), another adds ambient softness (2px blur), another handles depth at distance (8px blur with negative spread), and an inner ring (#fafafa) creates the subtle highlight that makes the card "glow" from within. This layered approach means cards feel built, not floating.

### Decorative Depth
- Hero gradient: soft, pastel multi-color gradient wash behind hero content (barely visible, atmospheric)
- No section border lines between major sections (无界) — separation comes from spacing and surface tints
- No background color variation — depth comes entirely from shadow layering and subtle tint contrast

## 7. Do's and Don'ts

### Do
- Use OPPO Sans with negative letter-spacing at display sizes (−0.03em at 48px, CJK-adjusted)
- Separate content with whitespace and #FAFAFA surface tints first — lines only where function requires
- Use the three-weight system: 400 (body), 500 (UI), 600 (headings)
- Apply the four dashboard accent tokens (下载蓝/上传橙/今日红/占用绿) only inside dashboard cards — icon badges and data series
- Use the multi-layer card shadow stack via the `.rb-card` CSS class for dialogs; keep dashboard cards borderless (无界)
- Keep the color palette achromatic — grays from #171717 to #ffffff are the system
- Use #171717 instead of #000000 for primary text — the micro-warmth matters

### Don't
- Don't use positive letter-spacing on OPPO Sans — it's always negative or zero
- Don't use weight 700 (bold) on body text — 600 is the maximum, used only for headings
- Don't rely on lines/borders as the primary separation mechanism — that is the 只用线 (line-only) style, avoided by design (无界)
- Don't add divider lines under the topbar or between sections — surfaces and spacing divide the page
- Don't introduce accent colors (blues, oranges, greens) into the UI chrome outside the dashboard — rows, buttons, links and icons stay monochrome
- Don't use the old Vercel workflow colors (Ship Red #ff5b4f, Preview Pink #de1d8d, Develop Blue #0a72ef) — they were replaced by the four dashboard tokens
- Don't use heavy shadows (> 0.1 opacity) — the shadow system is whisper-level
- Don't increase body text letter-spacing — OPPO Sans is designed to run tight
- Don't use pill radius (9999px) on primary action buttons — pills are for badges/tags only
- Don't skip the inner #fafafa ring in card shadows — it's the glow that makes the system work

## 8. Responsive Behavior

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile Small | <400px | Tight single column, minimal padding |
| Mobile | 400–600px | Standard mobile, stacked layout |
| Tablet Small | 600–768px | 2-column grids begin |
| Tablet | 768–1024px | Full card grids, expanded padding |
| Desktop Small | 1024–1200px | Standard desktop layout |
| Desktop | 1200–1400px | Full layout, maximum content width |
| Large Desktop | >1400px | Centered, generous margins |

### Touch Targets
- Buttons use comfortable padding (8px–16px vertical)
- Navigation links at 14px with adequate spacing
- Pill badges have 10px horizontal padding for tap targets
- Mobile menu toggle uses 50% radius circular button

### Collapsing Strategy
- Hero: display 48px → scales down, maintains negative tracking proportionally
- Navigation: StaggeredMenu hamburger on all sizes (no topbar on any layout)
- Left rail (brand + search + folder tree): hidden below `lg` (1024px) — mobile gets a slim brand row, search below it, navigation falls back to StaggeredMenu + search
- Feature cards: 3-column → 2-column → single column stacked
- Code screenshots: maintain aspect ratio, may horizontally scroll
- Trust bar logos: grid → horizontal scroll
- Footer: multi-column → stacked single column
- Section spacing: 80px+ → 48px on mobile

### Image Behavior
- Dashboard screenshots maintain border treatment at all sizes
- Hero gradient softens/simplifies on mobile
- Product screenshots use responsive images with consistent border radius
- Full-width sections maintain edge-to-edge treatment

## 9. Agent Prompt Guide

### Quick Color Reference
- Primary CTA: Vercel Black (#171717)
- Background: Pure White (#ffffff)
- Heading text: Vercel Black (#171717)
- Body text: Gray 600 (#4d4d4d)
- File icons: Gray 600 (#4d4d4d, monochrome)
- Card shadow: `.rb-card` CSS class (dialogs only; see §6). Dashboard cards are borderless.
- Link: Link Blue (#0072f5, brand-600)
- Focus ring: Focus Blue (hsla(212, 100%, 48%, 1)) — 仅按钮/链接；表单控件聚焦不加任何描边/光晕（无界）
- Dashboard accents (cards only): 下载 `--accent` #3d9aff · 上传 `--orange` #f68f3c · 今日 `--red` #ee5c61 · 存储 `--green` #3fae6b

### Example Component Prompts
- "Create a hero section on white background. Headline at 48px OPPO Sans weight 600, line-height 1.00, letter-spacing -0.03em, color 
#171717. Subtitle at 20px OPPO Sans weight 400, line-height 1.80, color 
#4d4d4d. Dark CTA button (
#171717, 6px radius, 8px 16px padding) and ghost button (white, shadow-border rgba(0,0,0,0.08) 0px 0px 0px 1px, 6px radius)."
- "Design a card: white background, no CSS border. Use shadow stack: rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 2px, 
#fafafa 0px 0px 0px 1px. Radius 8px. Title at 24px OPPO Sans weight 600, letter-spacing -0.02em. Body at 16px weight 400, 
#4d4d4d."
- "Build a dashboard icon badge: 14px circle, solid accent background (下载 `--accent` #3d9aff / 上传 `--orange` #f68f3c / 今日 `--red` #ee5c61 / 存储 `--green` #3fae6b), white 8px lucide icon, strokeWidth 3, next to a 12px weight 500 OPPO Sans card title."
- "Create navigation: #FAFAFA sticky header with no divider line (无界). OPPO Sans 14px weight 500 for links, 
#171717 text. Dark pill CTA 'Start Deploying' right-aligned."
- "Build the download heatmap card: GitHub-style year grid (week columns × 7 day rows), 5-level blue ramp from `var(--field)` to `var(--accent)`, cells 12–22px with 5px gaps, borderless white panel, title row = accent icon badge + 12px title + 少□□□□□多 legend, hover tooltip above the cell (flip below on top rows)."

### Iteration Guide
1. Separate with whitespace and surface tints first; use shadow-as-border (0px 0px 0px 1px rgba(0,0,0,0.08)) only where a line is functionally required — never outline everything (无界)
2. Letter-spacing scales with font size: -0.03em at 48px, -0.02em at 32px, -0.02em at 24px, normal at 14px (CJK-adjusted)
3. Three weights only: 400 (read), 500 (interact), 600 (announce)
4. Color is functional, never decorative — workflow colors (Red/Pink/Blue) mark pipeline stages / data series only
5. The inner #fafafa ring in card shadows is what gives cards their subtle inner glow
6. Uppercase mono labels for technical metadata, OPPO Sans for everything else
7. Keep brand assets verbatim: 仲英学辅资料库 brand name, logo, OPPO Sans typeface