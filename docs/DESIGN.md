# 仲英学辅资料库 · 设计系统规范

> **文档定位**：本文档描述 zyxf（仲英学辅资料库）**已经实现**的界面规范，每条都能在代码里找到出处。设计语言受 Vercel 启发（压缩字距、shadow-as-border、多值阴影栈），但 Vercel 官网里本项目**未落实**的内容（Workflow Pipeline、Trust Bar、Metric Cards、Image Treatment、多档断点表、英文示例文案等）不再收录——避免后来者照着做不存在的组件。
>
> **品牌与硬约束**
> - **品牌字体**：OPPO Sans 4.0（`@font-face` 名 `OPPOSans`，字重 100–900）。源字体经 npm 管理（`@fontpkg/oppo-sans-4-0`，**不入库**），构建期由 `frontend/scripts/build-font.mjs` 子集化为**两层 woff2**（常用层 1.53 MB 随首屏 + 生僻层 1.35 MB 按 `unicode-range` 按需，合计 2.75 MB，字重轴保留；`@font-face` 生成到 `src/assets/fonts/opposans.css`）。Geist 并未落地到本项目，保留的只是它的排版原则：压缩、三档字重、紧字距。
> - **品牌标识**：`favicon.png` 与品牌名（仲英学辅资料库 / 仲英书院学业辅导中心 / 仲英学辅）逐字保留，不翻译、不改写。
> - **文案语言**：简体中文 / English 双语，全部走 i18next 字典（`frontend/src/i18n/zh.js`、`en.js`）——**源码里不得硬编码中文**（`frontend/src/test/i18n.test.js` 强制）。品牌名、语言自身的名字（中文 / English）不翻译。
> - **主题**：亮 / 暗 / 跟随系统三态，由 `useTheme()` 写 `<html data-theme>` 驱动 CSS 变量（`index.css` 的 `[data-theme='dark']`）。组件一律消费 token，因此**不需要为暗色另写样式**。
> - **设计理念「无界」**：边界不靠边框线，而靠**表面色深浅**、**留白**与**投影海拔**表达。CSS `border` 只在功能确有必要时出现（例如设置列表行、关于页分隔、搜索下拉底部状态行、文件预览头部、重命名输入框）。全站**没有 topbar**：导航是各尺寸共用的 StaggeredMenu 汉堡菜单，品牌 / 搜索 / 目录树住在左栏。

## 1. 视觉主题与氛围

界面是一套克制的单色系统：页面底色 `var(--page)`（亮色 #f8f8f8、暗色 #161616），正文与标题 `var(--ink)`（亮色 #171717、暗色 #ededed），卡片是纯 `var(--surface)`（亮色 #ffffff）。层次由三层表面色加留白拉开，而不是描边：`--surface` 卡片 → `--inset` 内嵌面板（#f7f8f9）→ `--field` 头部条 / 输入槽（#efefef），左栏另有 `--app-sidebar`（#ececee）。

文字尺码整体偏小（正文/UI 12–16px），信息密度靠**小字号 + 紧字距 + 大留白**撑起：`h1/h2/h3` 分别带 −0.03em / −0.025em / −0.02em 字距，统计卡片标题只有 12–13px；留白上资料库与统计面板走 12–16px 的紧凑节奏，关于我们页这类文档流才到 40–64px。

关键特征：
- OPPO Sans + `em` 档负字距（CJK 适配）：标题「压缩」，正文「正常」
- 三栏资料库布局：左栏目录树（可收起）、中列文件列表、右栏知识图谱 + 智能对话（`lg` 及以上）
- **无界分层**：Dashboard 卡片与浏览页三卡片都是 `bg-surface`，**无阴影无描边**；分隔靠留白与表面色深浅。`shadow-as-border` 只作为技术手段留在 ghost 按钮、搜索下拉与表单 hairline 上
- 多值阴影栈只出现在真正需要海拔的地方：上传 / 重命名弹窗（`.rb-card`，四层）、搜索下拉（四层）、图表提示（两层）、提拉式胶囊按钮 / 刷新按钮（`shadow-btn`）、设置弹窗与其浮层（§6 Level 3）、胶囊按钮的 hover 态
- 颜色有语义：`--red` 兼作全局错误色，四个数据色只服务统计面板与文件族别徽章（§2）；除此之外界面保持单色
- 数字统一 `tabular-nums`（度量、日期、坐标轴）；等宽字体只用于 AI 回复里的技术片段
- 键盘可达：按钮 / 链接有 2px Focus Blue 焦点环（**例外**：菜单开关、菜单项、社交链接与设置弹窗里若干按钮显式 `outline: none` 且暂无替代样式，属已知缺口，见 `docs/ISSUES.md` IMPROVE-33）；热力图单元格进 Tab 顺序并用 `aria-label` 播报日期与下载数

## 2. 色彩与角色

### 主色
- **Vercel Black `var(--ink)` #171717**：正文、标题、深色按钮 / 表面。刻意不用纯黑，微暖以避生硬。
- **Pure White `var(--surface)` #ffffff**：卡片与面板底色。
- **页面底色 `var(--page)` #f8f8f8**：`html/body/#root` 的底色；也是 `.rb-btn-dark` 的**文字色**（暗色下按钮整体反转：底 #ededed、字 #161616）。
- **纯黑 #000000**：出现在菜单开关按钮（hover #1a1a1a）、AI「生成中」的像素网格与微光渐变，以及关于页案例卡的黑色底图——都不是通用色。

### 品牌交互色（Tailwind `brand` token）
- `brand-600` #0072f5（Link Blue）、`brand-500` #0a72ef（Develop Blue）、`brand-700` #0068d6（Badge Blue Text）
- ⚠️ **填充态被全局改成单色**：`index.css` 的 `.app-theme .bg-brand-500, .app-theme .bg-brand-600 { background: var(--ink) !important; color: var(--page) !important }`，`.app-theme .hover\:bg-brand-700:hover` 同理收成 `var(--ink-2)`。所以「登录 / 预览 / 上传 / 进度条」上写的 `bg-brand-*` 实际渲染为墨黑——CTA 保持单色是刻意设计，**不要靠 `bg-brand-*` 拿品牌蓝**。
- 品牌蓝因此只在**文字色**上生效：链接（`text-brand-600`）、加载 spinner、品牌名 hover（`hover:text-brand-500`）、AI 回复里的链接（`#0a72ef`）。

### 数据可视化 token（`index.css :root` 定义，经 Tailwind token 消费）
- `--accent` #3d9aff（下载蓝）：下载热力图色阶顶档、下载类卡片徽章
- `--orange` #f68f3c（上传橙）：近期上传徽章、word/ppt/txt 族别徽章
- `--red` #ee5c61（今日红）：「今日」卡片徽章与曲线、pdf 族别徽章、**全局错误文本**
- `--green` #3fae6b（占用/存储绿）：热门文件夹徽章、excel 族别徽章、环比上升提示
- 用途边界：四个 token 既服务统计面板，也承担**语义色**（错误 / 文件族别），因此不再声称「只在仪表盘使用」。除此之外的颜色只来自中性色阶，以及下面两处自有配色。

