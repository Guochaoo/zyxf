# 仲英学辅 · 资料库（zyxf）

> 西安交通大学仲英书院学业辅导中心的全栈在线资料库：按文件夹层级组织 PPT / Word / PDF / 图片等学习资料，提供智能搜索、AI 资料助手、在线预览、知识图谱与下载统计。文件直存阿里云 OSS，不占应用服务器带宽。

线上地址：<https://zyxf.top>

## 功能特性

- **资料管理**：文件夹任意嵌套；按名称、大小、时间排序，升降序可切换；拖拽 / 点击上传（前端直传 OSS）；后端提供面包屑数据（前端当前未在 UI 展示）
- **智能搜索**：名称子串、汉字缩写（搜「高数」命中「高等数学」）、拼音全拼与首字母（`gaoshu` / `gdsx`）、所在文件夹路径命中；名称命中排在路径命中之前，结果标注所属文件夹
- **AI 资料助手**（可选）：右栏流式对话，LLM 按需调用智能检索并推荐文件；回答中【文件N】引用渲染为可点击卡片（跳转 / 预览）；兼容任意 OpenAI 接口，支持浏览器端配置或服务器端 env 配置；游客限流、管理员豁免
- **在线预览**：PDF / PPT / Word / Excel / TXT 走阿里云 IMM WebOffice；zip / rar 等归档仅提供下载
- **知识图谱**：按目录连接关系的力导向图，点击节点跳转或预览，支持全库视图与当前文件夹邻域放大
- **统计面板**（`/dashboard`）：近一年 GitHub 式下载热力图、文件类型分布、下载 / 占用排行、今日上传下载动态
- **权限模型**：管理员可新建文件夹、上传、删除、改名、移动、排序；游客与登录用户只读，但均可点「刷新」触发 OSS→本地库同步（按身份分层限流：游客 2 次/分钟 < 登录用户 5 次/分钟 < 管理员豁免）

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 · Vite 5 · TailwindCSS 3 · React Router 7 · d3-force · lucide-react |
| 后端 | Node.js · Express 4 · node:sqlite（SQLite）· JWT · express-rate-limit |
| 存储 / 预览 | 阿里云 OSS（前端直传，后端仅签名）· 阿里云 IMM WebOffice |
| AI（可选） | 任意 OpenAI 兼容 `/chat/completions` 接口（SSE 流式 + 工具调用） |

## 快速开始

### 前置条件

- Node.js ≥ 24（`node:sqlite` 内置模块与测试用的 module-mocks 均要求；CI/部署统一 24）
- 一个阿里云 OSS Bucket（[CORS 规则](docs/DEPLOY.md)需允许你的来源域名，Methods 含 `GET, POST, PUT, HEAD`）

### 方式一：一键启动（Git Bash）

```bash
cp .env.example .env   # 编辑 .env，至少填写 OSS_* 凭证
./start.sh             # 后台启动前后端并做健康检查
```

### 方式二：手动启动

```bash
# 后端（http://localhost:4000）
cd backend && npm install && npm run dev

# 前端（http://localhost:5173，/api 已代理到 4000）
cd frontend && npm install && npm run dev
```

首次启动自动创建 SQLite 数据库 `backend/data.db` 并按 `.env` 写入管理员账号（后续启动会持续同步 `ADMIN_PASSWORD`/角色，改密后重启即生效）。开发模式下 `JWT_SECRET` / `ADMIN_PASSWORD` 不做强度校验；生产环境必须达到 [部署文档](docs/DEPLOY.md) 的安全要求。

## 环境变量

仓库根目录的 `.env` 是唯一配置文件，本地开发与生产部署共用（已被 gitignore）。

| 变量 | 必填 | 说明 |
|---|---|---|
| `OSS_REGION` / `OSS_BUCKET` / `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | ✅ | 阿里云 OSS 凭证（专用 RAM 用户 + 单 bucket 最小权限，见[部署文档 §2.2](docs/DEPLOY.md)） |
| `JWT_SECRET` | 生产必填 | ≥ 32 位随机串，生产环境强度不达标拒绝启动 |
| `JWT_EXPIRES_IN` |  | JWT 有效期（默认 `7d`） |
| `ADMIN_USER` / `ADMIN_PASSWORD` | 生产必填 | 管理员账号的唯一权威来源：每次启动同步密码/角色，改密后重启即生效；密码 ≥ 12 位 |
| `PORT` |  | 后端端口（默认 4000） |
| `CORS_ORIGIN` |  | 跨域来源；同源反代部署可留空 |
| `OSS_KEY_PREFIX` / `OSS_ENDPOINT` |  | 上传根前缀 / 自定义直传 endpoint |
| `IMM_PROJECT` |  | IMM 项目名（默认 `zyxf`），与 OSS Bucket 绑定的 IMM 项目名不同才需设置 |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` |  | 三者齐备才启用 AI 对话，留空则该接口返回 503 |
| `DM_ACCESS_KEY_ID` / `DM_ACCESS_KEY_SECRET` / `DM_ACCOUNT_NAME` |  | 三者齐备才启用用户注册（阿里云邮件推送 DirectMail 发送邮箱验证码），留空则注册发码接口返回 503 |
| `DM_FROM_ALIAS` |  | 发件人显示名（默认「仲英学辅」） |

## 项目结构

```
zyxf/
├── backend/               # Express 后端
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
├── frontend/              # React 前端
│   ├── src/
│   │   ├── pages/         # BrowsePage / DashboardPage / AuthPage（登录+注册） / AboutPage
│   │   │                  #   页面级子模块：pages/Browse/、pages/Dashboard/（容器 + 数据 hook + 纯展示件）
│   │   ├── components/    # 文件列表 / 预览 / 知识图谱 / 智能对话 / 菜单等
│   │   └── test/          # vitest 测试
├── docs/
│   ├── DEPLOY.md          # 部署指南（systemd + nginx + HTTPS）
│   ├── DESIGN.md          # 设计系统规范
│   └── ISSUES.md          # 缺陷 + 改进建议追踪清单
└── start.sh               # 本地一键启动
```

## 测试与持续集成

```bash
cd backend  && npm test    # node:test（API / 搜索 / 聊天路由）
cd frontend && npm test    # vitest + Testing Library
```

推送到 `dev`、或 Pull Request 到 `main` 时，GitHub Actions 自动跑前后端测试（另含依赖漏洞门禁 `npm audit` 与前端构建产物校验）；合并到 `main` 触发 SSH 部署到生产服务器，若部署后健康检查失败会自动回滚到部署前的修订。

## 部署

生产部署（阿里云 ECS + **systemd 托管后端 + nginx 托管前端 + Let's Encrypt 配 HTTPS**）见 **[docs/DEPLOY.md](docs/DEPLOY.md)**，含安全组、OSS 跨域、IMM 绑定与常见故障排查。

## 设计规范

UI 遵循 Vercel 风格的设计系统（色彩、字体、组件、布局、阴影层级），详见 **[docs/DESIGN.md](docs/DESIGN.md)**。

## 关于

仲英书院学业辅导中心 · 学业资料共享平台。问题反馈请联系 [xjtuzyxf@163.com](mailto:xjtuzyxf@163.com)。
