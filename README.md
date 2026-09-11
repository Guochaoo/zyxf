# 仲英学辅 · 资料库（zyxf）

> 西安交通大学仲英书院学业辅导中心的全栈在线资料库：按文件夹层级组织 PPT / Word / PDF / 图片等学习资料，提供智能搜索、AI 资料助手、在线预览、知识图谱与下载统计。文件直存阿里云 OSS，不占应用服务器带宽。

线上地址：<https://zyxf.top>

## 功能特性

- **资料管理**：文件夹任意嵌套；按名称、大小、时间排序，升降序可切换；拖拽 / 点击上传（前端直传 OSS）；后端提供面包屑数据（前端当前未在 UI 展示）
- **智能搜索**：名称子串、汉字缩写（搜「高数」命中「高等数学」）、拼音全拼与首字母（`gaoshu` / `gdsx`）、所在文件夹路径命中；名称命中排在路径命中之前，结果标注所属文件夹
- **AI 资料助手**（可选）：右栏流式对话，LLM 按需调用智能检索并推荐文件；回答中【文件N】引用渲染为可点击卡片（跳转 / 预览）；支持三种上游协议（OpenAI Chat Completions / OpenAI Responses / Anthropic Messages），浏览器端配置或服务器端 env 配置均可；游客限流、管理员豁免
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
| AI（可选） | 三种上游协议：OpenAI `/chat/completions`、OpenAI `/responses`、Anthropic `/messages`，均支持 SSE 流式 + 工具调用 |

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
| `LLM_PROTOCOL` |  | 上游协议：`openai-completions`（默认，OpenAI/GLM/DeepSeek 等 `/chat/completions` 接口）/ `openai-responses`（OpenAI `/responses`）/ `anthropic-messages`（Anthropic `/messages`）。旧值 `openai` / `anthropic` 仍兼容。前端设置里的「API 协议」可让用户用自带 Key 覆盖它 |
| `DM_ACCESS_KEY_ID` / `DM_ACCESS_KEY_SECRET` / `DM_ACCOUNT_NAME` |  | 三者齐备才启用用户注册（阿里云邮件推送 DirectMail 发送邮箱验证码），留空则注册发码接口返回 503 |
| `DM_FROM_ALIAS` |  | 发件人显示名（默认「仲英学辅」） |
| `EMBED_MODEL_DIR` |  | 本地嵌入模型目录（默认 `backend/models/bge-small-zh-v1.5`）；模型文件不入库，获取方式见[部署文档 §6](docs/DEPLOY.md)。缺模型时只抽正文不出向量，图谱内容视图不可用，其余功能不受影响 |
| `INDEX_POLL_MS` / `INDEX_DAILY_LIMIT` |  | 索引 worker 的空闲轮询间隔（默认 8s）/ 每日嵌入调用上限（默认 2000，防误操作长时间占满 CPU） |

## 内容索引与语义分类（知识图谱「内容视图」的数据来源）

图谱默认按**内容语义分类**组织，而不是按目录摊开：

```
根 ─┬─ 学科分类（大类）─┬─ 内容细分 ─ 文件
    │                    └─ 内容细分 ─ 文件
    └─ …
```

- 大类 = 顶层学科目录；**内容细分** = 该学科目录内按内容向量聚类（k-means，每约 8 个文件一簇、上限 5 簇）
- 细分名字由 LLM 起一次并缓存（无 LLM 时回落到文件名里本簇独有的词）；实测本库 **53 个大类 / 84 个细分 / 85% 有名字**
- 未被索引的文件（扫描件、老格式）不进分类，切到**目录视图**照常按文件夹浏览

覆盖率取决于资料本身（实测本库 850 个文件的真实结果）：

| 类别 | 数量 | 占比 | 说明 |
|---|---|---|---|
| 有文本层（PDF/docx/pptx/txt/pptm） | 509 | 60% | 正常进入内容视图 |
| 扫描件与图片版 Office | 122 | 14% | 判定为 `image_only`，只出现在目录视图（需 OCR，见 `docs/ISSUES.md` 的 IMPROVE-39） |
| `.doc` / `.ppt` / 压缩包 / 图片 | 216 | 25% | `unsupported`：老二进制格式没有纯 JS 解析路径 |
| 抽取失败 | 3 | — | 记 `last_error`，不影响其他文件 |

后两类没有内容语义，只能靠**目录视图**浏览，所以内容视图覆盖约 **61%** 的资料——上限由资料本身决定，OCR 是下一轮的事。

- 索引是**后台异步**做的：上传、`/api/sync` 后自动入队，单并发处理，不阻塞请求。图谱会显示「正在建立内容索引（N 个待处理）…」并每 5 秒自动刷新，直到新资料进入分类。
- 进度与失败原因：`GET /api/index/status`；管理员可用 `POST /api/index/rebuild` 重建。
- 语义分类：`GET /api/index/taxonomy`（**按学科缓存**，新增一个文件只重算它所在的学科）；管理员可用 `POST /api/index/taxonomy/refresh` 强制全部重算。
- 降级：没装模型时只抽正文；没有分类数据时图谱内容视图给出提示，可一键切到目录视图（图谱只有这两档）。

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
│   │   ├── textExtract.js / ooxml.js           # 正文抽取（PDF/OOXML/纯文本，含扫描件判定）
│   │   ├── embed.js                            # 本地嵌入（bge-small-zh ONNX，可缺失降级）
│   │   ├── indexPipeline.js                    # 内容索引队列与 worker
│   │   ├── llm.js         # LLM 流式客户端（OpenAI / Anthropic，可选启用）
│   │   ├── llmProtocols.js # 上游协议适配（请求体与 SSE 形状翻译，纯函数）
│   │   └── routes/        # auth / folders / files / search / chat / stats / sync / indexing
│   ├── models/            # 本地嵌入模型（gitignore，按需下载）
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

UI 遵循受 Vercel 启发、以「无界」（边界靠表面色深浅 / 留白 / 投影海拔，而非边框线）为核心的设计系统：色彩 token、OPPO Sans 排版、组件样式、三栏布局与阴影层级，详见 **[docs/DESIGN.md](docs/DESIGN.md)**（中文，逐条对应代码实现）。

## 关于

仲英书院学业辅导中心 · 学业资料共享平台。问题反馈请联系 [xjtuzyxf@163.com](mailto:xjtuzyxf@163.com)。
