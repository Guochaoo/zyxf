# 部署到阿里云轻量应用服务器（systemd + nginx）

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

### 0.1 防火墙（轻量应用服务器叫「防火墙」，对应 ECS 的「安全组」）

控制台 → 轻量应用服务器 → 实例 → **防火墙** → 添加入方向规则：

| 协议 | 端口 | 来源 | 用途 |
|---|---|---|---|
| TCP | 22 | 你的本地 IP | SSH（**不要开 0.0.0.0/0**）|
| TCP | 80 | 0.0.0.0/0 | HTTP |
| TCP | 443 | 0.0.0.0/0 | HTTPS |

> 后端默认绑定 `127.0.0.1`（`HOST` 环境变量可覆盖），因此**不依赖防火墙规则**也不会被公网直连。这同时是限流的前提：后端信任 `X-Forwarded-For` 取客户端 IP，只有不可直连时该信任才安全——否则外部可伪造 XFF 绕过所有限流（BUG-36）。防火墙仍建议不开 4000，作为纵深防御。

### 0.2 OSS CORS 加白名单

OSS 控制台 → 你的 Bucket → **数据安全 → 跨域设置** → 添加规则：

- 来源：`http://zyxf.top`、`https://zyxf.top`（开发期可加 `http://localhost:5173`）
- 允许 Methods：`GET, POST, PUT, HEAD`
- 允许 Headers：`*`
- 暴露 Headers：`ETag, x-oss-request-id, Content-Length, Content-Range`

### 0.3 域名解析

将域名 A 记录指向服务器公网 IP（例：`zyxf.top` → `47.93.224.61`）。

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
# IMM 项目名必须与 OSS 控制台「IMM 绑定」里创建的项目名一致（留空按 zyxf 处理）；
# 名字不对会返回 InvalidProjectName，而凭证没授权 imm 动作会返回 AccessDenied——两者都表现为前端「预览服务出错」。
IMM_PROJECT=
# AI 助手：三个变量齐备才启用（地址填到版本层，如 https://open.bigmodel.cn/api/paas/v4）
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
# 上游协议，留空=openai-completions（OpenAI 兼容 /chat/completions）
# 可选值：openai-completions / openai-responses（OpenAI /responses）/ anthropic-messages（Anthropic /messages）
LLM_PROTOCOL=

# 可选：用户注册邮箱验证码（阿里云邮件推送 DirectMail，三项齐备才启用）
DM_ACCESS_KEY_ID=<AccessKey ID>
DM_ACCESS_KEY_SECRET=<AccessKey Secret>
DM_ACCOUNT_NAME=<发信地址，如 no-reply@zyxf.top>
DM_FROM_ALIAS=

# 可选：下载日志保留天数（含 ip/ua，默认 400 天）
DOWNLOAD_LOG_RETENTION_DAYS=

# 可选：内容索引（知识图谱「内容视图」）——见 §6
# 本地嵌入模型目录（默认 backend/models/bge-small-zh-v1.5）
EMBED_MODEL_DIR=
# worker 空闲轮询间隔（毫秒，默认 8000）
INDEX_POLL_MS=
# 每日嵌入调用上限（默认 2000）：防一次误操作长时间占满 CPU
INDEX_DAILY_LIMIT=
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
| `generateWebofficeToken` / `refreshWebofficeToken`（IMM 在线预览，启用预览时） | `imm:GenerateWebofficeToken` + `imm:RefreshWebofficeToken` |

