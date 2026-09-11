# 部署到阿里云 ECS（systemd + nginx）

> 后端用 **systemd** 托管（`deploy/zyxf.service`），前端构建产物由 **nginx** 托管并反代 `/api`，HTTPS 用 Let's Encrypt。
> 部署不再依赖宝塔面板管理 Node 项目——SSH 上去 `git fetch + reset --hard`（对齐 origin/main）+ 装依赖 + 构建 + `systemctl restart zyxf` 即可，由 `.github/workflows/deploy.yml` 全自动完成；部署后健康检查（`/api/health`）失败时，workflow 会自动把服务器退回部署前的修订并重建，避免线上持续 502。

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

> 后端默认绑定 `127.0.0.1`（`HOST` 环境变量可覆盖），因此**不依赖安全组**也不会被公网直连。这同时是限流的前提：后端信任 `X-Forwarded-For` 取客户端 IP，只有不可直连时该信任才安全——否则外部可伪造 XFF 绕过所有限流（BUG-36）。安全组仍建议不开 4000，作为纵深防御。

### 0.2 OSS CORS 加白名单

OSS 控制台 → 你的 Bucket → **数据安全 → 跨域设置** → 添加规则：

- 来源：`http://zyxf.top`、`https://zyxf.top`（开发期可加 `http://localhost:5173`）
- 允许 Methods：`GET, POST, PUT, HEAD`
- 允许 Headers：`*`
- 暴露 Headers：`ETag, x-oss-request-id, Content-Length, Content-Range`

### 0.3 域名解析

将域名 A 记录指向 ECS 公网 IP（例：`zyxf.top` → `203.0.113.10`）。

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
# 后端监听地址，默认 127.0.0.1（只允许本机 nginx 反代）。确需其它主机直连才设 0.0.0.0。
HOST=127.0.0.1

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
# AI 助手：三个变量齐备才启用（地址填到版本层，如 https://open.bigmodel.cn/api/paas/v4）
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
# 上游协议，留空=openai（OpenAI 兼容）；Anthropic Messages API 填 anthropic
LLM_PROTOCOL=

# 可选：用户注册邮箱验证码（阿里云邮件推送 DirectMail，三项齐备才启用）
DM_ACCESS_KEY_ID=<AccessKey ID>
DM_ACCESS_KEY_SECRET=<AccessKey Secret>
DM_ACCOUNT_NAME=<发信地址，如 no-reply@zyxf.top>
DM_FROM_ALIAS=