### 两处自有配色（改动时不要再扩散）
- **导航菜单 `StaggeredMenu`**：开关按钮黑底白字（hover #1a1a1a + 双层投影 rgba(0,0,0,.25) 0 0 0 1px / rgba(0,0,0,.2) 0 2px 4px）；面板是白底（`--surface`），但强调色用紫 `--sm-accent` = #5227FF（社交标题与链接 hover）；账号操作图标分色——登录 #3fae6b（底 rgba(63,174,107,.12)）、退出 #d10d0d（底 rgba(209,13,13,.1)）。
- **关于我们页**：DM Sans + 直角 + 细边，配色自成一页（见 §4）。

### 中性色阶（Tailwind `slate` 被重映射为 Vercel 中性灰）
| token | 值 | 用途 |
|-------|-----|------|
| `slate-50` | #FAFAFA | 次级表面色、图表提示 |
| `slate-100` | #F5F5F5 | 软填充、登录页输入框底色 |
| `slate-200` | #EBEBEB | 浅描边 |
| `slate-300` | #D4D4D4 | 强描边 |
| `slate-400` | #808080 | 占位符、禁用态、日期 / 元信息、灰色徽章 |
| `slate-500` | #666666 | 三级文字 |
| `slate-600` | #4D4D4D | 次级文字（文件图标等） |
| `slate-700` | #404040 | hover 文字 |
| `slate-800` | #262626 | 深面 |
| `slate-900` | #171717 | 主文字（= `--ink`） |

### 语义 token（亮色；`index.css :root`）
- 文字阶：`--ink` #171717 · `--ink-2` rgba(23,23,23,.65)（次级文字，如目录树行、聊天正文）· `--ink-3` rgba(23,23,23,.45)（三级文字、占位符、目录标签）
- 表面阶：`--page` #f8f8f8 · `--surface` #ffffff · `--inset` #f7f8f9（图表 / 内嵌面板、目录树激活项）· `--field` #efefef（卡片头部条、输入槽、分段控件底、热力图空格）· `--app-sidebar` #ececee（资料库左栏、设置弹窗左栏）
- 线与态：`--hover` rgba(23,23,23,.05)（行 hover、浮层选项 hover）· `--line` rgba(23,23,23,.08)（细分割线，设置行等）· `--line-strong` rgba(23,23,23,.14)（**表单 hairline**、富文本引用线、图谱文件节点描边）
- 图谱专用：`--kg-label-stroke` #ffffff（亮色下给图谱标签白衬边；暗色为 `transparent`）

### 暗色主题（`[data-theme='dark']`）
- 反转核心阶：`--ink` #ededed · `--ink-2` rgba(237,237,237,.65) · `--ink-3` rgba(237,237,237,.45) · `--page` #161616 · `--surface` #1e1e1e · `--inset` #222222 · `--field` #282828 · `--app-sidebar` #1a1a1a
- 线：`--hover` rgba(255,255,255,.06) · `--line` rgba(255,255,255,.1) · `--line-strong` rgba(255,255,255,.16)
- **四个数据色不变**（`--accent/--orange/--red/--green` 只定义一次）
- 个别组件仍需显式适配：设置弹窗输入框由 `#F5F5F5` 换成 `var(--field)`（`SettingsModal.css` 的 `[data-theme='dark']` 段），白毛玻璃遮罩在暗色改为黑毛玻璃

### 表面与遮罩
- **磨砂遮罩 `.rb-frost-backdrop`**：亮色 rgba(255,255,255,.46) + `backdrop-filter: blur(5px)`；暗色 rgba(0,0,0,.46)。StaggeredMenu、使用须知弹窗、知识图谱全屏弹窗、设置弹窗共用。
- 全站**没有**自定义 `::selection`（用浏览器默认）。

### 阴影（卡片阴影是 CSS 类，不是 Tailwind token）
- **`.rb-card`**（`index.css` 内联定义）：rgba(0,0,0,.08) 0 0 0 1px + rgba(0,0,0,.04) 0 2px 2px + rgba(0,0,0,.04) 0 8px 8px -8px + #fafafa 0 0 0 1px（内环）——**只用于上传 / 重命名弹窗**。
- **`shadow-btn`**（Tailwind token）：rgba(23,23,23,.12) 0 1px 2px + rgba(23,23,23,.06) 0 0 0 1px——提拉胶囊（时间范围切换、刷新、聊天引用胶囊、活跃分段）。
- **`.rb-btn-ghost` 的 hairline**：rgba(0,0,0,.08) 0 0 0 1px，hover 加深为 rgba(0,0,0,.12)，背景不变。
- **搜索下拉 `.rb-search-dropdown`**：`var(--line-strong)` 0 0 0 1px + rgba(0,0,0,.04) 0 2px 2px + rgba(0,0,0,.04) 0 8px 8px -8px + `var(--surface)` 内环。
- **设置弹窗卡片**：0 1px 2px rgba(0,0,0,.04) + 0 28px 64px -20px rgba(0,0,0,.28)，16px 圆角。
- **图表提示 `.insight-chart-tooltip`**：rgba(23,23,23,.08) 0 0 0 1px + rgba(23,23,23,.12) 0 8px 24px。
- **Toast 自带投影**：rgba(149,157,165,.2) 0 8px 24px（沿用 uiverse 通知卡样式，**不属**本系统的阴影语汇，见 §6 注）。
- **底部悬浮胶囊 `FloatingPill`**：Tailwind 默认 `shadow-md`（同样不在 token 体系内，见 §6 注）。
- 已从 `tailwind.config.js` 移除且全仓零引用：`shadow-card`、`shadow-ring`、`shadow-ringlight`、`shadow-card-subtle`、`shadow-hairline`；卡片阴影栈只以 `.rb-card` 类存在。

## 3. 排版规则

### 字体
- **主字体**：OPPO Sans（`@font-face` 名 `OPPOSans`，可变字重 100–900），回退栈 `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Roboto, Arial, sans-serif`；`body/button/input/textarea/select` 统一继承，并开 `text-rendering: geometricPrecision` 与灰度抗锯齿。
- **`'SF Mono'` 别名**：`index.css` 把 `'SF Mono'` 这个字体名指向同一份 OPPO 字体（与 `OPPOSans` 同样的常用/生僻两层声明）——liveline 图表内部硬编码 `"SF Mono", Menlo, monospace`，在 Windows 上不存在该族，别名后图表文字与应用一致。
- **关于我们页例外**：整页用 **DM Sans**（Google Fonts，400/500），主标题 `font-light`（300），以拉开与资料库主页的调性。
- **等宽**：本项目未覆写 `fontFamily`，`font-mono` 就是 Tailwind 默认栈（Menlo / Monaco / Consolas / "Liberation Mono" / "Courier New"）。全站唯一的使用处是 AI 消息小节头的耗时计时器（12px + `tabular-nums`）；AI 正文里的行内 `code` 只做了 12px 灰底，**没有**换字族。
- **OpenType**：全仓未启用任何 `liga`；`tabular-nums` 用在图表提示、度量数字与统计面板的列表数字上（`font-variant-numeric: tabular-nums`）。

