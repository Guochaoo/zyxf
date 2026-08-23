# zyxf - 学业辅导中心资料库

> 全栈在线资料库：按文件夹层级组织 PPT / Word / PDF / 图片等学习资料，支持在线预览，文件存储于阿里云 OSS。

## 技术栈

- **前端**：React 18 + Vite + TailwindCSS + React Router
- **后端**：Node.js + Express + SQLite (better-sqlite3) + JWT
- **存储**：阿里云 OSS（前端直传，后端只签名）
- **预览**：
  - 文档（PDF / PPT / Word / Excel / TXT）：阿里云 IMM WebOffice（后端签发访问令牌，前端 JS-SDK 渲染）
  - 图片：原生 `<img>`
  - 归档（zip / rar / 7z 等）：仅下载

## 目录结构

```
project/
├── backend/        # Express 后端
│   ├── src/
│   │   ├── index.js           # 入口（helmet / 限流 / 生产安全校验）
│   │   ├── db.js              # SQLite 初始化
│   │   ├── auth.js            # JWT 签发 / 校验 / 鉴权中间件
│   │   ├── oss.js             # OSS 直传签名 / 对象操作
│   │   ├── imm.js             # 阿里云 IMM WebOffice 预览令牌
│   │   ├── extPolicy.js       # 扩展名白名单 / 预览与下载策略
│   │   ├── storagePath.js     # OSS key 生成（防路径穿越）
│   │   ├── dbHelpers.js       # 共享 DB 工具
│   │   ├── mime.js            # 扩展名 → MIME
│   │   ├── searchService.js   # 全库检索服务（搜索路由与 AI 工具共用）
│   │   ├── llm.js             # OpenAI 兼容 LLM 流式客户端（可选启用）
│   │   └── routes/
│   │       ├── auth.js        # 登录 / 当前用户（登录限流）
│   │       ├── folders.js     # 目录树 / 增删改 / 排序
│   │       ├── files.js       # 上传签名 / 下载签名 / 预览令牌 / 改名移动删除
│   │       ├── search.js      # 智能搜索（名称 / 拼音 / 汉字缩写 / 文件夹路径）
│   │       ├── chat.js        # AI 资料助手（SSE 流式 + 检索工具调用 + 限流）
│   │       ├── stats.js       # 统计面板统计 + /heatmap 年热力图数据
│   │       └── sync.js        # 与共享 OSS bucket 同步
│   ├── package.json
│   └── .env.example
└── frontend/       # React 前端
    ├── src/
    │   ├── main.jsx
    │   ├── App.jsx
    │   ├── api.js
    │   ├── auth.jsx
    │   ├── components/       # FileIcon / Preview / 菜单 / 知识图谱等
    │   └── pages/            # BrowsePage / DashboardPage / LoginPage / AboutPage
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    └── postcss.config.js
```

## 快速启动

### 1. 准备阿里云 OSS

在阿里云控制台创建一个 Bucket（建议**公共读**或保持私有由后端签名）。
记下 `Region` / `Bucket` / `AccessKeyId` / `AccessKeySecret`。
**CORS 配置**（OSS 控制台 → Bucket → 数据安全 → 跨域设置）：

- 来源：`*`（开发期）或填你的前端域名
- 允许 Methods：`GET, POST, PUT, HEAD`
- 允许 Headers：`*`
- 暴露 Headers：`ETag, x-oss-request-id`

### 2. 后端

```powershell
cd backend
npm install
copy .env.example .env
# 编辑 .env 填入 OSS 凭证、JWT 密钥、管理员密码
npm run dev
```

默认监听 `http://localhost:4000`。首次启动会自动创建 SQLite 数据库 `data.db` 和管理员账号。

### 3. 前端

```powershell
cd frontend
npm install
npm run dev
```

打开 `http://localhost:5173`。

## 默认管理员

由 `.env` 中 `ADMIN_USER` / `ADMIN_PASSWORD` 决定（首次启动写入数据库）。

## 主要功能

- 智能搜索：名称子串 / 汉字缩写（搜「高数」找到「高等数学」）/ 拼音全拼与首字母（`gaoshu`、`gdsx`）/ 所在文件夹路径命中（结果标注所属文件夹，名称命中排在路径命中之前）
- AI 资料助手（可选）：右栏流式对话，LLM 通过调用智能搜索按需检索并推荐文件，回答中【文件N】引用渲染为可点击卡片（跳转 / 预览 / 下载）；任意 OpenAI 兼容接口，`.env` 配置 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` 启用，未配置返回 503
- 文件夹任意嵌套，面包屑导航
- 列表 / 网格视图切换，按名称 / 大小 / 时间排序，升降序切换
- 拖拽 / 点击上传文件（直传 OSS，不占后端带宽）
- 在线预览：PDF、PPT、Word、Excel（阿里云 IMM WebOffice）、图片
- 知识图谱：按目录连接关系力导向展示，点击可跳转 / 预览
- 统计面板（`/dashboard`）：近一年 GitHub 式下载热力图、文件类型分布、下载 / 占用排行、今日动态（下载 / 上传）
- 管理员可新建文件夹、上传、删除、改名、移动、排序；游客只读
