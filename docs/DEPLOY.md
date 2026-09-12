# 部署到阿里云轻量应用服务器（systemd + nginx）

> 后端用 **systemd** 托管（`deploy/zyxf.service`），前端构建产物由 **nginx** 托管并反代 `/api`，HTTPS 用 Let's Encrypt。
> 服务器上**没有面板**：nginx、Node 24、certbot 全部是系统级安装（2026-09-12 起宝塔已彻底卸载，见 docs/ISSUES.md IMPROVE-48）。部署由 `.github/workflows/deploy.yml` 全自动完成——SSH 上服务器 `git fetch + reset --hard`（对齐 origin/main）+ 装依赖 + 构建 + `systemctl restart zyxf`；部署后健康检查（`/api/health`）失败时，workflow 会自动把服务器退回部署前的修订并重建，避免线上持续 502。

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

将域名 A 记录指向服务器公网 IP（在云控制台的实例详情里查看）。文档统一用 RFC 5737 保留段 `203.0.113.10` 作示例占位——**不要把真实 IP 写进仓库**。

---

## 1. 服务器准备

需要：

- **Nginx**（系统包，`apt install nginx`；托管前端 + 反代 `/api`）
- **Node 24**（系统包走 NodeSource：`curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt install -y nodejs`；项目使用内置 `node:sqlite`，无原生编译依赖）
- **certbot + python3-certbot-nginx**（HTTPS 证书签发与自动续期）
- **systemd**（Linux 标配，无需额外安装）

> `deploy/zyxf.service` 的 `ExecStart` 与 deploy workflow 都直接用 `/usr/bin/node`，不需要任何软链或 PATH 定制。

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

#### 4.1.1 品牌字体：npm 管理 + 构建期子集化

OPPO Sans 4.0 的**源字体不入库**，走 npm devDependency `@fontpkg/oppo-sans-4-0`；构建时由
[`frontend/scripts/build-font.mjs`](../frontend/scripts/build-font.mjs) 子集化为**两层 woff2**
（IMPROVE-52，21.69 MB → 合计 2.75 MB，`fvar` 字重轴完整保留），并生成 `src/assets/fonts/opposans.css`
（两组 `@font-face` × `OPPOSans`/`SF Mono` 别名，带 `unicode-range`；`index.css` 顶部 `@import` 引入——
⚠️ `@import` 必须是第一条语句，放在 `@tailwind` 之后会被构建期静默忽略）：

- `opposans-subset.woff2` **常用层**（约 1.53 MB）：ASCII + GB2312 符号 + 一级汉字（3,755 字）
  + 源码实际出现的全部 CJK 字——UI 文案永远命中它，随首屏加载；
- `opposans-ext.woff2` **生僻层**（约 1.35 MB）：二级汉字中不在常用层的部分，浏览器仅在页面
  真的渲染到这些字（典型是用户上传的文件名）时才按 `unicode-range` 下载。

两层产物均 gitignore，由 `predev` / `prebuild` / `pretest` 自动生成，**部署无需额外操作**：

```bash
cd /opt/zyxf/frontend && npm install && npm run build   # prebuild 会自动跑 fonts
```

- **字符集 = GB2312（6,763 汉字）+ ASCII + 常用标点 + 源码里实际出现的全部 CJK 字**（脚本自动从
  `src/` 提取并并入，实测约 980 个），合计约 8,289 个码点。子集外的字**不会变成方块**——会落到
  CSS 字体栈的下一个家族（`PingFang SC` / `Microsoft YaHei`）正常显示，只是字形风格不同。