### 字距（CJK 适配，`index.css` 的 `.app-theme h1/h2/h3`）
- h1 −0.03em · h2 −0.025em · h3 −0.02em
- 卡片标题与度量数字 −0.01em；品牌名 `.rb-brand-title` 17px/500/−0.01em
- 特例（**正**字距，用于小字号提升可读性）：图表提示的时间戳 10px + `letter-spacing: .08em` + `uppercase`；使用须知标题、设置面板内容标题与字段标签 +0.01em；设置里主题色板的品牌色块 +0.02em；关于我们页的标签徽章与跑马灯文字 `tracking-wide`（+0.025em）
- 正文（`.app-theme` 根）`letter-spacing: 0`、`font-weight: 400`

### 实际字号表（按代码里真实出现的档位）
| 角色 | 字号 / 字重 | 说明 |
|------|-------------|------|
| 登录页品牌主标题 | 40px / 600 / tracking-tight | `AuthPage` 左栏暗色品牌面板 |
| 关于我们主标题 | `clamp(1.8rem, 3.2vw, 2.8rem)` / 300 / tracking-tight | 上限约 44.8px |
| 登录面板品牌名 | 22–26px（`sm:` 抬升）/ 700 | 唯一在大字号上用 700 的地方 |
| 度量数值 | 17px / 600 + `tabular-nums` | 「今日」大数字、类型分布主数值 20px |
| 表单 / 空态标题 | 20–22px / 600；15px / 600 | 登录注册标题、`settings-empty-title` |
| 品牌名 | 17px / 500 / −0.01em | `.rb-brand-title`（浏览器标题行、左栏与统计面板标题共用） |
| Toast 主行 | 15px / 700（副行 13px #555） | 沿用通知卡样式 |
| 正文 / 目录树行 | 14px / 400–500 | 列表行、目录树行（菜单项另见下行） |
| 导航菜单项 | `clamp(1.8rem, 8vw, 2.2rem)`（约 29–35px）/ 600 | StaggeredMenu 面板主项，全站最大的常驻文字 |
| 卡片标题 / 聊天标签 | 13px / 500–600 | `PanelHeader` 标题、弹窗下拉选项 |
| 元信息 / 表头 / 按钮小字 | 12px / 400–500 | 日期、表头、排序段、文件大小胶囊 |
| 图表提示行 | 11px / 400–600 | 时间戳 10px |
| 热力图轴 | 10px | 月份 / 星期标签、图例方块 9px |
| 徽章字形 | 8px / 700（类型缩写 7px） | 彩色圆底徽章内的 lucide 图标为 8px |

### 原则
- **三档字重** 400（阅读）/ 500（交互）/ 600（标题与强调）承担几乎所有层级；700 只用于登录品牌名、Toast 主行与微徽章，300 只用于关于我们主标题。
- **压缩作为身份**：字号越小，字距越接近 0；字号越大，负字距越明显。
- 层级靠字号 + 字距 + 颜色深浅（`--ink` → `--ink-2` → `--ink-3`）建立，不靠粗体堆叠。

## 4. 组件样式

### 按钮
**主按钮 `.rb-btn-dark`**（`index.css`）
- 底色 `var(--ink)`、文字 `var(--page)`；hover 变 `var(--ink-2)`（**比常态更浅，不是纯黑**）；禁用 opacity .5
- 内边距 8px 16px、**圆角 14px**、14px / 500 / line-height 1.43、`inline-flex` + 0.4rem 间距
- 用例：工具栏「上传」（加 `h-[34px]`）、重命名弹窗「保存」

**次级按钮 `.rb-btn-ghost`**
- 白底（`var(--surface)`）、文字 `var(--ink)`、圆角 **6px**、内边距同主按钮
- 边界用 shadow-as-border：rgba(0,0,0,.08) 0 0 0 1px；**hover 只把 ring 加深到 rgba(0,0,0,.12)，背景不变**
- 用例：重命名弹窗「取消」、设置弹窗次级按钮（在 `.settings-actions` 内圆角对齐 14px）

**工具栏按钮 `.rb-toolbar-btn`**
- 34px 高、`var(--surface)` 底、`var(--ink-2)` 文字、**圆角 14px**、13px / 500；hover 加轻投影（hairline + 2px 模糊）
- 用例：「新建文件夹」、刷新 / 返回上级图标按钮、排序分段控件外壳（`!px-0`）

**提拉胶囊 / 刷新（`shadow-btn`）**
- `bg-surface` + 全圆角 + `shadow-btn`；活跃为「抬起的白胶囊」，非活跃为 `text-ink-3 hover:text-ink-2`
- 用例：统计面板时间范围（7 / 30 / 90 日）、「今日」卡片的下载 / 上传指标切换（该处底槽是 `bg-field` 分段控件，活跃项 `bg-surface shadow-btn`）、刷新按钮

**图标按钮 `ICON_BUTTON_CLASS`**（`components/ui.js`，头部通用）
- 24px（`size-6`）圆角 6px、`text-ink-3`，hover `bg-hover` + `text-ink-2`；知识图谱全屏弹窗的关闭按钮是 36px 版本

### 彩色图标徽章（`IconBadge`）
- 14px 圆形（`size-3.5 rounded-full`）+ 纯色实底 + 白色 8px lucide 图标（`size-2`，`strokeWidth={3}`）
- 颜色随语义：下载 `bg-accent`、上传 `bg-orange`、今日 `bg-red`、文件夹 / 存储 `bg-green`
- 用于下载热力图、今日动态、下载量、近期上传、热门文件夹等卡片标题行
- **例外**：类型分布卡用的是同尺寸的**实心圆形** + 8px 粗体文字缩写（`word/ppt/xls…`），不用 lucide 图标

### 卡片与容器
- **Dashboard 卡片**（`rounded-card bg-surface p-3`）：白底、12px 圆角、**无阴影无描边**、12px 内边距；卡片间距与区块间距都是 12px（`gap-3` / `space-y-3`）
- **内嵌面板**（`rounded-control bg-inset`）：10px 圆角、#f7f8f9 底，用于今日曲线绘图区、类型分布等内嵌区
- **卡片头部 `PanelHeader`**：`bg-field` 灰条 + `p-1.5`，标题 13px / 500，右侧图标按钮 24px / 圆角 6px + 收起 chevron；知识图谱与智能对话共用，防止两处漂移
- **浏览页三卡片**（文件列表 / 知识图谱 / 智能对话）：`bg-surface rounded-[14px]`，**无边框无阴影**；卡片内部用 `PanelHeader` 灰条，文件列表用的是表头行
- **图表舞台**：`.insight-chart-stage` + `.insight-chart-cursor`（1px 竖线）+ `.insight-chart-tooltip`（圆角 10px、11px 文字、`min-width: 132px`、双层投影）；liveline 自带的悬浮气泡被 CSS 隐藏，只用自绘提示