> 注意：后端**只签名**、不代理文件流，上传流量走浏览器直传，所以后端不需要 `oss:GetObject` 之外的读权限。
> ⚠️ **IMM 预览是另一套权限**：`GenerateWebofficeToken` 是 IMM 的 OpenAPI（`imm.<region>.aliyuncs.com`），RAM 里必须显式授权 `imm:*` 动作；只给 OSS 动作的密钥能正常下载/上传，但一调预览就返回
> `AccessDenied: You are not authorized to operate imm:GenerateWebofficeToken on the specified resources acs:imm:<region>:<账号ID>:project/<项目名>`，
> 前端只会显示「预览服务出错，暂时无法在线预览」（后端按设计只回 502 泛化文案，真实原因在 `journalctl -u zyxf`）。
> 另外**这两个动作不支持资源级授权**，策略里 `Resource` 必须写 `*`（写项目 ARN 会一直 AccessDenied）。不启用预览就删掉下面第二段 statement。

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
    },
    {
      "Effect": "Allow",
      "Action": [
        "imm:GenerateWebofficeToken",
        "imm:RefreshWebofficeToken"
      ],
      "Resource": ["*"]
    }
  ]
}
```

> 注意：RAM 的策略语句**不认 `Comment` 字段**（写了会返回 `The statement element 'Comment' is not valid`），说明只能写在文档里。

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

# 4) 之后若要给策略补动作（例如加 IMM 预览权限），改文档后发新版本并置为默认
#    （--SetAsDefault 要写成小写 true；写成 True 或不带值会报 InvalidSetAsDefault）：
aliyun ram CreatePolicyVersion --PolicyName zyxf-oss-app \
  --PolicyDocument "$(cat oss-policy.json)" --SetAsDefault true --region cn-beijing
```

验证：用新密钥访问**其他** bucket 应返回 `AccessDenied`（越权被拒），访问目标 bucket 正常——两者都满足才算最小权限生效。

> ⚠️ **轮换密钥后必须同步服务器上的 `.env`**（`/opt/zyxf/.env`）并 `systemctl restart zyxf`。只改控制台/本地 `.env` 而漏掉服务器时，旧密钥一旦被删除，OSS 会回 `InvalidAccessKeyId`——症状是**上传（PostObject 签名）、下载（签名直链）、在线预览（IMM）全线失效**，而接口本身照常返回 URL（签名是本地计算、不校验），前端只看到「下载失败 / 预览服务出错」。自查：`curl -sS "$(curl -s 'https://<域名>/api/files/<id>/url' | jq -r .url)" | head -3`，看是否 `InvalidAccessKeyId`。

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

> **图片与图标是预处理的产物，不在构建里现做**。`frontend/public/images/*.webp`、`favicon.png`、
> `apple-touch-icon.png` 由 [`frontend/scripts/optimize-assets.py`](../frontend/scripts/optimize-assets.py)
> 生成（需要 `pillow`），已经提交进仓库，所以正常部署**不需要**跑它。只有替换了原图才需要：
>
> ```bash
> pip install pillow
> python frontend/scripts/optimize-assets.py   # 在仓库根目录执行
> ```
>
> 脚本把案例图缩到 1200px 宽并转 **WebP**（原来是 2134×1600 的原图，四张合计 1.17 MB → 358 KB），
> 图标缩到 64×64（favicon，107 KB → 6.8 KB）与 180×180（apple-touch-icon）。
> ⚠️ **不要试图用 `pyftsubset` 子集化 `OPPO Sans 4.0.ttf`**：该字体授权第 2.2 条明文禁止修改字体
> 或其任何组件，而子集化即属修改（详见 `docs/ISSUES.md` BUG-99）。要减小字体只能**换一款允许
> 修改的字体**（如 Noto Sans SC / HarmonyOS Sans）再子集化。

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

#### 若站点由宝塔面板托管（当前生产就是这种）

宝塔的站点模板（`/www/server/panel/vhost/nginx/<域名>.conf`）**不会**生成 SPA 回退，`/api` 反代由它 include 的 `proxy/<域名>/*.conf` 里的 `location ^~ /api` 提供。踩过的坑（BUG-97、BUG-100）：

