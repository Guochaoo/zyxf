# AGENTS.md — Agent 协作规范

> 本文件是 agent（与开发者）在本仓库协作时必须遵守的硬性约定。
> 每次开工前先读本文件；改动涉及文档/行为时，必须遵守下文相应条款。

## 0. 项目仓库布局与启动方式

### 0.1 仓库布局

```
zyxf/
├── backend/               # Express 后端（资源库 API、智能搜索、AI 助手服务）
│   ├── src/
│   │   ├── index.js       # 入口：helmet / 限流 / 生产安全校验
│   │   ├── db.js          # SQLite 初始化
│   │   ├── auth.js        # JWT 签发与鉴权
│   │   ├── oss.js         # OSS 直传 / 下载签名
│   │   ├── imm.js         # IMM WebOffice 预览令牌
│   │   ├── searchService.js / searchMatch.js   # 智能搜索（路由与 AI 工具共用）
│   │   ├── llm.js         # OpenAI 兼容流式客户端（可选启用）
│   │   └── routes/        # auth / folders / files / search / chat / stats / sync
│   └── test/
├── frontend/              # React 前端（Vite + TailwindCSS）
│   ├── src/
│   │   ├── pages/         # BrowsePage / DashboardPage / AuthPage（登录+注册） / AboutPage
│   │   │                  #   页面级子模块：pages/Browse/、pages/Dashboard/（容器 + 数据 hook + 纯展示件）
│   │   ├── components/    # 文件列表 / 预览 / 知识图谱 / 智能对话 / 菜单等
│   │   └── test/          # vitest 测试
├── docs/
│   ├── DEPLOY.md          # 部署指南（systemd + nginx + HTTPS）
│   ├── DESIGN.md          # 设计系统规范
│   └── ISSUES.md           # 缺陷 + 改进建议追踪清单
├── start.sh               # 本地一键启动
├── .env                   # 唯一配置文件（已被 .gitignore 忽略，绝不提交）
└── .env.example           # 环境变量模板
```

### 0.2 启动方式

- **一键启动**：执行仓库根目录的 **`./start.sh`**（Git Bash / Bash 环境）。
  - 该脚本后台启动后端 `:4000` + 前端 `:5173`，日志写入 `backend/run.log`、`backend/run.err.log`、`frontend/vite-dev.log`、`frontend/vite-dev.err.log`。
  - 脚本内含 sleep + 健康检查：先 curl 后端 `/api/health`，再检查前端 `http://localhost:5173/` 的 HTTP 状态码。
  - 停止：`kill` 对应的 node 进程。
- **手动启动**（PowerShell / 需要单独控制时）：
  - 后端：`cd backend && npm install && npm run dev`
  - 前端：`cd frontend && npm install && npm run dev`
- 首次启动自动创建 SQLite 数据库 `backend/data.db` 并按 `.env` 的 `ADMIN_USER`/`ADMIN_PASSWORD` 写入管理员账号；`.env` 至少需填写 `OSS_*` 凭证（见 README）。用户注册（邮箱验证码）需额外填写 `DM_*` 三项，未配置时仅注册功能返回 503。

## 1. 文档维护（docs/ + README）

仓库内的文档（`README.md`、`docs/DEPLOY.md`、`docs/DESIGN.md`、`docs/ISSUES.md`）必须与代码保持一致。

- **触发时机**：每次代码改动若影响文档描述的行为、路径、端口、断点、环境变量、token、目录或组件，就必须同步更新对应文档。
  - 高频影响点：`frontend/src/test` 路径、`docs/ISSUES.md` 存在性、tailwind token（如 `shadow-card` 是否仍存在）、右栏 `300px`/`lg` 断点、登录入口位置、`rb-btn-dark` 圆角等。
- **同步节奏**：可以每条消息后立即更新，也可以按内容分批（隔几条消息）更新一次；但**本轮会话结束前**必须确保文档与本轮所有改动一致。
- **完成时说明**：若本次改动未影响文档，明确说「无文档需更新」；若影响了，列出更新了哪些文档及对应改动。
- **追加要求**：当人类对 AGENTS.md 提出新的工程化要求时，按实际工程化结构更新本文件；保持简洁、不冗余。

## 2. Git 流程

> 本项目为个人维护的小项目，直接在 `dev` 上开发，不创建临时分支。