### 文件列表（资料库中列）
- **表头行**：`bg-field`（#efefef）灰底、12px、文字被 `.rb-table-heading` 强制为 `var(--ink)`；窄屏隐藏（`hidden sm:flex`）
- **行**：`px-3 sm:px-4 py-3 sm:py-2.5`，hover 由 **GlideList 滑动高亮条**表达，色值 `bg-hover` = rgba(23,23,23,.05)；**没有分隔线**，也没有描边
- **行反馈**：按下 `active:scale-[0.98]`；键盘焦点 `focus-visible:ring-2 ring-inset ring-ink/30`
- **日期 / 元信息**：12px `slate-400`（#808080）
- **大小胶囊 `.records-tag`**：圆角 6px、12px / 500、`2px 8px` 内边距；颜色由 `--tag-base` 经 `color-mix` 派生，按列表内大小的 6 档分位取绿 → 蓝 → 紫 → 粉紫 → 粉 → 红（列表里唯一的彩色元素）
- **行操作按钮**：单色图标，`p-1 rounded`（4px）+ hover `bg-black/5`
- **拖放指示**：中性——拖入 `rgba(0,0,0,.05)` 底 + 1px inset ring，插入线 `inset 0 2px 0 rgba(0,0,0,.6)`
- **浮动提示胶囊**：中性（`bg-black/5` + 1px `black/10` 边框）；错误态用语义红（`text-red` + #fef2f2 底 + #fecaca 边）

### 目录树（左栏 `FolderTree`）
- 区块标签「目录」：12px / 500，色 `--ink-3`
- 行：14px / 400，色 `--ink-2`，高 32px、圆角 6px、缩进 8px + 每级 16px
- 当前文件夹：`bg-inset`（#f7f8f9）底 + 500 字重 + `var(--ink)`——是**底色块**，不是描边
- hover：GlideList 滑动高亮条（`bg-hover`）
- 展开 chevron 14px，展开时旋转 90°；点击文件名跳转；当前路径的祖先链自动展开
- 监听全局 `folders-changed` 事件刷新；数据来自 `GET /api/folders/tree`
- 滚动条：`.rb-side-scroll` 静止时隐藏、滚动或 hover 时显示（8px 圆角滑块），并把**底部** 16px 用 mask 渐隐融入栏底

### 搜索（左栏与移动端）
- **胶囊 `.rb-search-pill`**：白底、圆角 14px、**无描边**；`focus-within` 只加一层极浅投影 rgba(0,0,0,.05) 0 2px 4px；内部 `input` 背景 / 描边 / 焦点环全部清空
- **下拉 `.rb-search-dropdown`**：圆角 12px、白底、`--line-strong` 细环 + 两层浅投影；结果行 hover `bg-slate-50`（#FAFAFA）
- 移动端搜索是独立一行（`w-[92%]` 居中），品牌行下方

### 导航（`StaggeredMenu`，全尺寸通用）
- 全站**没有 topbar**：导航开关钉在右上角（`top: 5px`），所有尺寸一致；点击向右滑出面板。面板宽 `clamp(240px, 30vw, 340px)`；`≤1024px` 时 `clamp(280px, 48vw, 340px)`；`≤640px` 时随一个 92% 宽的菜单头条（`left: 6.5%`）布局，面板 `clamp(240px, 78vw, 340px)`
- 开关按钮：黑底白字、最小高 34px、**14px 圆角**、14px / 600（不是 50% 圆形，也不是白底）；hover #1a1a1a + 双层投影（见 §2 自有配色）
- 面板内容自上而下：主导航（资料库 / 统计面板 / 关于我们，14px / 600，**没有 active 态**）+ 社交渠道（Bilibili）+ 底部账号卡
- 账号卡：未登录时是中立卡（图标头像 + 「未登录 / 游客」文案），点整卡进登录；已登录显示用户名 + 角色，右侧两个图标操作——齿轮打开全局设置，另一个是登录 / 退出（配色见 §2）
- 打开时用 `.rb-frost-backdrop` 遮罩；面板内文字与图标在打开态强制白 / 黑配对，避免被全局 `.app-theme svg { color: var(--ink) }` 规则染成墨色

### 知识图谱（右栏卡片）
- 位置：`lg` 及以上固定在右栏（300px），与智能对话上下相邻（间距 15px）；`lg` 以下整栏隐藏，不做内联回退
- 头部条可经 chevron 收起为一条灰底胶囊（高度 360ms 过渡），收起时 globe / 全屏按钮隐藏，收起状态跨路由保留
- 力导向布局（d3-force）：节点半径按度数缩放 `2 + sqrt(degree) * 2.2`；文件夹实心 `var(--ink)`，文件 `var(--surface)` 填充 + `var(--line-strong)` 描边；当前文件夹多一圈外环（`r + 3`，`var(--ink)`，opacity .5）
- ⚠️ 实现约束：局部子图每次都从 `fullGraph` 的**拷贝**构建、端点交回字符串 id —— d3-force 会就地改写传入对象（link 端点变节点对象、节点被写 x/y），共享 memo 里的对象会让「第二次进入同一处」的局部子图退化成单节点、度数也记到 `"[object Object]"` 上（BUG-98）
- **局部视图**：当前文件夹 + 直接邻居；globe 按钮打开全库弹窗（最大 1200×85vh、圆角 14px、投影 rgba(0,0,0,.12) 0 16px 48px）
- hover 高亮该节点与邻居：其余节点透明度 0.12，连线 0.7 / 其余 0.05
- 标签：hover 或放大超过 1.2× 时显示，10px，节点上方 6px，带 `--kg-label-stroke` 衬边
- 交互：拖背景平移、滚轮缩放（0.25–2.5）、拖节点、单击（未拖动）进入文件夹 / 预览文件；静止后自动适配视野
- 画布四边 16px mask 渐隐（`.kg-graph`），避免节点在卡片边缘被硬裁

### 智能对话（右栏卡片）
- 与知识图谱同款外壳：`bg-surface`、无边框无阴影、`PanelHeader` 灰条 + 13px 标题 + 24px 图标按钮（清空 / 设置 / 收起）
- 收起 / 展开同款 360ms 交互：实现上以像素高度冻结内容（不重排），消息列表常驻 `overflow-y-auto`（`scrollbar-gutter: stable` 全局设在 `html` 上，滚动条槽位恒定，路由切换不会让居中内容跳动）
- 输入区：`bg-field` 圆角 10px、无描边、仅极浅投影（聚焦微调）；发送按钮是深色圆角方块，流式中变为停止按钮
- 消息区：用户消息右对齐灰底气泡；AI 回复带小节头（检索中 / 生成中 / 完成 / 出错）+ 耗时，流式打字机渲染；引用渲染为**可点击文件胶囊**（`h-6 rounded-full bg-inset` + `shadow-btn` + 族别彩色小徽章 + 文件名 + 外链图标）；空态给三条建议 chip
- 依赖 `LLM_*` 环境变量（未配置时返回 503 → 「AI 功能未配置」）

