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

### 2.1 开发前
- 新会话要开始改动时，**先** `git checkout dev && git pull origin dev`，确保基于最新远程 `dev`，然后直接在本地 `dev` 上改动。

### 2.2 开发中
- **提交频率由 agent 自行判断**：既不要在很长一段时间不 commit（避免改动大量积压、难以 review），也不要每个小改动都 commit（避免碎片化）。以「一个逻辑完整、可独立 review 的增量」为粒度做一次 commit。

### 2.3 提交与合并
- 完成改动后：提交到本地 `dev` → **push 到远程 `dev`**。
- 仅当人类明确要求时，才从 `dev` 提交 PR 到 **`main`**，审核后合并进生产分支。

## 3. 变更记录原则
- 行为无关的改动（纯文档/注释/格式化）与行为改动分开表述，便于 review。
- 只跑必要验证；文档改动不影响测试的，说明即可。