> ⚠️ **`frontend/nginx.conf` 只是模板，面板不会读它。** 生产实际生效的是本节的这些文件；只改仓库那份，线上不会有任何变化——BUG-78 的 CSP 修复、以及 `location /assets/` 的缓存头就是这样「改了但从未上线」的。为便于同步，仓库另存了一份**可直接落到面板**的完整版本：[`frontend/nginx.bt-rewrite.conf`](../frontend/nginx.bt-rewrite.conf)（内容 = 下面这些 location 的合集）。

- **刷新任何前端路由都是 404**（`/folder/6`、`/dashboard`、`/about`、`/settings`）。原因就是缺 `location / { try_files $uri $uri/ /index.html; }`：这些路径在 `dist/` 里没有对应文件，必须交给 `index.html`。**别改 vhost 本体**（面板保存设置时会重写它），把这段写进面板的「**伪静态**」，即：

  ```bash
  # 面板：网站 → 设置 → 伪静态；等价于直接写这个文件
  # 完整内容（含下面的缓存 / 安全头 / 资源 404）见 frontend/nginx.bt-rewrite.conf
  F=/www/server/panel/vhost/rewrite/zyxf.top.conf
  cp /opt/zyxf/frontend/nginx.bt-rewrite.conf "$F"
  /www/server/nginx/sbin/nginx -t && /www/server/nginx/sbin/nginx -s reload
  ```

- **静态资源必须有 `Cache-Control`**（BUG-100）。宝塔默认对 `/assets/`、`/fonts/`、`/favicon.png` **一个缓存头都不下发**，浏览器于是退回「10% × (Date − Last-Modified)」的启发式缓存：带 hash 的构建产物无法长缓存，21.7 MB 的字体每次冷启动都要重新协商。必须补两类 location：
  - `location /assets/`（**文件名带内容 hash**）→ `Cache-Control: public, max-age=31536000, immutable` + `try_files $uri =404`；
  - `location ~* \.(?:ttf|otf|woff2?|png|jpe?g|webp|gif|svg|ico)$`（**文件名无 hash**）→ `max-age=604800`。⚠️ `/fonts/`、`/images/` 不在 `/assets/` 覆盖范围内，少了这条正则，字体与图片依然没有缓存头。
- **安全头必须逐 location 重复声明**。`add_header` **不会被子级 `location` 继承**，任何自己写了 `add_header` 的 location 都会屏蔽 server 级的 HSTS。所以上面每个 location 都要把 `Strict-Transport-Security` / `X-Content-Type-Options` / `Referrer-Policy` / CSP 再写一遍。
- **`index.html` 必须 `Cache-Control: no-cache`**（BUG-100）。它没有内容 hash，而缓存里的旧 HTML 会引用构建后**已被删除**的 chunk 文件名；那次请求会落到 SPA 回退拿到 HTML，浏览器按 `type="module"` 解析失败 → **整页白屏**。这是发版后最容易复现的线上事故。
- **不存在的 `/assets/*` 必须回 404**，不能回落到 `index.html`。回 200 + `text/html` 同样会让模块脚本因 MIME 不符而拒绝执行。
- **CSP 先以 `Content-Security-Policy-Report-Only` 上线**（仓库 `frontend/nginx.conf` 与 `nginx.bt-rewrite.conf` 现在都是 Report-Only）。⚠️ `script-src` **必须放行 `https://g.alicdn.com`**：`OfficeViewer.jsx` 会从那里注入 WPS WebOffice SDK，该脚本随后再 `appendChild` 加载同目录的 `wps.js`——漏了这条，**在线预览会整块失效**。用真实浏览器把预览 / 上传 / 图谱 / AI 对话都点一遍、确认控制台无违规后，再把每处 `-Report-Only` 去掉（每个文件里有 4 处，缺一处那一类路径就没有策略）。
- **`X-Forwarded-For` 必须覆盖而不是追加**。宝塔的 `proxy/<域名>/*.conf` 默认写的是 `$proxy_add_x_forwarded_for`（追加），而 `backend/src/index.js` 的 `app.set('trust proxy', 1)` 明确要求 nginx 用 `$remote_addr` 覆盖，否则客户端自带的 XFF 会一并传进后端，限流按伪造 IP 计数（BUG-36 的前提被破坏）。改成：

  ```bash
  sed -i 's/\$proxy_add_x_forwarded_for/\$remote_addr/' \
    /www/server/panel/vhost/nginx/proxy/zyxf.top/*.conf
  ```