### 设置（`SettingsModal`，真实路由 `/settings`）
- **打开方式**：菜单里的齿轮、对话卡片的齿轮都打开这个全局弹窗；它是**真实路由**（`/settings`，手机端二级为 `/settings/:section`），系统返回手势由路由天然接管：`/settings/ai` → 返回 → `/settings`（一级列表）→ 返回 → 打开设置前的页面。打开时把当前页面存进 `history.state.background`，弹窗之外**原页面照常渲染**（`/settings` 深链也能用）；关闭时用背景位置**替换**设置条目，历史里不留残影
- **桌面（>640px）**：卡片固定 **800×580**（视口更小时按 `100vw/vh - 32px` 收窄），圆角 16px、投影见 §2；左右两栏 = **220px 侧栏** + 内容区（标题 56px 右内边距，关闭按钮绝对定位在卡片右上角 10px 处）。侧栏底色是 `--app-sidebar`（#ECECEE，与资料库左栏同一档灰），**不画分割细线**，靠灰底与右栏白底分区；**顶部有「设置」标题**（18px / 600 / +0.01em，与右栏板块标题同一行高、同样 18px 起点，两栏标题对齐），线下是垂直导航（智能对话配置 / 账户信息 / 外观，行尾 ✓ 表示当前板块、› 表示可进入）；条目交互是**单向往白靠**的两档——hover 半档白（`color-mix(in srgb, var(--surface) 55%, transparent)` ≈ #F6F6F7），选中整档白（`var(--surface)`）+ 与 `shadow-btn` 同款的两层提拉投影（和统计面板的时间范围 / 指标胶囊同一套语汇：组内只有选中项浮到表面上），未选中项靠文字色深浅（`--ink-2` → `--ink`）区分。暗色下 `--surface` 比栏底更暗，改用具名白色叠加（hover `rgba(255,255,255,.06)`、选中 `.12`），方向才不会反过来；手机端条目本来就坐在白卡片里，hover / 选中都回到 `--hover` 浅灰块并去掉投影
- **手机（≤640px，`useMediaQuery('(max-width: 640px)')`）**：整屏页面、底色换成 `--page`，分区靠白色圆角卡片；顶部条 = 左侧圆形按钮（**一级与二级都是 ‹，关闭与返回同形**）+ 居中标题（一级「设置」、二级为板块名）；**一级只显示设置列表**（图标 + 文案 + ✓ / ›），点行进入二级；**二级显示板块内容 + 底部操作条**，板块内容不再往下拆（「外观」= 界面主题 + 字体语言同页）
- **智能对话配置（内容区右栏）**：顶部是**配置来源二选一**（自绘 radio，纵向排列：「使用服务器配置」/「使用自定义配置」；未选 1px `--line-strong` 环，选中 `--ink` 环 + 实心点；选中只换颜色不改字重，避免文字跳动）。选服务器配置时**整块隐藏四个字段**，只显示 server 提示
- **字段顺序**：API 地址 → API 协议 → API Key → 模型；分组靠留白（块间距 20px / 字段间距 14px / 标签到输入框 6px），不套底色块；**除 API 地址给通用示例 `https://api.example.com/v1` 外，其余字段不给占位文字**（占位易被误读成已填值）
- **保存校验**：选「自定义配置」时，API 地址 / API Key / 模型**三项 trim 后都非空**才写入 localStorage——半份配置 `ChatComposer` 根本不会下发，存下来等于没配置（口径与 `modeOf` / `hasClientCfg` 一致）。**校验只在提交时开始**：打开弹窗、刚切到自定义配置时都不标红、不提示；点过「保存」而仍缺项时，**不写存储**，表单下方出现一行 `--red` 提示（`role="alert"`）、缺的字段标签标红（`aria-invalid` + `aria-describedby` 指回该提示），标红随填写实时收敛、三项补齐即自动消失，切换配置来源则整体撤回。协议有默认值，不参与校验；「使用服务器配置」下保存 = 清掉本地存储，不受校验影响
- **输入框 / 下拉**：浅灰底 #F5F5F5（暗色 `var(--field)`）、无细线描边、**聚焦也不加光晕 / 描边**；协议用**自绘下拉**（触发按钮 + Level 3 浮层，与「外观」页语言下拉共用 `.settings-popover` / `.settings-popover-option`；**不用原生 `<select>`**，它的 option 列表由系统绘制，跟不上暗色与无界风格）。字段容器用 `div` 而非 `label`——否则 label 会把点击转发给触发器，让整行都可点；命名靠触发器的 `aria-label`
- **协议名用官方叫法**：`OpenAI Chat Completions` / `OpenAI Responses` / `Anthropic Messages`，与 id `openai-completions` / `openai-responses` / `anthropic-messages` 一一对应
- **操作条 `.settings-actions`**：右栏**底部固定条**（在滚动区之外，钉在右下角），次级 `rb-btn-ghost`（圆角对齐 14px）+ 主 `rb-btn-dark`；「保存」在服务器配置下会清掉本地存储，「恢复默认设置」= 回到服务器配置 + 清空
- 配置存 localStorage，请求时随 body 下发覆盖服务端 env（服务端已配置时不再下发用户 Key）

### LLM 协议适配（三选一）
- **`openai-completions`**：`${baseUrl}/chat/completions`，`Authorization: Bearer`
- **`openai-responses`**：`${baseUrl}/responses`，system 走顶层 `instructions`、工具是独立的 `function_call` 条目、工具结果 `function_call_output` 用 `call_id` 关联、`store: false` 不在上游留副本
- **`anthropic-messages`**：`${baseUrl}/messages`，`x-api-key` + `anthropic-version`，system 走顶层，工具调用换成 `tool_use` / `tool_result` 内容块
- 差异全部收敛在 `backend/src/llmProtocols.js`（纯函数 + `PROTOCOL_IMPLS` 分发表），`chat.js` 的工具回路与前端事件形状都不感知协议；服务端由 `LLM_PROTOCOL` 选（旧值 `openai` / `anthropic` 仍兼容），浏览器端由设置页的「API 协议」选。两边都会给地址接上各自协议对应的路径，所以**地址只填到版本层**

