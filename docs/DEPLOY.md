# 部署到阿里云 ECS（宝塔面板：Node + nginx）

> 本项目已从 Docker 部署改版为**宝塔面板手动部署**（Node 项目跑后端 + nginx 托管前端 + Let's Encrypt 配 HTTPS）。
> 服务器不再需要 Docker；仓库里也移除了 `docker-compose.yml` 与各 `Dockerfile`。

架构：

```
浏览器 ──HTTP/HTTPS──> nginx (宝塔, 80/443)
                         ├── /  /assets/*   → 静态文件 (frontend/dist)
                         └── /api/*          → 反向代理 → http://127.0.0.1:4000 (宝塔 Node 项目)
                                                               └── 阿里云 OSS (直传/直读)
```

---

## 0. 阿里云控制台准备

### 0.1 ECS 安全组

控制台 → ECS 实例 → **安全组** → 入方向，添加规则：

| 协议 | 端口 | 来源 | 用途 |
|---|---|---|---|
| TCP | 22 | 你的本地 IP | SSH（**不要开 0.0.0.0/0**）|
| TCP | 80 | 0.0.0.0/0 | HTTP |
| TCP | 443 | 0.0.0.0/0 | HTTPS |

> 不要把 4000（后端）暴露公网，让它只在本机监听，由 nginx 转发。

### 0.2 OSS CORS 加白名单

OSS 控制台 → 你的 Bucket → **数据安全 → 跨域设置** → 添加规则：

- 来源：`http://zyxf.top`、`https://zyxf.top`（开发期可加 `http://localhost:5173`）
- 允许 Methods：`GET, POST, PUT, HEAD`
- 允许 Headers：`*`
- 暴露 Headers：`ETag, x-oss-request-id, Content-Length, Content-Range`

### 0.3 域名解析

将域名 A 记录指向 ECS 公网 IP（例：`zyxf.top` → `203.0.113.10`）。

---

## 1. 宝塔面板准备

在宝塔「软件商店」安装：

- **Nginx**（托管前端 + 反代 `/api`）
- **Node.js 版本管理器**（安装 **Node 24**；better-sqlite3 v12 需 Node ≥ 22）
- （可选）PM2 管理器——本项目后端不在命令行用 pm2 启动，而是走宝塔「Node 项目」，所以非必需。

---

## 2. 上传代码 + 配置 `.env`

把项目上传到 `/opt/zyxf`（`backend/`、`frontend/`、`.env` 等）。上传时**不要带**本机的 `node_modules`、`.env`、`data.db`。

`.env` 在**仓库根目录**（`/opt/zyxf/.env`，不是 `backend/` 里——`backend/src/env.js` 读取的是 `../../.env`）。按下述填写：

```env
PORT=4000              # 后端内部端口，保持 4000
HTTP_PORT=80           # 对外 HTTP 端口（nginx 用）

# JWT_SECRET 必须 ≥32 位随机串，且不含弱口令词（password/secret/dev/admin123 等）
JWT_SECRET=<用 openssl rand -hex 32 生成>
JWT_EXPIRES_IN=7d

ADMIN_USER=admin
# 必须 ≥12 位强密码，不能含弱词
ADMIN_PASSWORD=<至少12位强密码>

# 同源部署（nginx 反代）可留空
CORS_ORIGIN=

# 阿里云 OSS（必填）
OSS_REGION=oss-cn-beijing
OSS_BUCKET=<bucket名>
OSS_ACCESS_KEY_ID=<RAM 子账号 AK>
OSS_ACCESS_KEY_SECRET=<RAM 子账号 SK>
OSS_KEY_PREFIX=zyxf/
OSS_ENDPOINT=

# 可选：IMM 文档预览、AI 助手
IMM_PROJECT=
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
```

生成 JWT_SECRET：

```bash
openssl rand -hex 32
```

> ⚠️ 后端在 `NODE_ENV=production` 下，`JWT_SECRET`/`ADMIN_PASSWORD` 不合规会**直接 `process.exit(1)` 拒绝启动**。

---

## 3. 后端：宝塔 Node 项目

1. 宝塔 → **Node 项目** → **添加项目**
2. 对照填写：

   | 字段 | 值 |
   |---|---|
   | 项目目录 | `/opt/zyxf/backend` |
   | 项目名称 | `zyxf` |
   | 启动选项 | `start: node src/index.js` |
   | Node 版本 | `v24.20.0` |
   | 包管理器 | `npm` |
   | 运行用户 | `www` |
   | 项目端口 | `4000` |

3. 点**确定**（宝塔自动 `npm install` 并启动）。
4. 验证：浏览器/本机 `curl http://127.0.0.1:4000/api/health` → 返回 `{"ok":true,...}`。