- 宝塔的 nginx **不是 systemd 服务**（`systemctl reload nginx` 会报 `nginx.service is not active`），reload 用 `/www/server/nginx/sbin/nginx -s reload`；配置测试用 `/www/server/nginx/sbin/nginx -t`（路径 `/www/server/nginx/conf/nginx.conf`）。
- `location /` 不会吃掉 API：`^~ /api` 是最长前缀匹配，优先级高于 `location /`；上面的正则 location 优先级高于 `location /`、低于 `^~ /api`，因此也不影响 SPA 深链。改完顺手验一下 `/api/health` 仍是 JSON、`curl -sI https://<域名>/folder/1` 是 200、`curl -sI https://<域名>/assets/nope.js` 是 404。

---

## 5. HTTPS（Let's Encrypt）

用 certbot 直接申请（不经过宝塔）：

```bash
apt install -y certbot python3-certbot-nginx   # 或 yum install certbot python3-certbot-nginx
certbot --nginx -d zyxf.top
```

certbot 会自动改写上面的 nginx 配置加入 443 与证书，并配置续期（`certbot renew` 由系统 timer 自动跑）。之后用 `https://zyxf.top` 访问。

> 前提：域名已解析到服务器公网 IP，80/443 端口开放（Let's Encrypt 验证与续期都依赖）。

---

## 6. 内容索引（知识图谱「内容视图」）

知识图谱默认按**内容**聚类：后台 worker 把资料正文抽出来、用本地模型算成向量，再按向量相似度连线成簇。这一步**可选**——模型缺失时会退化成「只抽正文不出向量」，图谱的内容视图给出提示、可一键切到目录视图，其他功能不受影响。

### 6.1 下载嵌入模型（约 23 MB，不进仓库）

