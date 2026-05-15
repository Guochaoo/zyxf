# zyxf - 学业辅导中心资料库

> 全栈在线资料库：按文件夹层级组织 PPT / Word / PDF / 图片等学习资料，支持在线预览，文件存储于阿里云 OSS。

## 技术栈

- **前端**：React 18 + Vite + TailwindCSS + React Router
- **后端**：Node.js + Express + SQLite (better-sqlite3) + JWT
- **存储**：阿里云 OSS（前端直传，后端只签名）
- **预览**：
  - 图片：原生 `<img>`
  - PDF：浏览器内置 / `<iframe>`
  - PPT / Word / Excel：Microsoft Office Online Viewer

## 目录结构

```
project/
├── backend/        # Express 后端
│   ├── src/
│   │   ├── index.js           # 入口
│   │   ├── db.js              # SQLite 初始化
│   │   ├── auth.js            # JWT 中间件
│   │   ├── oss.js             # OSS 直传签名
│   │   └── routes/
│   │       ├── auth.js
│   │       ├── folders.js
│   │       └── files.js
│   ├── package.json
│   └── .env.example
└── frontend/       # React 前端
    ├── src/
    │   ├── main.jsx
    │   ├── App.jsx
    │   ├── api.js
    │   ├── auth.jsx
    │   ├── components/
    │   └── pages/
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

- 文件夹任意嵌套，面包屑导航
- 列表 / 网格视图切换，按名称 / 大小 / 时间排序，升降序切换
- 拖拽 / 点击上传文件（直传 OSS，不占后端带宽）
- 在线预览：图片、PDF、PPT、Word、Excel
- 管理员可新建文件夹、上传、删除；游客只读