> 若 `npm install` 时 better-sqlite3 从 GitHub 下载失败，先设国内二进制源再装（终端执行）：
> ```bash
> npm config set better_sqlite3_binary_host https://registry.npmmirror.com/-/binary/better-sqlite3
> ```
> 且务必用 **Node 24** 安装（better-sqlite3 二进制 ABI 与旧 Node 不符会导致启动 `core dumped`）。

---

## 4. 前端：构建 + nginx

### 4.1 构建（一次，代码变更后再构建）

```bash
cd /opt/zyxf/frontend
export PATH="/www/server/nodejs/v24.20.0/bin:$PATH"
npm install
npm run build        # 生成 dist/
```

### 4.2 添加站点

宝塔 → **网站** → **添加站点**：

| 字段 | 值 |
|---|---|
| 域名 | `zyxf.top` |
| 根目录 | `/opt/zyxf/frontend/dist` |
| PHP 版本 | 纯静态 |

### 4.3 配置反向代理

站点 → **设置 → 反向代理** → 添加：

| 字段 | 值 |
|---|---|
| 代理名称 | `zyxf-api` |
| 代理目录 | `/api` |
| 目标 URL | `http://127.0.0.1:4000` |

保存后 nginx 会生成 `location ^~ /api { proxy_pass http://127.0.0.1:4000; ... }`，只有 `/api/*` 转发给后端，`/` 由 nginx 从 `dist` 读取静态文件。

> 也可在「配置文件」里手动粘贴（注意把 `/` 静态托管与 `/api` 反代分开）：
> ```nginx
> location /api/ {
>     proxy_pass http://127.0.0.1:4000;
>     proxy_http_version 1.1;
>     proxy_set_header Host $host;
>     proxy_set_header X-Real-IP $remote_addr;
>     proxy_set_header X-Forwarded-For $remote_addr;
>     proxy_set_header X-Forwarded-Proto $scheme;
>     proxy_buffering off;          # AI 聊天 SSE 流式需要
>     proxy_read_timeout 120s;
> }
> location / {
>     try_files $uri $uri/ /index.html;  # SPA 路由回退
> }
> ```

---

## 5. HTTPS（Let's Encrypt）

1. 站点 → **设置 → SSL → Let's Encrypt** → 勾选 `zyxf.top` → 申请证书。
2. 申请成功后勾选「**强制 HTTPS**」。
3. 之后用 `https://zyxf.top` 访问。

> 前提：域名已解析到 ECS 公网 IP。若 80 端口被占用，把 `.env` 里 `HTTP_PORT` 改成 8080（但 Let's Encrypt 续期依赖 80/443，建议保持 80）。

---

## 6. 校验清单

- [ ] `https://zyxf.top` 能看到首页
- [ ] 右上角「管理员登录」→ 用 `.env` 账号密码能登录
- [ ] 上传一个 PDF → 不报 CORS 错
- [ ] 点击 PDF → 能预览（需先开通 IMM；失败提示「预览服务暂不可用」多半是 IMM 未绑定）
- [ ] 点「下载」→ 文件名是原中文文件名

---

## 7. 日常运维

- 后端日志：宝塔 Node 项目 → `zyxf` → 项目日志；或 `tail -f /opt/zyxf/backend/run.log`
- 后端重启：宝塔 Node 项目 → `zyxf` → 重启
- 前端重构：`cd /opt/zyxf/frontend && npm install && npm run build`
- 数据库备份（重要）：
  ```bash
  cp /opt/zyxf/backend/data.db ~/data.db.bak-$(date +%Y%m%d)
  ```
  建议加 crontab 每日备份。

---

## 8. 常见坑

| 现象 | 原因 | 解决 |
|---|---|---|
| `/api/*` 502 | 后端没起 | 看 `/opt/zyxf/backend/run.log`；`ps aux \| grep index.js` 确认进程 |
| 后端启动即 `core dumped` | better-sqlite3 二进制 ABI 与运行 Node 版本不符 | 用 **Node 24** 重装（`rm -rf node_modules && npm install`）|
| 后端启动即退（无日志） | `JWT_SECRET`/`ADMIN_PASSWORD` 不合生产校验 | 用 `openssl rand -hex 32` + 12 位强密码 |
| 上传报 CORS | OSS 跨域规则没加域名 | 回 0.2 节加 `https://zyxf.top` |
| 上传报 SignatureDoesNotMatch | 服务器时间不准 | `sudo timedatectl set-ntp true` |
| 预览报「预览服务暂不可用」 | IMM 未开通 / 未绑定 | 开通 IMM 并绑定 bucket；`IMM_PROJECT` 匹配 |
| 首页白屏 / `https` 连不上 | SSL 未配或证书没生效 | 见第 5 节申请 Let's Encrypt |
| 访问命中默认站点（旧页） | 按 IP 访问，非域名 | 用域名 `zyxf.top` 访问；确认域名已解析 |
