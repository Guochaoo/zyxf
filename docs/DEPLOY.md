# 部署到阿里云 ECS（公网 IP，HTTP）

> 两种方式任选其一：
> - **方案 A：Docker（推荐）** — 见下方第 A 节
> - **方案 B：传统部署（Node + nginx + pm2）** — 见第 0 节及之后

---

## ⚙️ 自动化：CI 测试与自动部署（GitHub Actions）

当前生产站由这条流水线维护，日常更新只需合并代码到 `main`，无需手动登录服务器：

- **PR → `main`**：`ci.yml` 自动运行后端 `node --test` 与前端 `vitest` 测试（Node 24）
- **push → `main`**：`deploy.yml` 通过 SSH 登录生产服务器（`/opt/zyxf`）执行：

  ```bash
  git pull origin main
  docker compose up -d --build --remove-orphans
  docker image prune -f
  ```

  等价于下文方案 A 的 Docker 部署，由 CI 代劳。

需要的 GitHub 仓库 Secrets：`SERVER_HOST`、`SERVER_USER`、`SERVER_SSH_KEY`（可选 `SERVER_PORT`，默认 22）。首次部署仍需按方案 A / B 手动初始化一次服务器环境。

---

## A. Docker Compose 部署（一键启动）

### A.1 服务器只需装 Docker

```bash
# Ubuntu / Debian 一键脚本
curl -fsSL https://get.docker.com | sudo bash
sudo systemctl enable --now docker

# 验证
docker --version
docker compose version
```

### A.2 阿里云控制台
- ECS 安全组开放 80 端口
- OSS 跨域加 `http://<你的IP>`（参考下方 0.2 节）

### A.3 上传代码并配置

```bash
# 上传整个 project 目录到 /var/www/zyxf（scp 或 git clone）
cd /var/www/zyxf
cp .env.example .env
nano .env   # 至少改 JWT_SECRET、ADMIN_PASSWORD、OSS_* 这几项；IMM_PROJECT 仅在项目名不是 zyxf 时需要
```

生成强随机 `JWT_SECRET`：

```bash
openssl rand -hex 32
```

### A.4 启动

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f backend     # Ctrl+C 退出查看
```

浏览器打开 `http://<你的IP>` —— 完事。

### A.5 日常操作

```bash
# 更新代码后
git pull
docker compose up -d --build

# 重启
docker compose restart

# 停止
docker compose down                 # 数据卷 zyxf-data 保留
docker compose down -v              # 连数据一起删 ⚠️

# 备份数据库
docker run --rm -v zyxf_zyxf-data:/data -v /root/backups:/backup alpine \
  cp /data/data.db /backup/data.db.$(date +%Y%m%d)

# 看容器内日志
docker compose logs backend --tail 100
docker compose logs frontend --tail 100

# 进入容器调试
docker compose exec backend sh
```

### A.6 修改端口（如 80 被占用）

`.env` 里改 `HTTP_PORT=8080`，然后 `docker compose up -d`。

---

# 方案 B：传统部署

整体架构：

```
浏览器 ──HTTP──> nginx (ECS, 80)
                  ├── /          → 静态文件 (frontend/dist)
                  └── /api/*     → 反向代理 → http://127.0.0.1:4000 (node + pm2)
                                              └── 阿里云 OSS (HTTPS 直传/直读)
```

---

## 0. 阿里云控制台准备

### 0.1 ECS 安全组

控制台 → ECS 实例 → **安全组** → 入方向，添加规则：

| 协议 | 端口 | 来源 | 用途 |
|---|---|---|---|
| TCP | 22 | 你的本地 IP | SSH（**不要开 0.0.0.0/0**）|
| TCP | 80 | 0.0.0.0/0 | HTTP |

> 不要把 4000（后端）暴露公网，让它只在本机监听，由 nginx 转发。

### 0.2 OSS CORS 加白名单

OSS 控制台 → `xjtu-zyxf` Bucket → **数据安全 → 跨域设置** → 添加规则：

- 来源：`http://<你的公网IP>`（也可以加 `http://localhost:5173` 方便本地继续开发）
- 允许 Methods：`GET, POST, PUT, HEAD`
- 允许 Headers：`*`
- 暴露 Headers：`ETag, x-oss-request-id, Content-Length, Content-Range`

### 0.3 文档预览：开通并绑定 IMM 项目（推荐）

在线预览（PDF / PPT / Word / Excel / TXT）走阿里云**智能媒体管理 IMM** 的
`GenerateWebofficeToken` 接口（后端 RPC 签名，不占用前端带宽）：