# 可选：下载日志保留天数（含 ip/ua，默认 400 天）
DOWNLOAD_LOG_RETENTION_DAYS=
```

生成 JWT_SECRET：

```bash
openssl rand -hex 32
```

> ⚠️ 后端在 `NODE_ENV=production` 下，`JWT_SECRET`/`ADMIN_PASSWORD` 不合规会**直接 `process.exit(1)` 拒绝启动**。

> ⚠️ `ADMIN_USER`/`ADMIN_PASSWORD` 是管理员账号的**唯一权威来源**：每次启动都会与库内哈希比对，密码变了就同步（旧密码失效），同名普通用户会被提为 admin。因此改密码只需改 `.env` 再重启（BUG-34）。

### 2.1 目录属主与权限（否则服务启动即退出）

`deploy/zyxf.service` 以 `User=www` 运行，工作目录是 `/opt/zyxf/backend`，而 `db.js` 会在这个目录里创建并写入 `data.db`（连同 `-wal`/`-shm`）。若上传时用的是 root，`/opt/zyxf` 归 root 所有，`www` 对 `backend/` 没有写权限 → SQLite 打不开 → 进程启动即退出 → nginx 反代变成 502，日志里只有一行 `SQLITE_CANTOPEN`。

```bash
# 1) 建服务用户（若不存在）
sudo useradd --system --home /opt/zyxf --shell /usr/sbin/nologin www 2>/dev/null || true
# 2) 整棵树交给 www（nginx 只读 dist，用 755 即可）
sudo chown -R www:www /opt/zyxf
sudo chmod 755 /opt/zyxf /opt/zyxf/backend /opt/zyxf/frontend
# 3) 数据库文件本身必须是 600，且不能是 root 所有
sudo chmod 600 /opt/zyxf/backend/data.db 2>/dev/null || true
# 4) 以服务身份验证可写（这条必须过；输出 "not writable" 就别急着起服务）
sudo -u www test -w /opt/zyxf/backend && echo "backend writable" || echo "not writable"
sudo -u www node -e "const{DatabaseSync}=require('node:sqlite');new DatabaseSync('/opt/zyxf/backend/data.db').exec('PRAGMA journal_mode=WAL');console.log('db open ok')"
```

> ⚠️ `.env` 含密钥，属主交给 `www` 后建议 `chmod 600 /opt/zyxf/.env`（`www` 能读即可）。
> ⚠️ 之后每次用 root 上传/解压代码（尤其 `tar` 带 `--same-owner` 或覆盖 `backend/`）都要**重跑第 2 步**，否则属主被改回 root，故障会在下次重启时复现。

### 2.2 OSS 凭证：单独一个 RAM 用户 + 最小权限策略

不要复用个人或其他业务的 RAM 用户（例如一把同时给个人网盘用的密钥），也不要给 `PowerUserAccess` 这类全产品权限。后端对 OSS 的实际操作面很窄，按下面建专用用户即可：

| 后端调用 | 需要的动作 |
|---|---|
| `listOssObjects`（同步扫描） | `oss:ListObjects` |
| `signedGetUrl`（下载/预览签名） | `oss:GetObject` |
| `putEmptyOssObject`（文件夹占位符） | `oss:PutObject` |
| 前端直传（PostObject） | `oss:PutObject` |
| `copyOssObject`（改名/移动） | `oss:CopyObject` + `oss:PutObject` |
| `deleteOssObjectIfExists`（删除） | `oss:DeleteObject` |

> 注意：后端**只签名**、不代理文件流，上传流量走浏览器直传，所以后端不需要 `oss:GetObject` 之外的读权限；IMM 预览若启用，`GenerateWebofficeToken` 也需要能读该 bucket（IMM 由阿里云服务侧读取）。

自定义策略（把 bucket 名替换成你自己的；`acs:oss:*:*:<bucket>/*` 用来覆盖对象级操作）：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "oss:ListObjects",
        "oss:GetObject",
        "oss:PutObject",
        "oss:DeleteObject",
        "oss:CopyObject"
      ],
      "Resource": [
        "acs:oss:*:*:<bucket>",
        "acs:oss:*:*:<bucket>/*"
      ]
    }
  ]
}
```

用 CLI 落地（写入前先用只读 `list` 验证密钥确实只能访问目标 bucket）：

```bash
# 1) 建策略
aliyun ram CreatePolicy --PolicyName zyxf-oss-app \
  --PolicyDocument "$(cat oss-policy.json)" --region cn-beijing

# 2) 建专用用户并授权
aliyun ram CreateUser --UserName zyxf-oss --region cn-beijing
aliyun ram AttachPolicyToUser --PolicyType Custom --PolicyName zyxf-oss-app \
  --UserName zyxf-oss --region cn-beijing

# 3) 建 AccessKey，把密钥填进 .env 的 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
aliyun ram CreateAccessKey --UserName zyxf-oss --region cn-beijing
```

验证：用新密钥访问**其他** bucket 应返回 `AccessDenied`（越权被拒），访问目标 bucket 正常——两者都满足才算最小权限生效。

### 2.3 DirectMail 凭证（注册验证码）

同理，`DM_ACCESS_KEY_ID`/`DM_ACCESS_KEY_SECRET` 应使用**专用 RAM 用户**，且只授予发信所需的单个动作——应用只调用 `SingleSendMail`，不需要 `dm:*`（域名/模板/收件人管理、IP 防护等都不需要）：

```json
{
  "Version": "1",
  "Statement": [
    { "Effect": "Allow", "Action": ["dm:SingleSendMail"], "Resource": ["acs:dm:*:*:*"] }
  ]
}
```

```bash
aliyun ram CreatePolicy --PolicyName zyxf-dm-send --PolicyDocument "$(cat dm-policy.json)" --region cn-beijing
aliyun ram CreateUser --UserName zyxf-mail --region cn-beijing
aliyun ram AttachPolicyToUser --PolicyType Custom --PolicyName zyxf-dm-send --UserName zyxf-mail --region cn-beijing
aliyun ram CreateAccessKey --UserName zyxf-mail --region cn-beijing
```

验证：越权只读动作（如 `GetTrackList`，**必须传齐必填参数**，否则会先报参数错误而非权限错误）应返回 `Forbidden`；`SingleSendMail` 传一个格式非法的收件地址应返回地址校验错误（`InvalidToAddress`）而非权限错误。

### 2.4 数据保留

下载日志含访问者 `ip`/`ua`，属个人信息。后端启动时按 `DOWNLOAD_LOG_RETENTION_DAYS`（默认 400，略大于仪表盘热力图的近一年窗口）清理超期记录；无需保留访问明细时可调小。

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

    # 安全响应头。CSP 必须由托管 HTML 的 nginx 下发——后端只服务 /api，那里的
    # CSP 管不到页面。若某个 location 自己写了 add_header，会屏蔽本级继承，需重复声明。
    # 策略含义：script-src 仅 self（构建产物无内联脚本）；style-src 需 unsafe-inline
    # （React 内联 style）再加 fonts.googleapis.com（index.html 引入的 DM Sans 样式表，
    # 缺它会被静默拦掉）；connect-src https: 覆盖 OSS 与用户自带 LLM；frame-src https:
    # 给 IMM WebOffice 预览；font-src 给 Google Fonts。建议先用 Report-Only 观察。
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https:; frame-src https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

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

- [ ] 后端目录对服务用户可写（`sudo -u www test -w /opt/zyxf/backend`），`journalctl -u zyxf` 无 `SQLITE_CANTOPEN`
- [ ] `https://zyxf.top` 能看到首页
- [ ] 展开右侧菜单 → 底部账户卡右侧箭头展开菜单 → 「登录」 → 用 `.env` 账号密码能登录
- [ ] 上传一个 PDF → 不报 CORS 错
- [ ] 点击 PDF → 能预览（需先开通 IMM；失败提示「预览服务暂不可用」多半是 IMM 未绑定）
- [ ] 点「下载」→ 文件名是原中文文件名

---

## 7. 日常运维

- 后端日志：`journalctl -u zyxf -f`
- 后端重启：`systemctl restart zyxf`
- 后端状态：`systemctl status zyxf`
- 前端重构：`cd /opt/zyxf/frontend && npm install && npm run build`
- 数据库备份（重要）：**注意后端启用了 WAL 模式**（`db.js` 的 `PRAGMA journal_mode = WAL`），
  只 `cp data.db` 会得到一个**空库或严重陈旧的库**——已提交事务可能全在 `data.db-wal` 里。
  本仓库开发库就是现成反例：`data.db` 仅 4 KB，而 `data.db-wal` 有 600 KB，单独拷贝后
  `SELECT COUNT(*) FROM files` 直接报 `no such table: files`。

  ```bash
  # 方式一：停服后整组拷贝（最稳）
  systemctl stop zyxf
  mkdir -p ~/db-backup-$(date +%F)
  cp -a /opt/zyxf/backend/data.db* ~/db-backup-$(date +%F)/
  systemctl start zyxf

  # 方式二：不停服，用 SQLite 在线备份（需要 sqlite3 CLI）
  sqlite3 /opt/zyxf/backend/data.db ".backup '/root/data.db.bak-$(date +%F)'"

  # 方式二备选：机器上没有 sqlite3 CLI 时，用 Node 自带的 node:sqlite
  node -e "const{DatabaseSync}=require('node:sqlite');new DatabaseSync('/opt/zyxf/backend/data.db').exec(\"VACUUM INTO '/root/data.db.bak'\")"
  ```

  建议加 crontab 每日备份，并**定期抽查**备份能打开（`sqlite3 ~/data.db.bak-xxxx '.tables'`）。

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