- **子集化用 [subset-font](https://www.npmjs.com/package/subset-font)（纯 WASM harfbuzz）**，不用
  `pyftsubset`：这样部署链上**不引入 Python 依赖**，且两个新依赖都**没有 postinstall 脚本**
  （对比 BUG-102：`onnxruntime-node` 的 postinstall 联网拉原生库，直接把部署搞挂）。
- **字体授权：子集化是允许的，要遵守的是署名条款**。OPPO Sans 授权第 2 条授予的权利里明确包含
  「**embed, bundle** ... unmodified copies of OPPO Sans Fonts **with any software**」——把 CJK 字体
  嵌进 Web 页面的**技术前提就是子集化**（不可能让浏览器每次下 21 MB 全字符集），所以子集化正是行使
  这条「嵌入/捆绑」权的正常方式；条件 2）的「不得修改」针对的是**改动字形设计**（派生字体、重绘轮廓、换个名字当成自己的字体），不是「挑选要发布哪些字形」。这也是 Google Fonts / fontsource
  等所有 webfont 管线的通行做法。
  真正约束我们的是两条**署名义务**，都已落实：
  1. 条件 1）「make a prominent notice in the software」→ **首页页脚与 ICP 备案号同行有「字体 OPPO Sans」署名链接**
     （`BrowsePage.jsx`，文案走 `footer.font` 字典）。**不要**把协议文本丢在一个没人引用的 URL 上——
     那样既不算「显著」，也只是部署里的死重。
  2. 条件 4）「retain the copyright notice and this Agreement」→ 协议原文保留在
     [`frontend/public/licenses/OPPO-Sans-4.0-License.txt`](../frontend/public/licenses/OPPO-Sans-4.0-License.txt)
     （线上 `/licenses/OPPO-Sans-4.0-License.txt`），且上面那个链接指向它。
  另外为稳妥起见，源字体在 `node_modules` 里**保持原样**、我们只分发派生的 web 子集，因此也不涉及
  条件 3）「不得以 stand-alone 形式再分发字体」。
  > ⚠️ **npm 包里不含这份协议**（`@fontpkg/oppo-sans-4-0` 只有 ttf / package.json / README），
  > 所以仓库里这份是项目唯一的授权文本，**不要删**；页脚署名链接也不要摘。
- 手动重新生成（改了字符集、换了字体版本，或想强制刷新）：`cd frontend && npm run fonts`
  —— 脚本按 mtime 自动跳过未变更的情况，加 `FORCE` 语义时删掉产物再跑即可。

### 4.2 nginx 站点配置

在 `/etc/nginx/conf.d/zyxf.conf` 写一份配置，把 `/` 静态托管与 `/api` 反代分开（**当前生产就是这份**，由仓库 [frontend/nginx.conf](../frontend/nginx.conf) 逐字落地，证书路径指向 `/etc/letsencrypt/live/zyxf.top/`）：

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

> 完整模板就是仓库的 [frontend/nginx.conf](../frontend/nginx.conf)——生产 `/etc/nginx/conf.d/zyxf.conf` 与它逐字一致。**改配置的正确姿势**：改仓库模板 → 覆盖服务器上的 `/etc/nginx/conf.d/zyxf.conf` → `nginx -t && systemctl reload nginx`。证书由 certbot 签发到 `/etc/letsencrypt/live/zyxf.top/`（见第 5 节），`certbot.timer` 每天自动续期。

#### 线上踩过的坑（已固化在模板里，改配置时别弄丢）

- **刷新任何前端路由都是 404**（`/folder/6`、`/dashboard`、`/about`、`/settings`）：缺 `location / { try_files $uri $uri/ /index.html; }`（BUG-97）。dist/ 里没有这些文件，必须交给 index.html 由前端路由接管。
- **静态资源必须有 `Cache-Control`**（BUG-100），否则浏览器退回「10% × (Date − Last-Modified)」启发式缓存，字体每次冷启动重新协商：
  - `location ^~ /assets/`（文件名带内容 hash，含 `opposans-subset-<hash>.woff2`）→ `max-age=31536000, immutable` + `try_files $uri =404`；
  - `location ~* \.(?:ttf|otf|woff2?|png|jpe?g|webp|gif|svg|ico)$`（文件名无 hash，如 `/favicon.png`、`/images/*.webp`）→ `max-age=604800`。
  - ⚠️ **`^~` 不能省**：nginx 的**正则 location 优先级高于普通前缀 location**，而扩展名正则也含 `woff2`——写成普通前缀时 `/assets/*.woff2` 会被正则抢走、只拿到 7 天（线上实测确认过）。
- **`add_header` 不会被子级 location 继承**：任何自己写了 `add_header` 的 location 都会屏蔽 server 级的 HSTS / 安全头，所以模板里每个 location 都把 `Strict-Transport-Security` / `X-Content-Type-Options` / `Referrer-Policy` / CSP 重复声明了一遍。
- **`index.html` 必须 `Cache-Control: no-cache`**：它没有内容 hash，缓存里的旧 HTML 引用构建后**已被删除**的 chunk 文件名，那次请求落到 SPA 回退拿到 HTML，浏览器按 `type="module"` 解析失败 → **整页白屏**（BUG-100，发版后最容易复现的事故）。
- **不存在的 `/assets/*` 必须回 404**：回 200 + `text/html` 同样会让模块脚本因 MIME 不符拒绝执行。
- **CSP 先以 `Content-Security-Policy-Report-Only` 上线**（模板现为 Report-Only）。⚠️ `script-src` **必须放行 `https://g.alicdn.com`**：`OfficeViewer.jsx` 会从那里注入 WPS WebOffice SDK，该脚本随后再加载同目录的 `wps.js`——漏了这条，**在线预览会整块失效**。真实浏览器把预览 / 上传 / 图谱 / AI 对话全点一遍、控制台无违规后，再去掉每处 `-Report-Only`（模板里共 4 处）。
- **`/api` 反代必须覆写 `X-Forwarded-For` 为 `$remote_addr`**（不能 append 透传客户端带来的值）：后端按 trust proxy 取 XFF 做限流，可直连时伪造 XFF 能绕过所有限流（BUG-36）。这条成立的前提是后端只监听 `127.0.0.1`、无法被公网直连。
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

## 6. 校验清单

- [ ] 后端目录对服务用户可写（`sudo -u www test -w /opt/zyxf/backend`），`journalctl -u zyxf` 无 `SQLITE_CANTOPEN`
- [ ] `https://zyxf.top` 能看到首页
- [ ] 展开右侧菜单 → 底部账户卡右侧箭头展开菜单 → 「登录」 → 用 `.env` 账号密码能登录
- [ ] 上传一个 PDF → 不报 CORS 错
- [ ] 点击 PDF → 能预览（需先开通 IMM、把 bucket 绑到 IMM 项目、并给该 RAM 用户 `imm:GenerateWebofficeToken`；报「预览服务暂不可用」时先看 `journalctl -u zyxf` 里的真实错误码）
- [ ] 点「下载」→ 文件名是原中文文件名

---

## 7. 日常运维

- 后端日志：`journalctl -u zyxf -f`
- 后端重启：`systemctl restart zyxf`
- 后端状态：`systemctl status zyxf`
- nginx 配置变更：改仓库 [frontend/nginx.conf](../frontend/nginx.conf) → 覆盖服务器 `/etc/nginx/conf.d/zyxf.conf` → `nginx -t && systemctl reload nginx`
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
| 下载/上传/预览全都不通，接口却返回 200 | **密钥已失效**：`OSS_ACCESS_KEY_ID` 指向被删除/停用的 AccessKey（轮换后漏改服务器 `.env` 最常见）。签名是本地算的、不校验，所以接口照常给 URL，真链一取就 `InvalidAccessKeyId`。改 `/opt/zyxf/.env` → `systemctl restart zyxf` |
| 预览报「预览服务暂不可用」/「预览服务出错」 | 先看真实原因：`journalctl -u zyxf --since "30 min ago" \| grep 预览服务 -A2`（后端按设计只回 502 泛化文案）。① `InvalidAccessKeyId` → 见上一行；② `AccessDenied ... imm:GenerateWebofficeToken` → 该 RAM 用户缺 IMM 动作授权，按 2.2 的第二段 statement 补授权（OSS 权限正常不代表 IMM 可用）；③ `InvalidProjectName` → `IMM_PROJECT` 与 IMM 控制台项目名不一致；④ 超时/连接失败 → 网络或 IMM 侧故障 |
| 首页白屏 / `https` 连不上 | SSL 未配或证书没生效 | 见第 5 节申请 Let's Encrypt |
| 访问命中默认站点（旧页） | 按 IP 访问，非域名 | 用域名 `zyxf.top` 访问；确认域名已解析 |
