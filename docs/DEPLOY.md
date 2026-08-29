# 部署到阿里云 ECS（systemd + nginx）

> 后端用 **systemd** 托管（`deploy/zyxf.service`），前端构建产物由 **nginx** 托管并反代 `/api`，HTTPS 用 Let's Encrypt。
> 部署不再依赖宝塔面板管理 Node 项目——SSH 上去 `git fetch + reset --hard`（对齐 origin/main）+ 装依赖 + 构建 + `systemctl restart zyxf` 即可，由 `.github/workflows/deploy.yml` 全自动完成。

架构：

```
浏览器 ──HTTP/HTTPS──> nginx (80/443)
                         ├── /  /assets/*   → 静态文件 (frontend/dist)
                         └── /api/*          → 反向代理 → http://127.0.0.1:4000 (systemd: zyxf.service)
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

> 不要把 4000（后端）暴露公网：后端 `app.listen(PORT)` 默认绑定 `0.0.0.0`，需靠**安全组规则**限制 4000 端口仅本机可访问（nginx 在本机反代 `127.0.0.1:4000` 不受影响）。

### 0.2 OSS CORS 加白名单

OSS 控制台 → 你的 Bucket → **数据安全 → 跨域设置** → 添加规则：

- 来源：`http://zyxf.top`、`https://zyxf.top`（开发期可加 `http://localhost:5173`）
- 允许 Methods：`GET, POST, PUT, HEAD`
- 允许 Headers：`*`
- 暴露 Headers：`ETag, x-oss-request-id, Content-Length, Content-Range`

### 0.3 域名解析

将域名 A 记录指向 ECS 公网 IP（例：`zyxf.top` → `47.93.224.61`）。

---

## 1. 服务器准备

需要：

- **Nginx**（托管前端 + 反代 `/api`）
- **Node 24**（项目使用内置 `node:sqlite`，无原生编译依赖，安装后无需配置二进制源）
- **systemd**（Linux 标配，无需额外安装）

> Node 24 若仍装在宝塔路径 `/www/server/nodejs/v24.20.0/bin`，本仓库的 systemd unit 与 deploy workflow 都按该绝对路径调用，无需软链到全局；如果你想用全局 `node`，改 `deploy/zyxf.service` 的 `ExecStart` 和 `deploy.yml` 里的 `export PATH` 即可。

---

## 2. 上传代码 + 配置 `.env`

把项目上传到 `/opt/zyxf`（`backend/`、`frontend/`、`.env` 等）。上传时**不要带**本机的 `node_modules`、`.env`、`data.db`。

`.env` 在**仓库根目录**（`/opt/zyxf/.env`，不是 `backend/` 里——`backend/src/env.js` 读取的是 `../../.env`）。按下述填写：

```env
PORT=4000              # 后端内部端口，保持 4000

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

## 3. 后端：systemd 服务

后端由 systemd 托管，`deploy/zyxf.service` 已随仓库提供（`User=www`、`WorkingDirectory=/opt/zyxf/backend`、`NODE_ENV=production`、`ExecStart` 指向 Node 24 绝对路径）。

首次部署（deploy workflow 会自动执行）：

```bash
cp /opt/zyxf/deploy/zyxf.service /etc/systemd/system/zyxf.service
systemctl daemon-reload
systemctl enable zyxf
systemctl restart zyxf
```

日常命令：

```bash
systemctl restart zyxf          # 重启
systemctl status zyxf           # 查看状态
journalctl -u zyxf -f           # 跟踪日志
```

验证：`curl http://127.0.0.1:4000/api/health` → 返回 `{"ok":true,...}`。

---

## 4. 前端：构建 + nginx

### 4.1 构建（一次，代码变更后再构建）

```bash
cd /opt/zyxf/frontend
export PATH="/www/server/nodejs/v24.20.0/bin:$PATH"
npm install
npm run build        # 生成 dist/
```

### 4.2 nginx 站点配置

在 `/etc/nginx/conf.d/zyxf.conf`（或宝塔已建站点的配置目录）写一份配置，把 `/` 静态托管与 `/api` 反代分开：

> 下面是**简版模板**（仅 `listen 80`，用于起步验证）。完整版（含 80→443 跳转、`/assets/` 长缓存、Let's Encrypt 证书路径）见仓库里的 [frontend/nginx.conf](../frontend/nginx.conf)，证书申请见第 5 节。

```nginx
server {
    listen 80;
    server_name zyxf.top;

    root /opt/zyxf/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;          # AI 聊天 SSE 流式需要
        proxy_read_timeout 120s;
    }

    location / {
        try_files $uri $uri/ /index.html;  # SPA 路由回退
    }
}
```

写完后：

```bash
nginx -t && systemctl reload nginx
```

> 若 nginx 是宝塔安装的，配置文件可能放在宝塔的站点目录下；直接在对应站点配置里粘贴上述 `location` 块即可，效果一致。

---

## 5. HTTPS（Let's Encrypt）

用 certbot 直接申请（不经过宝塔）：

```bash
apt install -y certbot python3-certbot-nginx   # 或 yum install certbot python3-certbot-nginx
certbot --nginx -d zyxf.top
```

certbot 会自动改写上面的 nginx 配置加入 443 与证书，并配置续期（`certbot renew` 由系统 timer 自动跑）。之后用 `https://zyxf.top` 访问。

> 前提：域名已解析到 ECS 公网 IP，80/443 端口开放（Let's Encrypt 验证与续期都依赖）。

---

## 6. 校验清单

- [ ] `https://zyxf.top` 能看到首页
- [ ] 展开右侧菜单 → 底部账户卡的「登录」按钮 → 用 `.env` 账号密码能登录
- [ ] 上传一个 PDF → 不报 CORS 错
- [ ] 点击 PDF → 能预览（需先开通 IMM；失败提示「预览服务暂不可用」多半是 IMM 未绑定）
- [ ] 点「下载」→ 文件名是原中文文件名

---

## 7. 日常运维

- 后端日志：`journalctl -u zyxf -f`
- 后端重启：`systemctl restart zyxf`
- 后端状态：`systemctl status zyxf`
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
| `/api/*` 502 | 后端没起 | `systemctl status zyxf`；`journalctl -u zyxf -n 50` 看启动报错 |
| 后端启动即退（无正常启动日志） | `JWT_SECRET`/`ADMIN_PASSWORD` 不合生产校验（会打印 `[index] FATAL...` 到 stderr） | 用 `openssl rand -hex 32` + 12 位强密码 |
| 上传报 CORS | OSS 跨域规则没加域名 | 回 0.2 节加 `https://zyxf.top` |
| 上传报 SignatureDoesNotMatch | 服务器时间不准 | `sudo timedatectl set-ntp true` |
| 预览报「预览服务暂不可用」 | IMM 未开通 / 未绑定（也可能是凭证缺失或请求超时） | 开通 IMM 并绑定 bucket；`IMM_PROJECT` 匹配；查 `journalctl -u zyxf` |
| 首页白屏 / `https` 连不上 | SSL 未配或证书没生效 | 见第 5 节申请 Let's Encrypt |
| 访问命中默认站点（旧页） | 按 IP 访问，非域名 | 用域名 `zyxf.top` 访问；确认域名已解析 |