### 弹窗、通知与遮罩
- **上传 / 重命名弹窗**：`.rb-card` 阴影栈 + `bg-white` + 8px 圆角（`rounded-lg`），自带**纯黑遮罩**（重命名 `bg-black/35`、上传 `bg-black/60`），不用磨砂遮罩；弹窗内部固定亮色（白底 + `slate-900` 文字，输入框带 `slate-200` 细边），**暗色主题下弹窗仍是白底**；上传弹窗含拖放区（`border-2 border-dashed border-slate-300`）与并行上传进度条（并行度 3；错误 `bg-red`、完成 `bg-[#1E8E3E]`、其余为墨黑进度）
- **底部悬浮胶囊 `FloatingPill`**：拖拽提示 / 移动错误 / 同步结果共用骨架，`fixed` 居中 + 全圆角 + Tailwind 默认 `shadow-md` + 12px 文字
- **使用须知 `NoticeModal`**：首次访问的条款弹窗，`localStorage` 记录同意状态（升级条款递增版本号即重新展示）；用磨砂遮罩，**没有关闭按钮**，不同意无法进入站点。卡片最大 520px、圆角 14px、`--surface` 底、走 §6 的 Modal 阴影栈；标题 18px / 600 / +0.01em，条目 12.5px（`--ink-2`，标题 600），列表底部 16px 渐隐；同意按钮是**全宽墨黑按钮**（圆角 12px、文字 `#fff`、14px / 600），不复用 `rb-btn-dark`
- **Toast**：顶部通知卡（`top: 50px`、宽 330px、圆角 8px、四种类型 error 红 / success 绿 / info 蓝 / warning 橙 + wave 装饰 + 圆形图标底 + 主标题 15px/700 + 副行 13px）；从上方滑入滑出；用于登录 / 注册结果、同步结果等
- **遮罩分两种**：磨砂 `.rb-frost-backdrop`（§2）用于 StaggeredMenu、使用须知、知识图谱全屏弹窗、设置弹窗；上传（`bg-black/60`）、重命名（`bg-black/35`）与文件预览（`bg-black/60`）用自己的纯黑半透明遮罩。打开任一弹层都锁 `body` 滚动
- **启动失败兜底（白屏）**：模块求值或首屏渲染抛错时 `#root` 会空着，`bootError.js` 直接接管并画一张卡（原生 DOM + 内联样式——此时的成因可能就是样式表没加载，不能依赖 Tailwind）：面向用户只有「页面出了点问题」+ 一句怎么办（含联系邮箱）+ 墨黑刷新按钮（14px 圆角、与站点 CTA 同款，但内联写死）；**原始错误与堆栈只在开发环境展开**（`import.meta.env.DEV`），生产环境仅 `console.error`，不把内部标识符摆到用户面前。只在 `#root` 无子元素时接管，运行期偶发错误不会清掉已经可用的界面

### 资料库之外的页面
- **统计面板 `/dashboard`**：独立页（`mx-auto w-full`），标题行 = 品牌 logo + 「统计面板」+ 右侧时间范围切换与刷新；主体是三段 12 栅格（8/4、7/5、6/6，`gap-3`）：下载热力图 + 类型分布、今日动态 + 下载量、近期上传 + 热门文件夹
- **关于我们 `/about`**：独立页，DM Sans 全页覆盖，**自成一套「直角 + 细边」语言**（标签与 CTA 都是 0 圆角 + `--line-strong` 细边，按钮不遵循 14px 圆角规范）；案例卡是 4:3 直角图块（黑底 + hover 像素溶解 + 白信息牌），页脚是文案 CTA + 活动名跑马灯（`border-t border-line` 分隔，`md` 以上去掉该线）
- **登录 / 注册 `/login`、`/register`**：外层是 `max-w-7xl`（1280px）的居中单列，卡片本身 `max-w-[1100px]`；左栏是 Silk WebGL 暗色品牌面板（40px 品牌主标题），右栏固定白底深字，输入框是 `#f5f5f5` 平底、`!rounded-[14px]`、无描边无聚焦效果；两路由共用同一个 `AuthPage` 实例（切换不重挂载）
- **文件预览**：office / 图片 / 文本等分支；`≤640px` 走移动端布局，头部有下载与关闭

### 下载热力图（统计面板首行左卡）
- GitHub 风格年度网格：**周一开头**的周列 × 7 行，顶部月份轴（1月 … 12月，`whitespace-nowrap` 单行，允许向右溢出），左侧星期标签每两行标一个
- 颜色 = 5 档蓝色 ramp：`var(--field)` → rgba(61,154,255,.35/.55/.78) → `var(--accent)`；档位 = `min(4, ceil(sqrt(当日下载数 / 峰值) × 4))`（开方，避免单日尖峰压平其余活跃日）
- 格子自适应 12–22px（取高度优先、宽度封顶），间隙 5px、内边距 `px-3 pb-3`；宽度不够时**从最左侧（最旧周）裁剪**而不是滚动，网格在剩余空间居中；面板 `rounded-control bg-surface`（10px 圆角、无边框无阴影、随行高撑满）
- 标题行 = 蓝色圆底徽章 + 白色下载箭头 + 卡片名 + 右侧「少 ▫▫▫▫▫ 多」图例（9px 方块）
- 悬浮 / 聚焦 tooltip：日期 + 当日下载数，优先显示在格子上方，顶部行翻转到下方，绝不遮挡被悬停格子；单元格本身 `tabIndex=0` + `aria-label` 播报
- 数据源 `GET /api/stats/heatmap`（近 365 天，独立于页面右上 7/30/90 切换）
- ⚠️ 已知偏差：星期标签取的是**周日开头**的字典数组按行号渲染（`日/二/四/六`），与周一开头的网格错开一天，见 `docs/ISSUES.md` BUG-93

## 5. 布局原则

### 栅格与容器
- **浏览路由**（`/`、`/folder/:id`，以及覆盖层的 `/settings`、`/settings/:section`——它背后照常渲染资料库）使用三栏 docs 布局：左栏 **250px**（`fixed`、通到视口左缘、`--app-sidebar` 底色、无分割线）+ 中列 `w-full min-w-0`（**自身不滚动**，滚动发生在文档层：`html` 有 `overflow-y: scroll` + `scrollbar-gutter: stable`）+ 右栏 **300px**（`fixed` 且内部滚动，知识图谱 + 智能对话，右侧留 8px、顶部 61.5px 与中列对齐）
- 左栏可收起（默认展开）：收起时中列 `padding-left` 归零、左上角浮出「展开侧边栏」按钮，收起态与展开态分别给中列与按钮做 320ms 过渡，缓动用项目级 `EASE_COLLAPSE`（`cubic-bezier(0.22, 1, 0.36, 1)`）。⚠️ 当前实现把时长 / 缓动写成模板插值类名（`lg:duration-[${SIDEBAR_MS}ms]`），Tailwind 扫不到、不会生成对应 CSS，**实际退化成默认 150ms**——见 `docs/ISSUES.md` BUG-94
- **独立页**：外层都是 `mx-auto w-full`。统计面板直接铺满可用宽度；关于我们在外层内部再用 `max-w-7xl` 居中文档流；登录 / 注册外层 `max-w-7xl`，卡片 `max-w-[1100px]`
- 中列工具栏右对齐并允许换行：排序分段（默认 / 名称 / 时间 / 大小，带滑动指示器，360ms）+ 刷新 / 返回上级图标按钮 + 管理员才有的「新建文件夹」「上传」；**工具栏自身没有底色**，白底的是它内部的按钮与分段外壳

### 间距
- 沿用 **Tailwind 默认 4px 步进**（未自定义 `spacing`）；实际高频值：4 / 6 / 8 / 10 / 12 / 14 / 15 / 16px
- 区块节奏：Dashboard 卡片间与区块间都是 12px；浏览页中列 `space-y-4`（16px）；右栏两张卡片 15px
- 留白：文档流页面（关于我们）到 40–64px（`pb-16`、头部 `lg:pt-[60px]`），96px 只出现在加载 / 空态占位；资料库与统计面板走 12–16px 的紧凑节奏