1. 阿里云控制台开通 IMM，并在 OSS 控制台的 bucket → **智能媒体管理** 里绑定一个 IMM 项目（默认项目名 `zyxf`）
2. 若项目名不同，在 `.env` 中设置 `IMM_PROJECT=<项目名>`
3. 不配置时预览接口返回 502（其余功能不受影响，预览失败前端的报错提示是「预览服务暂不可用」）

### 0.4 AI 资料助手：接入 OpenAI 兼容 LLM（可选）

资料库右栏的 AI 对话（按需检索并推荐文件）走任意 **OpenAI 兼容**
`/chat/completions` 接口（SSE 流式 + 工具调用）。在 `.env` 中三个变量**同时**配置即可启用：

```bash
LLM_API_KEY=<你的 API Key>
LLM_BASE_URL=<API 根地址，如 https://open.bigmodel.cn/api/paas/v4>
LLM_MODEL=<模型名，如 glm-4.6 / deepseek-chat / qwen-plus>
```

- 不配置时聊天接口返回 503，前端显示「AI 功能未配置」，其余功能不受影响
- 成本控制：游客每 IP 每分钟 6 次、每小时 20 次（管理员豁免）；每次对话最多 2 轮检索
- nginx 已为 `/api/` 关闭缓冲（`proxy_buffering off`），SSE 流式无需额外配置

---

## 1. ECS 系统准备（Ubuntu 22.04）

SSH 登录 ECS，执行：

```bash
# 升级 + 基础工具
sudo apt update && sudo apt -y upgrade
sudo apt -y install curl git build-essential nginx

# Node.js 20+（推荐 24 LTS，与项目 CI 一致）
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt -y install nodejs
node -v && npm -v

# pm2 进程守护
sudo npm i -g pm2

# 配置 npm 国内镜像（可选，下载更快）
npm config set registry https://registry.npmmirror.com
```

---

## 2. 上传代码

### 方案 A：本地 zip 后用 scp 上传（最简单）

本地 PowerShell：

```powershell
cd d:\Code
# 打包（排除 node_modules、.env、data.db）
$exclude = @('node_modules', '.env', 'data.db', 'data.db-journal', 'dist', '.git')
Compress-Archive -Path project\backend, project\frontend, project\README.md, project\docs -DestinationPath project.zip -Force
# 上传
scp project.zip root@<你的公网IP>:/root/
```

服务器上：

```bash
cd /root
unzip project.zip -d /var/www/zyxf
cd /var/www/zyxf
ls
```

### 方案 B：git（推荐长期）

如果你把项目推到 GitHub/Gitee：

```bash
sudo mkdir -p /var/www
cd /var/www
git clone <你的仓库地址> zyxf
cd zyxf
```

---

## 3. 后端：装依赖 + 配置 .env + pm2 启动

> ⚠️ 自环境变量重构起，`.env` 位于**仓库根目录**（本地开发与 Docker 共用同一份，`backend/src/env.js` 读取 `../../.env`），不在 `backend/` 里。

```bash
cd /var/www/zyxf
cp .env.example .env
nano .env

cd backend
npm install
```

`.env` 修改这几项（**生产环境必须改**）：

```env
PORT=4000

# 至少 32 位随机字符串
JWT_SECRET=<随机字符串，比如 openssl rand -hex 32 生成的>

ADMIN_USER=admin
# 改成强密码
ADMIN_PASSWORD=<至少 12 位强密码>

OSS_REGION=oss-cn-beijing
OSS_BUCKET=xjtu-zyxf
OSS_ACCESS_KEY_ID=<阿里云 RAM 用户的 AK>
OSS_ACCESS_KEY_SECRET=<对应 SK>
OSS_KEY_PREFIX=zyxf/
OSS_ENDPOINT=

# 严格只允许你的公网IP（开发期可以加 localhost:5173）
CORS_ORIGIN=http://<你的公网IP>
```

> 生成随机密钥：`openssl rand -hex 32`

> ⚠️ **生产启动校验**：后端在 `NODE_ENV=production` 下会**拒绝启动**——`JWT_SECRET` 必须 ≥32 位随机且不含弱口令词、`ADMIN_PASSWORD` 必须 ≥12 位，否则进程直接退出（防止用默认值/示例值上线）。另外 CORS_ORIGIN 为 `*` 时只告警不拦截。

启动：

```bash
pm2 start src/index.js --name zyxf-backend
pm2 save
pm2 startup            # 复制并执行它输出的那行命令，让 pm2 开机自启

# 查看
pm2 status
pm2 logs zyxf-backend --lines 30
```

测试本机访问后端：

```bash
curl http://127.0.0.1:4000/api/health
# 应输出 {"ok":true,...}
```

---

## 4. 前端：构建 + 部署到 nginx

```bash
cd /var/www/zyxf/frontend
npm install
npm run build           # 生成 dist/
ls dist
```

`dist/` 就是要给 nginx 服务的静态目录。

---

