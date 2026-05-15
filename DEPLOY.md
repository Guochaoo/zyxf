# 部署到阿里云 ECS（公网 IP，HTTP）

> 两种方式任选其一：
> - **方案 A：Docker（推荐）** — 见下方第 A 节
> - **方案 B：传统部署（Node + nginx + pm2）** — 见第 0 节及之后

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
nano .env   # 至少改 JWT_SECRET、ADMIN_PASSWORD、OSS_* 这几项
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

---

## 1. ECS 系统准备（Ubuntu 22.04）

SSH 登录 ECS，执行：

```bash
# 升级 + 基础工具
sudo apt update && sudo apt -y upgrade
sudo apt -y install curl git build-essential nginx

# Node.js 20 (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
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
Compress-Archive -Path project\backend, project\frontend, project\README.md, project\DEPLOY.md -DestinationPath project.zip -Force
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

```bash
cd /var/www/zyxf/backend
npm install

# 创建并编辑 .env
cp .env.example .env
nano .env
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
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
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
- [ ] 点击 PDF → 弹框内能预览
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
| pm2 重启不生效 | 用了旧的进程 | `pm2 delete zyxf-backend && pm2 start ...` 重来 |