`backend/models/` 已在 `.gitignore` 里。模型用 [Xenova/bge-small-zh-v1.5](https://huggingface.co/Xenova/bge-small-zh-v1.5) 的量化版（512 维中文嵌入）：

```bash
cd /opt/zyxf/backend
mkdir -p models/bge-small-zh-v1.5 && cd models/bge-small-zh-v1.5
BASE=https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/main
curl -fL -o model_quantized.onnx   $BASE/onnx/model_quantized.onnx   # 22.9 MB
curl -fL -o tokenizer.json         $BASE/tokenizer.json
curl -fL -o tokenizer_config.json  $BASE/tokenizer_config.json
curl -fL -o config.json            $BASE/config.json
sudo chown -R www:www /opt/zyxf/backend/models   # 与 2.1 节同一口径
```

> ⚠️ 模型目录必须对服务用户可读，否则 `embed.js` 的 `isEmbeddingEnabled()` 会返回 false：进程不报错，只是永远不出向量（`/api/index/status` 的 `embedding.enabled` 会是 false）。

### 6.2 依赖体积

`onnxruntime-node` 的 npm 包里带**全平台**原生库（含 CUDA/DirectML），装完 `node_modules` 约 **282 MB**；运行只用得上其中 `win32/x64` 或 `linux/x64` 那一个（几十 MB）。这是为了避开「下载 vs 本地编译」的不确定性而接受的代价；不想要这么大的部署体积，可以只抽正文（不装模型、不删依赖也能跑，只是内容视图不可用）。

### 6.3 建立索引

首次部署后库里已有资料，需要跑一次全量索引：

```bash
# 方式一：管理员账号重置密码拿 token 后调用（重建接口要求管理员）
TOKEN=$(curl -s -X POST https://zyxf.top/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"'"$ADMIN_USER"'","password":"'"$ADMIN_PASSWORD"'"}' | jq -r .token)
curl -s -X POST https://zyxf.top/api/index/rebuild -H "authorization: Bearer $TOKEN" | jq

# 方式二：在服务器上直接入队（不经过 HTTP）
cd /opt/zyxf/backend && node -e "
const { enqueueAll } = await import('./src/indexPipeline.js');
console.log('queued', enqueueAll());
" --input-type=module
```

之后**新增资料无需手动操作**：上传接口与 `/api/sync` 都会自动入队。

### 6.4 内容分类（图谱「内容视图」的组织方式）

图谱内容档按 `学科分类 → 内容细分 → 文件` 组织：大类是顶层学科目录，细分是该学科目录内按内容向量 k-means 的结果，细分名字由 LLM 起一次。

- **首次访问会自动现算**：k-means 很快（每学科几十 ms），但 LLM 命名要按簇各调一次（本库 84 个细分约 50 次调用 / 273 秒）。结果**按学科**写进 `taxonomy_subjects`，之后请求毫秒级返回。
- **上传新文件之后不需要任何手动操作**：文件入队 → worker 抽取嵌入 → 分类里该学科指纹变化 → 自动只重算**那一个学科**（实测 0.1 秒；其他 52 个学科继续用缓存）。图谱会显示「正在建立内容索引（N 个待处理）…」并自动刷新。
- **想提前算好**（避免第一个访问的人等）：
  ```bash
  cd /opt/zyxf/backend && node -e "
  const { getTaxonomy } = await import('./src/semanticTaxonomy.js');
  const t = await getTaxonomy({ refresh: true });
  console.log('groups', t.groups.length, 'llm', t.llm);
  " --input-type=module
  ```
- **改了算法或想让 LLM 重新命名**：管理员 `POST /api/index/taxonomy/refresh`（**全部**学科重算），或上面那条命令。
- **没配 LLM 时**（`LLM_*` 三件套缺失）不会报错：细分名回落到「文件名里本细分独有的词」，仍起不出就不显示名字，结构照常可用。

| 现象 | 原因 | 解决 |
|---|---|---|
| 细分节点没有名字 | 未配 LLM，且文件名里也找不出该细分独有的词 | 属预期；配好 `LLM_*` 后调一次 refresh 即可 |
| 分类里看不到某些文件 | 它们没进内容索引（扫描件/老格式，占本库 39%） | 属预期：这些文件在「目录视图」里按文件夹浏览 |
| 首次打开内容视图卡十几秒 | 正在现算分类 + LLM 命名 | 用上面那条命令预生成，或等首次算完（结果已缓存） |
| 新增资料后分类没变 | 分类指纹按「该学科的文件 id + 向量时间」判定；索引还没跑完时分类自然不含它 | 等索引完成（图谱会显示待处理数并自动刷新）；索引完成后仍未更新则调 refresh |

### 6.5 服务器资源需求（单核小内存机器的实测结论）

内容索引是我实测过整条链路的功能，下面是**在本机 20 核上量的数字**以及换算到弱服务器的注意点。结论：**CPU 不是瓶颈，内存才是**。

| 资源 | 实测 / 需求 | 说明 |
|---|---|---|
| **CPU** | 1 核可用 | 实测解析 151MB PDF 期间 `/api/health` 的 p50 是 **1ms**、p95 **2ms**——pdfjs 逐页 `await`、ONNX 推理在原生线程池，都不占 JS 线程。网站**不会因为索引而卡住** |
| **内存** | **≥2GB 推荐**，1GB 需配合 §6.5 的调低上限 + swap | RSS 基线约 100–150MB（含模型）；解析一个文件时峰值增量是**文件大小的 4~13 倍**（42MB→+188MB，25MB→+331MB，取决于页数/复杂度），且有高水位不立即回落 |
| 磁盘 | node_modules 371MB + 模型 23MB + 数据库（正文+向量，本库 28MB） | onnxruntime 里 **240MB 是别的平台**，可删（见下） |
| 首次全量索引 | 网络为主、CPU 次之 | 嵌入实测 29ms/文件（全库 850 个约 **25 秒** CPU），大文件解析几百 ms~几秒；主要时间花在从 OSS 下载（本库总共 **5.02GB**）。**同地域服务器会快得多**（本机是跨地域测的） |

**① 按内存设置单文件上限**（最重要的一个旋钮）：

```bash
# 1GB 内存：跳过 ≥20MB 的文件（本库约 5% 的文件不进内容视图）
INDEX_MAX_FILE_MB=20
# 2GB：默认 50 即可
INDEX_MAX_FILE_MB=50
# ≥4GB：可以覆盖那几本大部头教材
INDEX_MAX_FILE_MB=150
```

超限的文件**不下载、不解析**，只记一条 `too_large`（在 `GET /api/index/status` 的 `totals.kinds` 里可见），它们在「目录视图」里照常浏览，只是不进内容语义分类。**为什么需要这个闸门**：不设限时实测常驻内存会被那几本 100MB+ 教材推到 **872MB、峰值 976MB**；设成 50MB 后同样索引那批文件，RSS 平稳在 **104MB**。

**② 删掉用不到的平台原生库**（省 240MB 磁盘；Linux x64 服务器只需 43MB）：

```bash
cd /opt/zyxf/backend/node_modules/onnxruntime-node/bin/napi-v6
rm -rf darwin win32 linux/arm64   # 保留 linux/x64
```

**③ 加 swap**（1GB 内存建议）：`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`，并写进 `/etc/fstab`。索引偶发的内存尖峰有 swap 兜底就不会被 OOM 杀掉（真被杀也不丢进度：重启后 worker 会把 `running` 复位为 `pending` 继续）。

**④ 更省事的路线：本地预索引，只把索引数据搬到服务器**。如果你的开发机性能好、服务器弱，可以把重活放在本地做，服务器只负责服务与「新上传」的增量：

```bash
# 本地（能访问同一 OSS、已跑完全量索引）导出四张索引表
cd backend && sqlite3 data.db ".dump text_extractions file_embeddings index_jobs taxonomy_subjects" > /tmp/index-dump.sql
# 传到服务器后导入（⚠️ 只导这四张表，绝不要整库覆盖——库里还有 users/download_logs）
scp /tmp/index-dump.sql server:/tmp/
ssh server 'cd /opt/zyxf/backend && systemctl stop zyxf && sqlite3 data.db < /tmp/index-dump.sql && systemctl start zyxf'
```

导入后 `GET /api/index/status` 会显示与本地一致的覆盖率与向量数，分类缓存也是现成的，服务器**启动即用**、不需要跑首次全量索引。

### 6.6 观察进度与排错

```bash
curl -s https://zyxf.top/api/index/status | jq '{totals, usage, pending}'
curl -s https://zyxf.top/api/index/taxonomy | jq '{files, cached, llm, groups: (.groups|length)}'
# 管理员登录后还会返回失败的 20 条（含文件名与错误原因）
journalctl -u zyxf -f | grep -E '\[index\]|\[taxonomy\]'
```

| 现象 | 原因 | 解决 |
|---|---|---|
| `embedding.enabled=false` | 模型文件缺失或目录不可读 | 按 6.1 下载并 `chown www:www` |
| 索引停在某个文件、日志报「索引超时」 | 单个对象过大/上游慢（单任务上限 120s） | 正常，会重试 3 次后记 `failed` 并继续后面的文件 |
| `last_error` 是「已达当日索引配额」 | 触到 `INDEX_DAILY_LIMIT` | 次日自动继续，或临时调大该值重启 |
| 内容视图显示「索引里还没有可用资料」 | 库里可抽取的文本太少（扫描件/老格式占比高） | 属预期：扫描件需 OCR，见 `docs/ISSUES.md` |
| 重复重建时 CPU 一直高 | `force` 全量重建会重新下载解析每个文件 | 用增量重建（默认 `force=false` 只排没抽过的） |
| 后端被 OOM 杀掉（`journalctl` 里 `Killed process ... node`） | 解析大文件的内存尖峰超出可用 RAM | 调低 `INDEX_MAX_FILE_MB`（见 6.5）、加 swap；被杀不丢进度，重启会继续 |
| `totals.kinds.too_large` 有很多 | 这些文件超过了 `INDEX_MAX_FILE_MB` | 属预期；内容视图里没有它们，想覆盖就调大该值（注意同步加内存） |
| 索引很慢 / 首次要很久 | 主要时间是**从 OSS 下载**（本库共 5GB） | 服务器与 Bucket 同地域会快很多；也可走 6.5 的「本地预索引」路线 |

---

## 7. 校验清单

- [ ] 后端目录对服务用户可写（`sudo -u www test -w /opt/zyxf/backend`），`journalctl -u zyxf` 无 `SQLITE_CANTOPEN`
- [ ] `https://zyxf.top` 能看到首页
- [ ] 展开右侧菜单 → 底部账户卡右侧箭头展开菜单 → 「登录」 → 用 `.env` 账号密码能登录
- [ ] 上传一个 PDF → 不报 CORS 错
- [ ] 点击 PDF → 能预览（需先开通 IMM、把 bucket 绑到 IMM 项目、并给该 RAM 用户 `imm:GenerateWebofficeToken`；报「预览服务暂不可用」时先看 `journalctl -u zyxf` 里的真实错误码）
- [ ] 点「下载」→ 文件名是原中文文件名
- [ ] 知识图谱默认档是「内容视图」：有向量数据时显示簇图例，没有时给出可读提示（不报错、不白屏）

---

## 8. 日常运维

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

## 9. 常见坑

| 现象 | 原因 | 解决 |
|---|---|---|
| `/api/*` 502 | 后端没起 | `systemctl status zyxf`；`journalctl -u zyxf -n 50` 看启动报错 |
| 后端启动即退（无正常启动日志） | `JWT_SECRET`/`ADMIN_PASSWORD` 不合生产校验（会打印 `[index] FATAL...` 到 stderr） | 用 `openssl rand -hex 32` + 12 位强密码 |
| 上传报 CORS | OSS 跨域规则没加域名 | 回 0.2 节加 `https://zyxf.top` |
| 上传报 SignatureDoesNotMatch | 服务器时间不准 | `sudo timedatectl set-ntp true` |
| 下载/上传/预览全都不通，接口却返回 200 | **密钥已失效**：`OSS_ACCESS_KEY_ID` 指向被删除/停用的 AccessKey（轮换后漏改服务器 `.env` 最常见）。签名是本地算的、不校验，所以接口照常给 URL，真链一取就 `InvalidAccessKeyId`。改 `/opt/zyxf/.env` → `systemctl restart zyxf` |
| 预览报「预览服务暂不可用」/「预览服务出错」 | 先看真实原因：`journalctl -u zyxf --since "30 min ago" \| grep 预览服务 -A2`（后端按设计只回 502 泛化文案）。① `InvalidAccessKeyId` → 见上一行；② `AccessDenied ... imm:GenerateWebofficeToken` → 该 RAM 用户缺 IMM 动作授权，按 2.2 的第二段 statement 补授权（OSS 权限正常不代表 IMM 可用）；③ `InvalidProjectName` → `IMM_PROJECT` 与 IMM 控制台项目名不一致；④ 超时/连接失败 → 网络或 IMM 侧故障 |
| 首页白屏 / `https` 连不上 | SSL 未配或证书没生效 | 见第 5 节申请 Let's Encrypt |
| 访问命中默认站点（旧页） | 按 IP 访问，非域名 | 用域名 `zyxf.top` 访问；确认域名已解析 |