## 5. 配置 nginx

```bash
sudo nano /etc/nginx/sites-available/zyxf
```

粘贴：

```nginx
server {
    listen 80 default_server;
    server_name _;

    # 上传可以大一点（虽然走的是 OSS 直传，但 API 请求体也走这里）
    client_max_body_size 10m;

    root /var/www/zyxf/frontend/dist;
    index index.html;

    # 前端静态资源 — 哈希命名的可以长缓存
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # API 转发到后端
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Overwrite (not append): the backend trusts the leftmost XFF entry
        # (trust proxy), so a client-supplied X-Forwarded-For must not pass through.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        # AI 聊天走 SSE 流式响应：禁用缓冲，放宽读超时（与 frontend/nginx.conf 一致）
        proxy_buffering off;
        proxy_read_timeout 120s;
    }

    # SPA fallback：所有未匹配路径都返回 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

启用：

```bash
sudo ln -sf /etc/nginx/sites-available/zyxf /etc/nginx/sites-enabled/zyxf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t           # 检查配置无误
sudo systemctl reload nginx
```

浏览器打开 `http://<你的公网IP>` —— 应该能看到「仲英学辅 · 资料库」。

---

## 6. 校验清单

- [ ] `http://<IP>` 打开能看到首页
- [ ] 右上角「管理员登录」→ 用 `.env` 里的账号密码能登录
- [ ] 上传一个 PDF → 不报 CORS 错（如报错，回 0.2 节加来源）
- [ ] 点击 PDF → 弹框内能预览（走阿里云 IMM/WebOffice，需先完成 0.3 节；失败提示「预览服务暂不可用」多半是 IMM 未绑定）
- [ ] 点「下载」→ 文件名是原中文文件名
- [ ] 拖拽排序 / 移入文件夹工作正常

---

## 7. 日常运维

```bash
# 查看后端日志
pm2 logs zyxf-backend

# 后端代码改了，重启
cd /var/www/zyxf/backend
pm2 restart zyxf-backend

# 前端代码改了，重新构建（无需重启 nginx，浏览器刷新即可）
cd /var/www/zyxf/frontend
npm run build

# 数据库备份（重要！）
cp /var/www/zyxf/backend/data.db ~/data.db.bak-$(date +%Y%m%d)
# 建议加个 crontab：每天凌晨备份
echo "0 3 * * * cp /var/www/zyxf/backend/data.db /root/backups/data.db.\$(date +\%Y\%m\%d)" | crontab -
mkdir -p /root/backups
```

---

## 8. 安全注意（HTTP + 公网 IP 模式）

⚠️ **HTTP 是明文传输**，包括管理员的密码和 JWT token。任何人在网络路径上都能截获。

**最低限度的缓解**：

1. **强密码** + **JWT_SECRET 随机** + **限制 SSH 来源 IP**
2. **OSS RAM 子用户只授权当前 bucket，最小权限**（`AliyunOSSFullAccess` 限定到 `xjtu-zyxf`）
3. **管理员只在可信网络下登录**（家里 / 校园网，避免咖啡店公共 WiFi）
4. **定期备份 `data.db`**（如上面的 crontab）

**强烈建议后续上 HTTPS**：

- 备案一个便宜的 `.top` / `.xyz` 域名（约 ¥10/年）
- DNS 指向 ECS 公网 IP
- 服务器跑 `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d yourdomain.com`
- 自动配置 HTTPS + 续期，全程免费（Let's Encrypt）
- 然后把 `.env` 的 `CORS_ORIGIN` 和 OSS CORS 都改成 `https://yourdomain.com`

---

## 9. 常见坑

| 现象 | 原因 | 解决 |
|---|---|---|
| 打开页面空白 / 404 | nginx 没指向 dist | 检查 `root` 路径 |
| `/api/*` 502 | 后端没起来 | `pm2 status` / `pm2 logs` |
| 上传报 CORS | OSS 跨域规则没加新来源 | 回 0.2 节加 `http://<IP>` |
| 上传报 SignatureDoesNotMatch | 服务器时间不对 | `sudo timedatectl set-ntp true` |
| 预览 PDF 空白 | 浏览器 fetch OSS 跨域失败 | 同 CORS，确认暴露 `Content-Length` |
| 预览报「预览服务暂不可用」 | IMM 未开通 / 项目未绑定 bucket / `IMM_PROJECT` 不对 | 完成 0.3 节；`docker compose logs backend` 看具体报错 |
| 生产启动直接退出 | `JWT_SECRET` / `ADMIN_PASSWORD` 未达到强度要求 | 按 3 节用 `openssl rand -hex 32` + 12 位以上强密码 |
| pm2 重启不生效 | 用了旧的进程 | `pm2 delete zyxf-backend && pm2 start ...` 重来 |