### 留白与分隔
- **优先留白与表面色深浅**：卡片之间靠间距，列表行靠 hover 底色块，栏之间靠底色差
- **细线只在功能必需处**：设置列表行 `border-bottom: 1px var(--line)`、关于页 `border-t border-line`（`md` 以上去掉）与 CTA 按钮的 `border-line-strong`、搜索下拉底部状态行的 `border-t border-slate-200`、文件预览头部 `border-b border-line`、重命名输入框的 `border-slate-200`、上传弹窗的虚线拖放区

### 圆角表
| 半径 | 用例 |
|------|------|
| 2px | 热力图格子与图例方块 |
| 4px | 行内 code、聊天族别小徽章 |
| 6px | ghost 按钮、表单控件**默认**半径、目录树行、`.records-tag`、图标按钮、图谱全屏关闭按钮（`rounded-md`） |
| 7px | 左栏开合按钮（`rounded-[7px]`） |
| 8px | 上传 / 重命名弹窗容器（`rounded-lg`）、浮层选项、Toast |
| 10px | `rounded-control`（内嵌面板）、设置浮层、图表提示、聊天输入槽、设置弹窗输入框与下拉触发器 |
| 12px | `rounded-card`（Dashboard 卡片）、搜索下拉、文件预览弹窗（`sm:rounded-xl`） |
| 14px | **按钮主导半径**（主 / 工具栏 / 搜索胶囊 / 排序指示器 / 登录页按钮与输入框）、浏览页三卡片、图谱全屏卡片、使用须知卡片 |
| 16px | 设置弹窗卡片 |
| 9999px | 胶囊按钮、建议 chip、徽章圆底、滚动条滑块 |
| 50% | 头像、品牌 logo 圆 |

## 6. 层级与投影

| 层级 | 处理 | 用途 |
|------|------|------|
| Flat（Level 0） | 无阴影 | 页面底色、文字块、**热力图面板**（刻意无边界） |
| Inset（Level 1） | `--inset` #f7f8f9 底（`bg-inset`），无阴影 | 图表绘图区、今日曲线区、目录树激活项、聊天引用胶囊底 |
| Card（Level 2） | `.rb-card` 四层栈（§2） | 上传 / 重命名弹窗；**Dashboard 与浏览页卡片是 `bg-surface` 无阴影**（无界） |
| Raised（Level 2b） | `shadow-btn` | 提拉胶囊、刷新按钮、聊天引用胶囊、活跃分段项 |
| Popover（Level 3） | 纯投影、**无任何描边 / 光晕**：rgba(0,0,0,.06) 0 4px 10px + rgba(0,0,0,.12) 0 12px 32px | 设置弹窗内的下拉浮层（`.settings-popover` / `.settings-popover-option`：语言菜单 `.settings-lang-menu`、协议下拉 `.settings-select-menu`） |
| Modal（Level 3） | 0 1px 2px rgba(0,0,0,.04) + 0 28px 64px -20px rgba(0,0,0,.28) | 设置弹窗卡片（16px 圆角）与「使用须知」卡片（520px / 14px 圆角）共用同一套浮起阴影 |
| Input hairline | `var(--line-strong)` 0 0 0 1px，**聚焦态同款**（不加蓝色光晕） | 表单控件（CSS 里内联，不是 token） |
| Focus（无障碍） | 2px solid hsla(212, 100%, 48%, 1) + 2px offset | 只给按钮 / 链接 / `[role=button]`；`input/textarea/select` 无聚焦效果（无界，见 §2 与 ISSUES.md IMPROVE-33） |

> 注：**有两处阴影不在本系统的 token 体系里**——`Toast` 的 rgba(149,157,165,.2) 0 8px 24px（沿用 uiverse 通知卡样式，主行 15px/700 也是三档字重之外的例外，见 §3）与 `FloatingPill` 的 Tailwind 默认 `shadow-md`。要用阴影请优先 `shadow-btn` / `.rb-card` / Level 3 那三套。
>
> 已从配置移除且零引用：`shadow-card`、`shadow-ring`、`shadow-ringlight`、`shadow-card-subtle`、`shadow-hairline`。

**阴影哲学**：多值阴影栈里每层各司其职——一层当「边」（0 偏移 1px 扩散）、一层做贴近的柔和（2px 模糊）、一层管远处海拔（8px 模糊 + 负扩散）、内环 #fafafa 让卡片「从里面透出光」。所以卡片看起来是「被造出来的」，不是「浮着的」。

## 7. 规范与禁忌

### 应当
- 颜色、圆角、阴影一律用 token / 类（`var(--*)`、`rounded-card`、`shadow-btn`、`.rb-card`），不在组件里写死十六进制。**现有写死的场景**（改动时别再扩散）：关于我们页（自成一套配色）、上传 / 重命名弹窗（固定亮色 `bg-white` / `slate-900`）、文件大小胶囊的 6 档色阶、StaggeredMenu 的自定义菜单配色、列表错误胶囊的 `#fef2f2` / `#fecaca`、设置里主题色板的 `#e6e6e6` / `#0f6cff`
- 优先用留白与表面色深浅做分隔；细线只留给设置行、关于页与搜索下拉这类功能必需处
- 三档字重：400 阅读 / 500 交互 / 600 标题；大字号用负字距（`h1/h2/h3` 已由 CSS 兜底）
- 数据色只按语义用：下载 `--accent`、上传 `--orange`、今日与错误 `--red`、存储 / 成功 `--green`
- 弹窗用 `.rb-card`，Dashboard 卡片保持无边界（无界）
- 正文用 `var(--ink)` / `var(--ink-2)`，不要用纯黑
- 文案走 i18n 字典（zh + en），品牌名逐字保留

### 禁止
- **不要在源码里硬编码中文文案**——`test/i18n.test.js` 会失败；新增文案必须同时补 `zh.js` 与 `en.js`
- 不要指望 `.app-theme` 里的 `bg-brand-*` 渲染成蓝色（已被全局改成 `var(--ink)`）；需要品牌蓝请用 `text-brand-*`
- 不要给表单控件加焦点描边 / 光晕（无界：聚焦态 = 常驻态；可访问性权衡见 ISSUES.md IMPROVE-33）
- 不要把表单控件的 hairline 写成 `rgba(0,0,0,.08)`——那是 ghost 按钮的值，表单控件用的是 `var(--line-strong)`（rgba(23,23,23,.14)）
- 不要给 Dashboard 卡片加阴影或描边（无界），也不要画全宽分割线
- 不要在 Dashboard 之外随手引入新的强调色；彩色只允许出现在语义位（错误、文件族别、大小胶囊、类型分布）
- 不要用原生 `<select>` 做设置项下拉（跟不上暗色主题与无界风格），用 `.settings-popover`
- 不要把主按钮做成 pill——胶囊只给徽章、建议 chip、分段控件与提拉按钮
- 不要随手加 >0.1 不透明度的重投影：系统的海拔语汇只有 §6 那几套。现有带大投影的都是浮层 / 弹窗类（设置弹窗与使用须知的 64px 那层、图谱全屏的 48px、浮层与图表提示的 32px / 24px，以及历史遗留的 Toast 与 `FloatingPill`，见 §6 注）
- 本项目没有营销截图区：关于页的案例图是唯一的图片场景（直角、无边框、无圆角），不要引入带边框 / 圆角的截图排版

