# Design System Inspired by Vercel

> **Brand Adaptation (仲英学辅)**
> This system is Vercel-inspired for the 仲英书院学业辅导中心 (Zhongying College Academic Counseling Center) material library website. Brand-owned assets are kept as-is and override the generic system:
>
> - **Brand font:** OPPO Sans 4.0 replaces Geist as the primary font (brand-owned, `frontend/public/fonts/OPPO Sans 4.0.ttf`). The *principles* of Geist typography (compression, three-weight hierarchy, tight tracking) still apply, but letter-spacing is adapted for CJK legibility — see §3.
> - **Brand identity:** The brand logo (`favicon.png` / `brand-logo.png`) and brand names (仲英学辅资料库, 仲英书院学业辅导中心, 仲英学辅) are always preserved verbatim.
> - **Language:** All user-facing copy is Chinese (zh-CN); uppercase mono technical labels (TODAY, DOWNLOADS…) remain in English as decorative metadata, per the Geist Mono tradition.
> - **Accent colors:** The old brand blue (#276DAB) is replaced by the Vercel interaction palette (§2) — Link Blue #0072f5, Develop Blue #0a72ef, Focus Blue hsla(212, 100%, 48%, 1). Primary CTAs are Vercel Black (#171717).
> - **Workflow pipeline colors** (Ship Red / Preview Pink / Develop Blue) are used as functional data-viz accents. The stats dashboard defines its own data-viz tokens — 下载 = 蓝 `--accent` (#3d9aff), 上传 = 橙 `--orange` (#f68f3c) — the only permitted decorative-ish use (see the heatmap spec in §4).
> - **无界 (Borderless) philosophy:** This site deliberately moves *away* from Vercel's line-dominated separation (shadow-as-border everywhere). Separation comes from whitespace and soft surface tints (#FAFAFA) first; lines/borders are used only where function requires them (e.g., table rows, dashed dropzone). There is **no topbar** — navigation is a StaggeredMenu hamburger on every layout; the brand, search and folder tree live in the left rail (see §4).

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
- Workflow-specific accent colors: Ship Red (#ff5b4f), Preview Pink (#de1d8d), Develop Blue (#0a72ef)
- Focus ring system using hsla(212, 100%, 48%, 1) — a saturated blue for accessibility
- Pill badges (9999px) with tinted backgrounds for status indicators

## 2. Color Palette & Roles

### Primary
- Vercel Black (#171717): Primary text, headings, dark surface backgrounds. Not pure black — the slight warmth prevents harshness.
- Pure White (#ffffff): Page background, card surfaces, button text on dark.
- True Black (#000000): Secondary use, --geist-console-text-color-default, used in specific console/code contexts.

### Workflow Accent Colors
- Ship Red (#ff5b4f): --ship-text, the "ship to production" workflow step — warm, urgent coral-red.
- Preview Pink (#de1d8d): --preview-text, the preview deployment workflow — vivid magenta-pink.
- Develop Blue (#0a72ef): --develop-text, the development workflow — bright, focused blue.

### Console / Code Colors
- Console Blue (#0070f3): --geist-console-text-color-blue, syntax highlighting blue.
- Console Purple (#7928ca): --geist-console-text-color-purple, syntax highlighting purple.
- Console Pink (#eb367f): --geist-console-text-color-pink, syntax highlighting pink.

### Interactive
- Link Blue (#0072f5): Primary link color with underline decoration.
- Focus Blue (hsla(212, 100%, 48%, 1)): --ds-focus-color, focus ring on interactive elements.
- Ring Blue (rgba(147, 197, 253, 0.5)): --tw-ring-color, Tailwind ring utility.
- **Icons are pure black (#000000) on light surfaces** — all icons render via `currentColor`, and a global rule forces `#000` on white. Dark surfaces (dark CTA buttons, the login hero panel `.rb-dark`, any `text-white` context) keep the inherited light icon color.

### Neutral Scale
- Gray 900 (#171717): Primary text, headings, nav text.
- Gray 600 (#4d4d4d): Secondary text, description copy.
- Gray 500 (#666666): Tertiary text, muted links.
- Gray 400 (#808080): Placeholder text, disabled states.
- Gray 100 (#ebebeb): Borders, card outlines, dividers.
- Gray 50 (#fafafa): Subtle surface tint, inner shadow highlight.

### Surface & Overlay
- Overlay Backdrop (hsla(0, 0%, 98%, 1)): --ds-overlay-backdrop-color, modal/dialog backdrop.
- Selection Text (hsla(0, 0%, 95%, 1)): --geist-selection-text-color, text selection highlight.
- Badge Blue Bg (#ebf5ff): Pill badge background, tinted blue surface.
- Badge Blue Text (#0068d6): Pill badge text, darker blue for readability.

### Shadows & Depth
- Border Shadow (rgba(0, 0, 0, 0.08) 0px 0px 0px 1px): The signature — replaces traditional borders.
- Subtle Elevation (rgba(0, 0, 0, 0.04) 0px 2px 2px): Minimal lift for cards.
- Card Stack (rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 2px, rgba(0,0,0,0.04) 0px 8px 8px -8px, #fafafa 0px 0px 0px 1px): Full multi-layer card shadow.
- Ring Border (rgb(235, 235, 235) 0px 0px 0px 1px): Light gray ring-border for tabs and images.

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

Primary White (Shadow-bordered)
- Background: #ffffff
- Text: #171717
- Padding: 0px 6px (minimal — content-driven width)
- Radius: 6px (subtly rounded)
- Shadow: rgb(235, 235, 235) 0px 0px 0px 1px (ring-border)
- Hover: background shifts to var(--ds-gray-1000) (dark)
- Focus: 2px solid var(--ds-focus-color) outline + var(--ds-focus-ring) shadow
- Use: Standard secondary button

Primary Dark (Inferred from Geist system)
- Background: #171717
- Text: #ffffff
- Padding: 8px 16px
- Radius: 6px
- Use: Primary CTA ("Start Deploying", "Get Started")

Pill Button / Badge
- Background: #ebf5ff (tinted blue)
- Text: #0068d6
- Padding: 0px 10px
- Radius: 9999px (full pill)
- Font: 12px weight 500
- Use: Status badges, tags, feature labels

Large Pill (Navigation)
- Background: transparent or #171717
- Radius: 64px–100px
- Use: Tab navigation, section selectors

### Cards & Containers
- Background: #ffffff
- Border: via shadow — rgba(0, 0, 0, 0.08) 0px 0px 0px 1px
- Radius: 8px (standard), 12px (featured/image cards)
- Shadow stack: rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 2px, #fafafa 0px 0px 0px 1px
- Image cards: 1px solid #ebebeb with 12px top radius
- Hover: subtle shadow intensification

### Knowledge Graph (知识库卡片)
- forestry.md "Connected Pages" style, sits to the **right of the file list** (360px card, `xl:` two columns, stacks below on smaller screens)
- Force-directed layout (d3-force): circular nodes, **radius scaled by degree** (`2 + sqrt(degree)`), monochrome — folders solid `#171717`, files white with `rgba(23,23,23,0.45)` ring; current folder gets an outer ring
- **Local view**: current folder + direct neighbors; globe button opens a full-library modal
- Hover highlights the node + its neighbors (others dim to 0.12, links 0.7/0.05); labels appear on hover or when zoomed past 1.2×
- Pan by dragging background, wheel zoom (0.25–2.5), drag nodes, click (no drag) navigates — folder enters, file previews; auto-fits the graph after settling
- Refetches on the `folders-changed` event

### File List (资料库右侧)
- Monochrome throughout (no accent colors): rows on white, dividers rgba(23,23,23,0.08)
- Row hover: `#FAFAFA` surface tint only — no ring/outline (无界)
- Header row: 12px #666 on #FAFAFA
- Metadata (size/date): 12px #808080
- Row action buttons (download/rename/delete): black icons, hover `rgba(0,0,0,0.05)` — no red/blue tints
- Drag/drop indicators: neutral — drop-into `rgba(0,0,0,0.05)` + 1px `rgba(0,0,0,0.1)` inset ring, insert lines `inset 0 2px 0 rgba(0,0,0,0.6)`
- Floating hint pills: neutral (`rgba(0,0,0,0.05)` bg, `rgba(0,0,0,0.1)` border); error states stay red (semantic)

### Inputs & Forms
- Radio: standard styling with focus var(--ds-gray-200) background
- Focus shadow: 1px 0 0 0 var(--ds-gray-alpha-600)
- Focus outline: 2px solid var(--ds-focus-color) — consistent blue focus ring
- Border: via shadow technique, not traditional border

### Navigation
- **No topbar on any layout** — the page is two columns (left rail + content)
- Navigation lives in the **StaggeredMenu** (hamburger) on **all** screen sizes: right-side slide-out panel with the main items (资料库 / 统计 / 关于我们 / 管理员登录或退出登录) + social channels
- Brand logo + brand name (仲英学辅资料库) sit at the top of the **left rail** (desktop) / a slim mobile-only top row
- Menu toggle: white shadow-border button, 6px radius, 14px weight 500, fixed at top-right
- Active: weight 600 or underline
- CTA: dark pill buttons ("Start Deploying", "Contact Sales")

### Docs Layout & Sidebar (Folder Tree)
- Vercel-docs-style **three-column layout** on **browse routes only** (`/` and `/folder/:id`); every other page (统计 / 关于我们 / 登录) is **standalone** — a single centered `max-w-6xl` column with no rail
- Browse routes (desktop ≥1280px):
  - **Left rail** — **full-bleed to the viewport's left edge** (no white gap), **250px**, full viewport height `#FAFAFA` tint (no border line, 无界), `sticky top-0`; contains, top to bottom:
    1. **Brand logo + brand name** (brand identity, verbatim)
    2. **Search field** (Vercel-docs pattern)
    3. **Folder tree** (fills the remaining rail height, scrolls internally) — folders **and files**: file leaves show the file-type icon, indented under their folder; clicking a file jumps to its folder and opens the preview. Root-level files sit under the 首页 node, which is **expanded by default**. Chevron toggles any folder that contains folders or files.
  - **Middle column** (`flex-1`, scrolls internally): sticky breadcrumb/toolbar row (white background) — sort segments (默认 / 名称 / 时间 / 大小), refresh, 新建文件夹, 上传 — above the file list
  - **Right rail** (fixed full-height): **打开菜单栏 button** on top (opens StaggeredMenu; replaces its floating toggle at ≥1280px), **knowledge-graph card** below — the graph's local view is `sticky` to the rail; the full-library modal is unaffected
  - Below 1280px the knowledge graph falls back to an inline card under the file list; the left rail hides below `lg` (1024px) — browse pages get a slim mobile brand row + search below it, navigation via StaggeredMenu
- Content column: centered, max `1200px` (browse) / `1280px` (standalone `max-w-7xl`)
- Standalone pages (统计 / 关于我们): single centered `max-w-7xl` column
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
- Responsive: right rail hidden below `xl` (1280px), left sidebar hidden below `lg` (1024px); navigation falls back to breadcrumb + search

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
- Standalone pages: single centered 1280px (`max-w-7xl`) column
- Browse routes: three-column docs layout — 250px folder-tree sidebar + `flex-1` content + 360px right rail (menu button + knowledge graph)
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
| Flat (Level 0) | No shadow | Page background, text blocks |
| Ring (Level 1) | rgba(0,0,0,0.08) 0px 0px 0px 1px | Shadow-as-border for most elements |
| Light Ring (Level 1b) | rgb(235,235,235) 0px 0px 0px 1px | Lighter ring for tabs, images |
| Subtle Card (Level 2) | Ring + rgba(0,0,0,0.04) 0px 2px 2px | Standard cards with minimal lift |
| Full Card (Level 3) | Ring + Subtle + rgba(0,0,0,0.04) 0px 8px 8px -8px + inner #fafafa ring | Featured cards, highlighted panels |
| Focus (Accessibility) | 2px solid hsla(212, 100%, 48%, 1) outline | Keyboard focus on all interactive elements |

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
- Apply workflow accent colors (Red/Pink/Blue) only in their workflow context (dashboard data-viz)
- Use multi-layer shadow stacks for cards (border + elevation + ambient + inner highlight)
- Keep the color palette achromatic — grays from #171717 to #ffffff are the system
- Use #171717 instead of #000000 for primary text — the micro-warmth matters

### Don't
- Don't use positive letter-spacing on OPPO Sans — it's always negative or zero
- Don't use weight 700 (bold) on body text — 600 is the maximum, used only for headings
- Don't rely on lines/borders as the primary separation mechanism — that is the 只用线 (line-only) style, avoided by design (无界)
- Don't add divider lines under the topbar or between sections — surfaces and spacing divide the page
- Don't introduce warm colors (oranges, yellows, greens) into the UI chrome
- Don't apply the workflow accent colors (Ship Red, Preview Pink, Develop Blue) decoratively
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
- Left rail (brand + search + folder tree): hidden below `lg` (1024px) — mobile gets a slim brand row, search below it, breadcrumb + search for folder navigation
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
- Border (shadow): rgba(0, 0, 0, 0.08) 0px 0px 0px 1px
- Link: Link Blue (#0072f5)
- Focus ring: Focus Blue (hsla(212, 100%, 48%, 1))

### Example Component Prompts
- "Create a hero section on white background. Headline at 48px OPPO Sans weight 600, line-height 1.00, letter-spacing -0.03em, color 
#171717. Subtitle at 20px OPPO Sans weight 400, line-height 1.80, color 
#4d4d4d. Dark CTA button (
#171717, 6px radius, 8px 16px padding) and ghost button (white, shadow-border rgba(0,0,0,0.08) 0px 0px 0px 1px, 6px radius)."
- "Design a card: white background, no CSS border. Use shadow stack: rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 2px, 
#fafafa 0px 0px 0px 1px. Radius 8px. Title at 24px OPPO Sans weight 600, letter-spacing -0.02em. Body at 16px weight 400, 
#4d4d4d."
- "Build a pill badge: 
#ebf5ff background, 
#0068d6 text, 9999px radius, 0px 10px padding, 12px OPPO Sans weight 500."
- "Create navigation: #FAFAFA sticky header with no divider line (无界). OPPO Sans 14px weight 500 for links, 
#171717 text. Dark pill CTA 'Start Deploying' right-aligned."
- "Design a workflow section showing three steps: Develop (text color 
#0a72ef), Preview (
#de1d8d), Ship (
#ff5b4f). Each step: 14px mono uppercase label + 24px OPPO Sans weight 600 title + 16px weight 400 description in 
#4d4d4d."

### Iteration Guide
1. Separate with whitespace and surface tints first; use shadow-as-border (0px 0px 0px 1px rgba(0,0,0,0.08)) only where a line is functionally required — never outline everything (无界)
2. Letter-spacing scales with font size: -0.03em at 48px, -0.02em at 32px, -0.02em at 24px, normal at 14px (CJK-adjusted)
3. Three weights only: 400 (read), 500 (interact), 600 (announce)
4. Color is functional, never decorative — workflow colors (Red/Pink/Blue) mark pipeline stages / data series only
5. The inner #fafafa ring in card shadows is what gives cards their subtle inner glow
6. Uppercase mono labels for technical metadata, OPPO Sans for everything else
7. Keep brand assets verbatim: 仲英学辅资料库 brand name, logo, OPPO Sans typeface