### 2.0 提交署名（必须先确认）

本仓库的提交必须署名到 GitHub 账号 **`Guochaoo`**，其对应邮箱为 **`2066803627@qq.com`**。

- **易错点**：本机全局 `.gitconfig` 里的 `user.email` 是 `guochao@users.noreply.github.com`，该地址在 GitHub 上归属**另一个账号** `guochao`（非 `Guochaoo`），用它提交会导致署名、头像、贡献图全部记错人。
- 由于 `.git/config` 是本地文件、不随仓库分发，**换机器或重新 clone 后要重新设置**：

  ```bash
  git config user.name "Xu Guochao"
  git config user.email "2066803627@qq.com"
  ```

- 提交前可用 `git config user.email` 复核；发现署名错误时，先纠正配置，再决定是否重写历史（改写已推送/已合并的历史需人类明确同意）。

### 2.1 开发前
- 新会话要开始改动时，**先** `git checkout dev && git pull origin dev`，确保基于最新远程 `dev`，然后直接在本地 `dev` 上改动。

### 2.2 开发中
- **提交频率由 agent 自行判断**：既不要在很长一段时间不 commit（避免改动大量积压、难以 review），也不要每个小改动都 commit（避免碎片化）。以「一个逻辑完整、可独立 review 的增量」为粒度做一次 commit。

### 2.3 提交与合并
- 完成改动后：提交到本地 `dev` → **push 到远程 `dev`**。
- 仅当人类明确要求时，才从 `dev` 提交 PR 到 **`main`**，审核后合并进生产分支。

### 2.4 外网访问与代理
- 访问 GitHub（push / pull）、npm registry、外网 API 等出现**连接超时 / 连接被重置**时，先判断是否为网络可达性问题（如 `curl -sI https://github.com` 超时），再尝试走本地代理，而不是反复重试或直接判定失败。
- 本机代理默认端口 **`7897`**（Clash 等）。PowerShell：

  ```powershell
  $env:HTTP_PROXY="http://127.0.0.1:7897"; $env:HTTPS_PROXY="http://127.0.0.1:7897"
  ```

  Git Bash / Bash（或仅给单条命令加前缀）：

  ```bash
  export HTTP_PROXY=http://127.0.0.1:7897 HTTPS_PROXY=http://127.0.0.1:7897
  git push origin dev
  ```

- 注意：环境变量只对**当前 shell 会话**生效，新会话需重新设置；`git config` 里的 `http.proxy` 属持久配置，不要为临时故障写入。

## 3. 变更记录原则
- 行为无关的改动（纯文档/注释/格式化）与行为改动分开表述，便于 review。
- 只跑必要验证；文档改动不影响测试的，说明即可。

## 4. 安全扫描记录
- 发现的**缺陷**、**待改进点**、以及**已修复的问题**，都必须记录到 `docs/ISSUES.md`：
  - 真实缺陷 → 按 `BUG-<n>` 建档，修好后归档到「2.1 已修复缺陷」表（注明修复位置与关闭日期）。
  - 需改进项 / 评估为误报或协议性约束的扫描标记 → 按 `IMPROVE-<n>` 建档：待处理的放「1.2 改进建议」，已处置的放「2.2 已关闭改进项」，写明判定依据与建议（如客户端豁免、换环境变量显式声明等）。
  - **归档表只作索引**（编号 / 严重度 / 类别 / 标题 / 位置 / 日期），一行一条，**不写长说明**。
  - **注释只留在「不看就容易改错」的地方**：仅当这条修复的原因/约束从代码本身看不出来时，才在修复处留**一行**注释，形如 `// BUG-54：校验必须和 UPDATE 同事务，否则并发能写出环`；一行说不完就不写（背景属于 commit message，不属于代码）。不为历史条目批量回填编号注释，不复述代码在做什么，不写多段式「现状/影响/修法」。
  - **待处理条目**保持简短：影响 / 改法 / 验收 各一行，说清「能不能复现、改哪里、怎么算修好」即可。
  - 同时在 ISSUES.md 头部「当前进度」更新 `updated`、`entries`、`pending`、`fixed` 计数（`entries` = 缺陷 + 改进总数；`fixed` = 已归档数）。
- 安全扫描记录与代码改动一样，随版本提交到 `dev`，保持文档与代码一致。