## 8. 响应式行为

### 断点
使用 **Tailwind 默认断点**（`tailwind.config.js` 未覆写 `screens`）：`sm` 640px · `md` 768px · `lg` 1024px · `xl` 1280px · `2xl` 1536px（`xl`/`2xl` 目前未使用）。真正承担布局职责的是 **640 / 768 / 1024** 三个：

| 断点 | 变化 |
|------|------|
| `≤640px`（`max-width` 查询） | 设置弹窗改为整屏两级结构（`/settings` → `/settings/:section`）；文件预览改成整屏版式；菜单头条缩到 92% 宽、面板 `clamp(240px, 78vw, 340px)` |
| `768px`（`md`） | 关于我们页内容开始双列（`md:grid-cols-2`）；跑马灯那侧的顶部分隔线去掉（`md:border-t-0`） |
| `1024px`（`lg`） | 三栏 docs 布局生效（左栏 250px + 右栏 300px）、Dashboard 12 栅格开始分栏；反向就是「`lg` 以下」——左右栏整栏隐藏（不做内联回退），改用移动端细品牌行（`h-14`）+ 92% 宽的搜索行 + 菜单导航；`StaggeredMenu` 自己也有一层 `@media (max-width: 1024px)` 把面板收窄到 `clamp(280px, 48vw, 340px)` |

另一处窄屏特例：统计面板标题行**始终**可换行（`flex-wrap`），`max-[480px]` 只是把为右上角菜单按钮预留的 `pr-[110px]` 释放掉——**480 不是规范断点**，新代码不要复制。

### 塌陷策略
- 导航在所有尺寸都是 StaggeredMenu 汉堡面板（无 topbar），面板宽 `clamp(240px, 30vw, 340px)`，从右侧滑出；开关按钮固定在右上（深色实心、14px 圆角、14px / 600）
- 左栏（品牌 + 搜索 + 目录树）在 `lg` 以下消失，由移动端品牌行 + 搜索行 + 菜单接管；右栏（知识图谱 + 智能对话）同样只在 `lg` 以上出现
- Dashboard 卡片：12 栅格 → 单列堆叠；关于我们：双列 → 单列
- 横向溢出优先「裁剪 / 隐藏滚动条」而不是摆一条滚动条：排序分段用 `.sort-scroll` 隐去滚动条、热力图裁掉最旧的周、目录树滚动条只在滚动 / hover 时显形

### 触摸与可达性
- 按钮纵向内边距 8px（主 / 次按钮）、工具栏按钮 34px、图标按钮 24px（`size-6`）、左栏开合 28px、设置关闭 32px、图谱全屏关闭 36px；行高 32px（目录树）以上
- 列表行按下缩放 `active:scale-[0.98]` 提供触感反馈
- 键盘：按钮 / 链接 2px Focus Blue 环（例外见 §1）；列表行 `ring-inset`；热力图单元格可 Tab 且有 `aria-label`
- 尊重系统偏好：主题「跟随系统」读 `prefers-color-scheme: dark`

## 9. Agent 提示词与自检清单

### 快速参考
- 页面底 `var(--page)` #f8f8f8 · 卡片 `var(--surface)` #ffffff · 主文字 `var(--ink)` #171717 · 次级 `var(--ink-2)` · 三级 / 占位 `var(--ink-3)`
- 按钮圆角 **14px**（主 / 工具栏）、ghost 与表单控件默认 6px（登录页输入框 14px、设置弹窗输入框 10px）、卡片 `rounded-card` 12px、浏览页卡片 `rounded-[14px]`、内嵌面板 `rounded-control` 10px
- 阴影：弹窗 `.rb-card` · 提拉胶囊 `shadow-btn` · 浮层 Level 3（§6）· Dashboard 卡片**无阴影**
- 数据色：下载 `--accent` #3d9aff · 上传 `--orange` #f68f3c · 今日 / 错误 `--red` #ee5c61 · 存储 `--green` #3fae6b
- 焦点环 hsla(212,100%,48%,1)，只给按钮 / 链接；表单控件聚焦无视觉

### 示例提示词（按本项目写）
- 「做一个统计卡片：`rounded-card bg-surface p-3`，标题行 = 14px 彩色圆底徽章（`IconBadge`，内含 `size-2` 的 lucide 图标、`strokeWidth={3}`）+ 13px/600 标题（下载热力图那种紧凑标题行才用 12px/500），主数值 17px/600 + `tabular-nums`，绘图区 `rounded-control bg-inset`。」
- 「做一个工具栏按钮：`rb-toolbar-btn`（34px 高、白底、`--ink-2` 文字、14px 圆角、13px/500），hover 叠 1px 环 + 2px 极浅投影。」
- 「做一个设置项下拉：触发按钮 + `.settings-popover` 浮层（Level 3 双层投影、无描边），不用原生 `<select>`；选项 13px/500、圆角 8px、hover `bg-hover`。」
- 「做一个拖拽移动失败时浮现的错误胶囊（`FloatingPill`）：中性版是 `bg-black/5` + `black/10` 细边 + 全圆角；错误版换成语义红（`text-red` + #fef2f2 底 + #fecaca 边），约 4 秒后自动消失。」
- 「做一个下载热力图卡片：GitHub 式周列 × 7 行、5 档蓝色 ramp（`var(--field)` → `var(--accent)`）、格子 12–22px / 间隙 5px、无边框白面板、标题行带蓝色徽章与「少 ▫▫▫▫▫ 多」图例、tooltip 在格子上方（顶部行翻到下方）。」

### 改动自检清单
1. 用 token 还是写死了颜色 / 圆角 / 阴影？写死要有理由（自绘视觉才允许）。
2. 新增文案是否同时补了 `zh.js` 与 `en.js`，源码里没有硬编码中文？
3. 暗色主题下是否仍然成立（是否只消费了 token，没写死 `#fff` / `#f5f5f5`）？
4. 是否遵守无界：卡片没有描边 / 阴影，分隔靠留白与表面色，细线只用在该用的地方？
5. 表单控件是否避免了聚焦描边 / 光晕？按钮 / 链接是否保留了 Focus Blue 焦点环？
6. 断点是否只用 640 / 768 / 1024（加必要的 `max-[480px]` 特例）？`lg` 以下是否有合理回退？
7. 键盘与读屏：新交互元素是否可 Tab、有 `aria-label` / `aria-pressed`？
8. 用 Tailwind 的任意值类名时，**不要用模板字符串插值拼类名**（Tailwind 静态扫描扫不到，样式会静默失效——现有 BUG-94 就是这么来的）。

---

> 维护约定：本规范与代码必须保持一致（见 `AGENTS.md` §1）。改动影响颜色 / 字距 / 圆角 / 断点 / 组件外观时，请同步更新本文档；发现代码偏离规范或规范漏记的偏差，按 `docs/ISSUES.md` 建档而不在本文档里留吐槽。
