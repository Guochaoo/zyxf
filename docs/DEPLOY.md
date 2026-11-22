# 部署到阿里云轻量应用服务器（systemd + nginx）

> 后端用 **systemd** 托管（`deploy/zyxf.service`），前端构建产物由 **nginx** 托管并反代 `/api`，HTTPS 用 **ZeroSSL**（certbot + nginx 插件，HTTP-01，见第 5 节）。
> 服务器上**没有面板**：nginx、Node 24、certbot 全部是系统级安装（2026-09-12 起宝塔已彻底卸载）。
>
> 部署由 `.github/workflows/deploy.yml` 全自动完成，**构建与运行分家**：
>
> - **构建在 GitHub runner 上**（`ubuntu-latest`）：`npm ci` + `vite build` + 产物断言，然后 `rsync` 到服务器的 `frontend/.incoming/`。生产机只有 2C2G，而 vite + WASM 字体子集化是整条链的内存峰值——原先要在部署脚本里补 2 GB swap 兜 OOM，而它真正要做的只是把 5.7 MB 的 `dist` 派发出去。
>   ⚠️ **跨境链路很慢**：实测 runner → 服务器约 **11 KB/s**（243 ms RTT、丢包受限），整包 4.4 MB 要 6 分钟。所以只传**内容真的变了**的文件（`rsync --checksum`，服务端先拿上一份 `dist` 做硬链接种子）：实测改一个 chunk 只传 **1.3 KB**。另外 `frontend/` 完全没改动的发布不构建也不传输，全程约 30 秒。
> - **部署在服务器上**（[deploy/deploy.sh](../deploy/deploy.sh)，仓库内、可单独 review、可在服务器直接重跑）：对齐 `origin/main` → 后端 `npm ci` → 校验 `.incoming` 后两次 `rename` 换上去（旧的留作 `dist.prev`）→ 安装 systemd 单元（含每日备份定时器）→ 重启后端并健康检查 → 同步并校验 nginx 配置。
>
> **流程中任何一步失败**（装依赖、产物校验、健康检查、nginx 校验）都会触发回滚：脚本挂了 `EXIT` trap，退回部署前的修订、把 `dist.prev` 换回 `dist`、重装依赖并重启。这条覆盖是 BUG-102 的两个教训——① 回滚原先只挂在健康检查上，`npm install` 挂掉时服务器留在「新代码 + 缺依赖」的中间态（旧进程还在跑所以看起来正常，下次重启才起不来）；② 健康检查失败时前端 `dist/` 已被新产物覆盖，不回滚就会持续 502。

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
| TCP | 22 | `0.0.0.0/0` | SSH（**见下方说明，这里开不了白名单**）|
| TCP | 80 | 0.0.0.0/0 | HTTP（certbot 做 HTTP-01 验证也依赖它）|
| TCP | 443 | 0.0.0.0/0 | HTTPS |

> **为什么 22 是 `0.0.0.0/0` 而不是「你的本地 IP」**：部署由 GitHub Actions 发起，runner 的出口 IP 每次都在变（官方只发布周更的网段列表，跟着它维护规则不现实）。所以这里无法收窄，安全边界只能落在 sshd 上。生产机的实际配置（2026-11 实测）：
>
> ```
> permitrootlogin without-password   # 只允许密钥，root 不接受密码
> passwordauthentication no
> kbdinteractiveauthentication no
> permitemptypasswords no
> maxauthtries 6
> ```
>
> 近 3 天 `journalctl -u ssh | grep -c "Failed password"` = 0（没有密码爆破可试）。**改这几项等于把机器开到公网上，动之前先确认 `authorized_keys` 里还有你的公钥**；没装 fail2ban，也暂时不需要装——没有密码可爆破时它只是降噪。

> 后端默认绑定 `127.0.0.1`（`HOST` 环境变量可覆盖），因此**不依赖防火墙规则**也不会被公网直连。这同时是限流的前提：后端信任 `X-Forwarded-For` 取客户端 IP，只有不可直连时该信任才安全——否则外部可伪造 XFF 绕过所有限流（BUG-36）。防火墙仍建议不开 4000，作为纵深防御。

### 0.2 OSS CORS 加白名单

OSS 控制台 → 你的 Bucket → **数据安全 → 跨域设置** → 添加规则：

- 来源：`http://zyxf.top`、`https://zyxf.top`（开发期可加 `http://localhost:5173`）
- 允许 Methods：`GET, POST, PUT, HEAD`
- 允许 Headers：`*`
- 暴露 Headers：`ETag, x-oss-request-id, Content-Length, Content-Range`

### 0.3 OSS TLS 版本设置

OSS 控制台 → 你的 Bucket → **数据安全 → TLS版本设置** → 开启，勾 **TLS 1.2 + TLS 1.3**，加密算法套件保持「全部（默认）」。

不开的话 OSS 默认允许 TLS 1.0 / 1.1 / 1.2，**且不支持 TLS 1.3**：既留着两个已废弃协议，又用不上 1.3 的握手性能。开完约 1 分钟生效，实测 1.0/1.1 会收到 `tlsv1 alert protocol version`（alert 70）。

用 CLI 等价设置（`aliyun` 内置新版 ossutil）：

```bash
aliyun ossutil api put-bucket-https-config --bucket <bucket> --region cn-beijing \
  --https-configuration '{"TLS":{"Enable":"true","TLSVersion":["TLSv1.2","TLSv1.3"]}}'
# 回滚：把 --https-configuration 换成 '{"TLS":{"Enable":"false"}}'
```

⚠️ 只支持 TLS 1.0 的老旧 WebView 会连不上（校园里偶有老安卓机）；开了之后要确认「上传 / 下载 / PDF 预览」三条链路都正常。

### 0.4 域名解析

将域名 A 记录指向服务器公网 IP（在云控制台的实例详情里查看）。文档统一用 RFC 5737 保留段 `203.0.113.10` 作示例占位——**不要把真实 IP 写进仓库**。

生产 `zyxf.top` 区里**只有 12 条记录**，每条都有明确归属（2026-11-22 实测，`aliyun alidns DescribeDomainRecords --DomainName zyxf.top`）。这个区是全站唯一的入口配置，改任何一条之前先对一遍这张表：

| RR | 类型 | 值 | 干什么用 | 删了会怎样 |
|---|---|---|---|---|
| `@` | CNAME | `zyxf.top.a1.initrr.com` | 主站入口经 ESA（§4.2.5） | 全站打不开 |
| `origin` | A | 服务器公网 IP | **源站主机名**，ESA 记录只能填 CNAME（不能填 IP） | ESA 回源失败（522） |
| `www` | CNAME | `zyxf.top` | 主站别名，nginx 里 301 到裸域 | `www.zyxf.top` 打不开 |
| `_dmarc` | TXT | `v=DMARC1;p=none;rua=…` | 收 DMARC 报告（不拦截） | 伪造邮件无报告可查 |
| `dzhz` | CNAME | `dzhz.zyxf.top.a1.initrr.com` | 岱宗盒子全部入口：页面 + 排行榜 + APK/JSON（§4.2.7） | 盒子打不开、App 更新检查失败 |
| `_acme-challenge.dzhz` | CNAME | `dzhz.zyxf.top.<siteId>.dcv.aliyun-esa.com` | ESA **托管 DCV**，证书自动续期 | 证书到期后 dzhz 全线 TLS 失败 |
| `oss` | CNAME | `oss.zyxf.top.a1.initrr.com` | **资源库文件下载域**：ESA 边缘 → 私有桶 `xjtu-zyxf`（§4.2.6） | 预览/下载全挂（后端返回的 URL 指向它） |
| `_esaauth` | TXT | `verify_…` | ESA 站点归属验证 | 站点被判未验证/离线 |
| `mail` | MX | `mx01.dm.aliyun.com` | 阿里云 DirectMail 收信 | 验证码邮件收不到回执 |
| `mail` | TXT | `v=spf1 include:spf1.dm.aliyun.com -all` | 发信身份（SPF） | 邮件进垃圾箱 |
| `aliyun-cn-hangzhou._domainkey.mail` | TXT | `v=DKIM1; …` | 发信签名（DKIM） | 同上 |
| `_dmarc.mail` | TXT | `v=DMARC1;p=none;rua=…` | DMARC 报告 | 退信策略失效（暂不拦） |

> - **发信身份是 `system@mail.zyxf.top`**（`DM_ACCOUNT_NAME`），SPF/DKIM/DMARC 都挂在 `mail` 子域，与主站接入 ESA 无关。
> - ⚠️ **裸域原来那条 `@ TXT "v=spf1 -all"` 已被删除**：apex 改成 CNAME 后不能与任何其它记录共存（DNS 规范），所以裸域的防伪造能力没了。`_dmarc` 仍能收到报告，`mail` 子域的 SPF/DKIM 不受影响。要恢复裸域 SPF 就得放弃 apex CNAME（即放弃主站走 ESA）。
> - **`oss` 是唯一一条指向 OSS 桶的记录**（2026-11-22 加，§4.2.6）：`oss.zyxf.top` CNAME → ESA → 私有桶 `xjtu-zyxf`，边缘用 STS 临时令牌回源。bucket 上仍然**没有绑定任何自定义域名**（`aliyun ossutil api list-cname --bucket <bucket>` 返回空）——也就是说 OSS 侧那条「绑定域名」的路没走，走的是 ESA 的「源站类型 OSS + 私有访问」。后果有两面：下载不再走 OSS 外网流出（¥0.5/GB）而是 CDN 回源（¥0.15/GB）；同时因缓存是 **bypass**，删除/改名即时生效、不需要刷新缓存。
> - **`oss.zyxf.top` 上的 `/.well-known/acme-challenge/*` 由 ESA 边缘直接应答**（证书 HTTP DCV），不需要往桶里放验证文件。
> - 原来还有一条 `verification` TXT（`verify_257ecc…`），是早期 CDN 域名归属验证留下的孤儿。2026-11-21 已删除：CDN 域名数为 0、DCDN 未开通、OSS 无自定义域名、ESA 用的是另一套 `_esaauth`，没有任何在用产品认领它；删除后主站、dzhz 下载、发信均正常。

---

## 1. 服务器准备

需要：

- **Nginx**（系统包，`apt install nginx`；托管前端 + 反代 `/api`）
- **Node 24**（系统包走 NodeSource：`curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt install -y nodejs`；项目使用内置 `node:sqlite`，无原生编译依赖）。若要在服务器上跑后端测试，需 **≥ 24.15**（`mock.module({ exports })` 的下界，见 issue #68）；NodeSource 的 `setup_24.x` 给的是 24.21+，满足要求
- **certbot + python3-certbot-nginx**（HTTPS 证书签发与自动续期）
- **systemd**（Linux 标配，无需额外安装）

> `deploy/zyxf.service` 的 `ExecStart` 与 deploy workflow 都直接用 `/usr/bin/node`，不需要任何软链或 PATH 定制。

> **swap：生产机上不再需要，但已有的别删。** 前端构建（`prebuild` 的 WASM harfbuzz 字体子集化 + vite/rolldown）是整条链唯一的内存峰值，而它现在跑在 GitHub runner 上（见文首），服务器只解包 5.7 MB 的产物。2026-11 之前的 `deploy.yml` 会自动补 2 GB swap，这段逻辑已随构建一起下线；机器上原有的 1 GB swap 保留，当作 `npm ci` 或异常情况下的兜底。
>
> 如果将来又要在服务器上手工构建（不推荐），先确认 `free -m` 有 ≥ 1 GB 可用并挂上 swap：
>
> ```bash
> fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
> echo '/swapfile none swap sw 0 0' >> /etc/fstab      # 重启后仍然生效
> swapon --show                                        # 确认
> ```

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
# 上传直传的 host（PostObject 用）；留空 = <bucket>.<region>.aliyuncs.com
OSS_ENDPOINT=
# 下载 URL 的前缀（ESA 边缘，见 §4.2.6）。生产必填，漏配拒绝启动
OSS_PUBLIC_BASE=https://oss.zyxf.top

# 可选：AI 助手
# AI 助手：三个变量齐备才启用（地址填到版本层，如 https://open.bigmodel.cn/api/paas/v4）
# ⚠️ 模型必须支持 function calling：AI 搜索第一轮固定带 tools，不支持的模型会被上游
#    拒绝（400 "Function call is not supported"），前端只显示「AI 服务暂时不可用」。
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

# 可选：文件夹剪枝的年龄闸门（天，默认 7，设 0 = 不设限）
FOLDER_PRUNE_MIN_AGE_DAYS=
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
| 下载 | **不需要**：签名由 ESA 边缘用 STS 临时令牌完成，后端不再读对象 |
| `putEmptyOssObject`（文件夹占位符） | `oss:PutObject` |
| 前端直传（PostObject） | `oss:PutObject` |
| `copyOssObject`（改名/移动） | `oss:CopyObject` + `oss:PutObject` |
| `deleteOssObjectIfExists`（删除） | `oss:DeleteObject` |

> 注意：后端**只签名**、不代理文件流，上传流量走浏览器直传；下载则由 ESA 边缘用 STS 回源签，后端完全不参与读对象。所以 `oss:GetObject` 已于 2026-11-22 从策略里删掉（`zyxf-oss-app` v3）；实测 `list` / `put` / `delete` 正常、`get` 返回 `AccessDenied`——AK 就算泄露也拿不走文件。
> 在线预览已下线（原 IMM WebOffice），RAM 策略里**不需要任何 `imm:*` 动作**；日后重做预览时再补授权。

自定义策略（把 bucket 名替换成你自己的；`acs:oss:*:*:<bucket>/*` 用来覆盖对象级操作）：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "oss:ListObjects",
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

# 4) 之后若要给策略补动作，改文档后发新版本并置为默认
#    （--SetAsDefault 要写成小写 true；写成 True 或不带值会报 InvalidSetAsDefault）：
aliyun ram CreatePolicyVersion --PolicyName zyxf-oss-app \
  --PolicyDocument "$(cat oss-policy.json)" --SetAsDefault true --region cn-beijing
```

验证：用新密钥访问**其他** bucket 应返回 `AccessDenied`（越权被拒），访问目标 bucket 正常——两者都满足才算最小权限生效。

> ⚠️ **轮换密钥后必须同步服务器上的 `.env`**（`/opt/zyxf/.env`）并 `systemctl restart zyxf`。只改控制台/本地 `.env` 而漏掉服务器时，旧密钥一旦被删除，OSS 会回 `InvalidAccessKeyId`——症状是**上传（PostObject 签名）失效**，而接口本身照常返回 URL（签名是本地计算、不校验），前端只看到「上传失败」。下载走 ESA（§4.2.6）时用的是边缘自己的 STS，**不受这把 AK 影响**——AK 只管上传，所以症状只会出现在「点上传」上。自查：`curl -sS "$(curl -s 'https://<域名>/api/files/<id>/url' | jq -r .url)" | head -3`，看是否 `InvalidAccessKeyId`。

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

删除文件**不会**再连带删除它的下载记录（外键 `ON DELETE SET NULL`，见 issue #87）：行里保留 `file_name` / `oss_key` 快照，只为「累计下载」与热力图计数，文件名不再关联到现存文件。要彻底抹掉某段历史只能靠上面的保留期，或手工 `DELETE FROM download_logs`。

### 2.5 文件夹剪枝（刷新时回收死目录）

点「刷新」触发的是 `POST /api/sync`：以 OSS 为准对账（补新对象、删失联记录），并回收**死文件夹**——子树里既没有文件、也没有 OSS 占位对象（`<路径>/` 空对象）的目录。

- **界面里新建的文件夹永远是「活」的**：创建时后端会写占位对象，所以空目录不会被刷新吃掉；
- 只回收**已存在超过 `FOLDER_PRUNE_MIN_AGE_DAYS` 天**（默认 7，设 0 不设限）的死目录，给历史遗留（建库时没写占位对象）的目录留出处理窗口；
- 被剪的目录会随响应返回（`removed.folder_paths`，最多 20 条）；**同步响应里的 `removed.files` 只统计失联文件行**，与目录剪枝互不影响；
- 判死只看「文件 + 占位对象 + 活着的子节点」，所以被剪的子树里**必然没有文件行**，`files.folder_id` 的级联删除不会波及任何文件。

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

> **单元加固与日志上限（issue #93，2026-11）**：`zyxf.service` 与 `zyxf-backup.service` 都带
> `NoNewPrivileges` / `PrivateTmp` / `ProtectSystem=strict` / `ProtectHome` +
> `ReadWritePaths=/opt/zyxf/backend`；主服务另有 `StartLimitIntervalSec=60` + `StartLimitBurst=5`，
> 配置错误时 5 次失败即停，不会无限重启刷日志。
> ⚠️ 改这两个 unit 时**别删 `ReadWritePaths`**：`ProtectSystem=strict` 下没有它，SQLite 写不了
> `data.db`，症状是服务启动即退、日志里只有 `SQLITE_CANTOPEN`。
>
> journald 的容量上限由部署写入 `/etc/systemd/journald.conf.d/zyxf.conf`（`SystemMaxUse=200M`）——
> 40 GB 系统盘上无上限的日志增长会在撑满后让 SQLite 写入失败。

---

## 4. 前端：构建 + nginx

### 4.1 构建（在 CI 里，不在服务器上）

生产构建**不再发生在服务器上**：`.github/workflows/deploy.yml` 在 GitHub runner 上跑

```bash
cd frontend && npm ci && npm run build   # 产物断言后 rsync 到服务器 .incoming/
```

再由 `deploy/deploy.sh` 校验 `/opt/zyxf/frontend/.incoming`、两次 `rename` 换成 `dist`（上一份留作 `dist.prev` 供回滚）。所以服务器上**不需要也不再有** `frontend/node_modules`。

传输是**增量**的：CI 先在服务器上 `cp -al dist .incoming`（硬链接种子，秒级、不占空间），再用 `rsync --checksum --delete` 覆盖——内容没变的文件（约 2.75 MB 的字体 woff2、图片等）按校验和跳过，只有变化的 chunk 才过网。实测：改一个 chunk 只传 1,327 字节。`--stats` 打在 Actions 日志里，每次发布都能看到实际传输量。

`frontend/` 没有改动的发布**不会重建也不会传输**：workflow 用 `git diff --name-only HEAD^ HEAD -- frontend`（排除 `nginx.conf` / `security-headers.conf` 这两个服务器侧配置）判定，没有 `.incoming` 时 `deploy.sh` 直接沿用服务器上现有的 `dist`。

本地要验证构建结果时照常跑（构建期会改写 `src/assets/fonts/opposans.css` 的子集，属正常现象）：

```bash
cd frontend && npm ci && npm run build && npm run preview
```

> 用 `npm ci` 而不是 `npm install`：按 lockfile 精确安装，lockfile 与 `package.json` 不一致时会**直接失败**——那是想尽早看到的信号，而不是让 npm 悄悄改写 lockfile。

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

两层产物均 gitignore，由 `predev` / `prebuild` / `pretest` 自动生成，**部署无需额外操作**（CI 的 `npm run build` 会自动触发 `prebuild`）：

```bash
cd frontend && npm ci && npm run build   # prebuild 会自动跑 fonts
```

> ⚠️ 子集化会**就地改写** `src/assets/fonts/opposans.css`（仓库里那份是上一次构建的产物）。所以构建完工作区会显示它被修改，`git checkout --` 回去即可；服务器上也一样——构建搬到 CI 之后服务器不再被这个副作用弄脏。

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

在 `/etc/nginx/conf.d/zyxf.conf` 写一份配置，把 `/` 静态托管与 `/api` 反代分开。**这份配置不再手工维护**：部署时 workflow 会把仓库 [frontend/nginx.conf](../frontend/nginx.conf) 拷到该路径，`nginx -t` 通过且用 `--resolve` 本地取到首页后才 `reload`，任一环节失败就还原上一份（备份存为同目录下的 `zyxf.conf.bak`）并让部署失败。证书路径指向 `/etc/letsencrypt/live/zyxf.top/`。

> 下面是**简版模板**（仅 `listen 80`，用于起步验证）。完整版（含 80→443 跳转、`/assets/` 长缓存、Let's Encrypt 证书路径）见仓库里的 [frontend/nginx.conf](../frontend/nginx.conf)，证书申请见第 5 节。

```nginx
server {
    listen 80;
    server_name zyxf.top;

    root /opt/zyxf/frontend/dist;
    index index.html;

    # 安全响应头不在这里手写：统一放在 frontend/security-headers.conf（部署拷到
    # /etc/nginx/snippets/zyxf-headers.conf），server 级与每个自写 add_header 的
    # location 都 include 它。原因：nginx 的 add_header 在子级一旦出现就不再继承父级，
    # 以前手抄 4 遍，HSTS 漏抄了半年没人发现（2026-11 修）。

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

> 完整模板就是仓库的 [frontend/nginx.conf](../frontend/nginx.conf)。**改配置的正确姿势**：只改仓库这份文件，走正常发布即可（部署会自动覆盖 + 校验 + reload；校验失败会自动还原，线上不会停在坏配置上）。要在服务器上临时验证可以手工跑 `cp /opt/zyxf/frontend/nginx.conf /etc/nginx/conf.d/zyxf.conf && nginx -t && systemctl reload nginx`，但**不要把它当成常态**——2026-11 之前正是靠手工 scp，才出现「文档写着已下发 HSTS、线上其实没有」的漂移。证书由 certbot 签发到 `/etc/letsencrypt/live/zyxf.top/`（见第 5 节），`certbot.timer` 每天自动续期。
>
> 模板里两处容易踩的性能配置（2026-11 修）：
> - `listen 443 ssl http2;` —— HTTP/2 必须写在 `listen` 上。Ubuntu 22.04 自带 nginx 1.18.0，没有 1.25.1 才引入的 `http2 on;` 指令，只写 `listen 443 ssl;` 会让整站退回 HTTP/1.1（每域 6 个并发连接）。
> - `gzip on` + `gzip_types` —— nginx 默认的 `gzip_types` **只有 `text/html`**，所以 HTML 是压过的、`.js/.css` 一直明文外传（实测主 bundle 172,825 字节无 `content-encoding`）。`/api/` 里单独写了 `gzip off`：SSE 走 gzip 会把增量输出攒进缓冲区，反而拉高首字延迟。
>
> **限流（2026-11 加）**：`zyxf_req` 20 r/s（burst 60，nodelay）、`zyxf_api` 6 r/s（burst 20）、单 IP 并发连接 24，超限一律 429。burst 给这么大是因为首屏本身就要拉十几个静态资源——限流只压「持续高频」这一种形态，不误伤正常打开页面。注意它只保护**源站**：文件下载走 `oss.zyxf.top`（ESA 边缘 → 私有桶，见 §4.2.6），根本不经过 nginx。挡下载频率的是 `/api/files/:id/url` 上的 `downloadLimiter*`（每 IP 60 次/分、240 次/时），所以**前端不能自己拼下载路径**，否则限流和下载记账会一起失效。

#### 4.2.1 `/games/`：仓库外的独立服务

`frontend/nginx.conf` 里有一块 `location ^~ /games/`，反代到 `127.0.0.1:4100` 的 **游戏排行榜后端**——它服务于**岱宗盒子（`dzhz.zyxf.top`，即 `xjtu-toolbox` 项目）**，是仓库外的独立服务（systemd: `xjtu-games`，代码在 `/opt/xjtu-games`）。这块原先只存在于生产服务器上——按「整文件覆盖」的姿势改配置会把它删掉，排行榜与提交分数直接挂掉（issue #86，2026-11 收进模板）。

> ⚠️ 探活时注意：`/games/` 根路径**本身没有路由**，会返回该服务自己的 JSON 404（`{"error":"没有这个接口"}`）。这是正常现象，不代表反代挂了——真正的接口挂在 `/games/` 之下。反代是否生效看的是响应来自谁：nginx 若没有这条 location 会走 SPA 回落返回 200 HTML。

- 它的 `X-Forwarded-For` 用 `$proxy_add_x_forwarded_for`（**追加**），与主站 `/api/` 的 `$remote_addr`（**覆盖**，BUG-36 要求）不同。改成覆盖前先确认 `xjtu-games` 自己的 trust proxy 取法，别顺手套用主站写法。
- `client_max_body_size 4k` 是那个服务的约定，不随主站的 `10m` 调整。
- 现在部署会整份覆盖 `zyxf.conf`，因此这块**只能改仓库模板**；只改服务器上的会被下次发布冲掉。

#### 4.2.2 `dzhz.zyxf.top` 的静态加速（ESA，2026-11 迁入）

`dzhz.zyxf.top` **不经过本仓库的 nginx**——它是岱宗盒子（xjtu-toolbox）的发布桶 `xjtu-toolbox-dzhz`（OSS 北京，**私有**）对外分发 APK / 静态资源的域名，2026-11 从「阿里云 CDN（`dzhz.zyxf.top.w.kunlunaq.com`）」迁到了**阿里云 ESA 免费版**。

| 项 | 值 |
|---|---|
| ESA 站点 | `zyxf.top`（SiteId `190304393599084`），套餐 `entranceplan`（免费版，**0 元**） |
| 加速记录 | `dzhz.zyxf.top` **CNAME → `dzhz.zyxf.top.a1.initrr.com`** |
| 回源 | 源站类型 **OSS**、回源 HOST **跟随源站域名**、鉴权 **私有访问（STS 临时令牌）**。2026-11-22 起 `/xjtu-toolbox/*` **之外**的请求由回源规则改送 nginx（页面与排行榜），见 §4.2.7 |
| 证书 | ESA 免费证书（Let's Encrypt，3 个月），托管 DCV：`_acme-challenge.dzhz` CNAME → `dzhz.zyxf.top.190304393599084.dcv.aliyun-esa.com` |
| 回滚 | 旧 CDN 域名已于 2026-11-21 删除，**回滚不再是改一行 CNAME**：需在 CDN 里重建域名（源站 OSS + 私有回源授权 + 证书），再把 CNAME 指向新分配的加速域名 |

几条必须记住的约束：

- **bucket 不能改公共读。** 改成公共访问后任何人拿到 `xjtu-toolbox-dzhz.oss-cn-beijing.aliyuncs.com` 就能绕过 ESA 直连下载，按 OSS 外网流出（忙时 ¥0.5/GB）记在账上——这正是加这一层要防的事。回源鉴权只能在控制台走「私有访问」，API 的 `AuthConf` 字段结构没有公开文档。
- **回源 HOST 必须「跟随源站域名」。** 跟随请求 HOST 会把 Host 变成 `dzhz.zyxf.top`，OSS 侧对不上 bucket 直接 403。
- **免费版的「安全防护」不是空白**（2026-11-22 实测，此前按套餐字段 `waf_off` 写成「不含 WAF」，是错的）：`GetSiteWafSettings` 能看到已生效的基础防护——HTTP 安全等级 `low`、带宽滥用保护 `captcha`、Bots 基础监控 `monitor`；`ListWafPhases` 里托管规则集状态为 `on`。**但源站防护仍不可用**：`CreateOriginProtection` 返回 `FunctionQuotaCheckFailed`（控制台菜单存在，点进去多半引导升级）。边缘函数、自定义 WAF 规则的额度另算，没逐个验证。站点级限流仍然靠 nginx（见 §4.2 末尾）。
- **子域不能单独作为站点**（`SubSiteUnavailable`，只有企业版支持），所以站点建在根域 `zyxf.top` 上，`dzhz` 是它下面的一条记录。
- 免费版套餐参数里 `PlanTraffic: 0`，官方口径是「流量和请求数不计费」，但**限速阈值没有公开**；若大文件被明显限速要重新评估是否值得留在这条链路上。
- 旧 CDN 域名 `dzhz.zyxf.top` 已于 2026-11-21 删除（issue #96），所以「切回去」不再是一条 DNS 的事——DELETED 之后回滚只能重建：CDN 建域名 → 源站选 OSS bucket → 开私有回源授权 → 配证书 → 改 CNAME。
- **探活必须用真实 key**：桶里没有 `apk` 这个对象，只有 `xjtu-toolbox/apk/latest/app-release.apk`（站点里用的就是这个完整路径，`content.html` 的下载按钮）。ESA 只做加速、**不重写路径**，所以 `/apk` 回源就是 `NoSuchKey` 404、`/` 是 `AccessDenied` 403——这两个状态都正常，不代表加速坏了。验证回源（绕过边缘缓存）用带查询串的请求：

  ```bash
  curl -sI -H 'Cache-Control: no-cache' \
    'https://dzhz.zyxf.top/xjtu-toolbox/apk/latest/app-release.apk?probe=$(date +%s)' | head -5
  # 期望 200 + content-type: application/vnd.android.package-archive + Server: ESA
  ```

#### 4.2.3 刷新缓存 / 预热缓存：只有一个场景真用得上

两者都是**边缘**操作，对主站 `zyxf.top` 基本无效——nginx 给 HTML 发 `cache-control: no-cache`，边缘对它是 `DYNAMIC`（不回缓存），改了文件刷新一次页面就生效；资源库下载域 `oss.zyxf.top` 是整站 bypass（§4.2.6），刷新对它同样没有意义。

对 `dzhz.zyxf.top` 有意义的只有一条：**`latest` 这个别名是被覆盖写的**。

- 发版时 CI 把新包写到 `xjtu-toolbox/apk/latest/app-release.apk`（**同一个 key，内容变了**），边缘仍按旧缓存条目分发；
- 2026-11-21 实测该对象 `age: 3868`——边缘缓存了约 1 小时；而它自身还带 `Cache-Control: no-cache`（ESA 并没有遵守这个响应头，实际缓存策略与对象元数据不一致）；
- 后果：发版后最长 1 小时内，一部分用户点「下载」拿到的是**旧包**，且这种错误在服务器侧完全看不出来。

| 操作 | 值不值得 | 说明 |
|---|---|---|
| 发版后刷新 `…/apk/latest/app-release.apk` 与 `…/stable.json` | **值得**，应急回滚时尤其必要 | 见下面的命令；也可在控制台点「刷新缓存」 |
| 预热新包 | **基本没用** | 回源是同区域的 OSS 北京，冷回源只多一次内网读；受众集中、PoP 少，收益抵不过配额与配置成本 |
| 用「记得手动刷新」当长期方案 | **不建议** | 依赖人肉记性，回滚时最容易漏 |

命令行刷新（字段形状踩过坑：`Content` 是**对象**，file 类型要把 URL 放进 `Files` 数组；写成 `--Content.1` 之类会被 API 以 `InvalidContent` 拒绝）：

```bash
# 发版流水线里调用，传完 OSS 立刻执行
ESA_SITE_ID=<站点 ID> deploy/purge-esa-cache.sh \
  https://dzhz.zyxf.top/xjtu-toolbox/apk/latest/app-release.apk \
  https://dzhz.zyxf.top/xjtu-toolbox/stable.json
# → 已提交刷新任务 TaskId=…

# 等价的手工命令
aliyun esa PurgeCaches --SiteId <站点 ID> --Type file \
  --Content '{"Files":["https://dzhz.zyxf.top/xjtu-toolbox/stable.json"]}'

# 查最近的任务（没有按 TaskId 过滤的参数，只能按类型/状态/时间窗）
aliyun esa DescribePurgeTasks --SiteId <站点 ID> --Type file --PageSize 5
```

免费版文件刷新额度 **1000 次**（`aliyun esa GetPurgeQuota --SiteId <id> --Type file`），一次提交多个 URL 仍算 1 个任务。刷新生效的验证方式是看响应头里的 `Age` 消失（回源重新取）：

```bash
curl -sI https://dzhz.zyxf.top/xjtu-toolbox/stable.json | grep -i '^age'   # 刷新后应无 Age
```

**更根本的修法（推荐）**：不要覆盖写。新包发布到 `apk/<version>/app-release.apk` 这类**不可变路径**，`stable.json` 里带上版本与路径（现在这个文件已经带 `version` 字段），客户端与下载按钮只读 `stable.json` 决定去哪拿。这样 APK 永不失效、可以放心长缓存，需要刷新的只剩一个小 JSON——把它的边缘 TTL 压到 30–60 秒，连刷新都不必点。

> 这处改动落在 xjtu-toolbox 的发版流水线（不在本仓库），但它决定了这条链路要不要人肉运维。

#### 4.2.4 ESA 能看到哪些数据 / 有哪些优化开关

命令行能拉到的（`aliyun esa …`，免登控制台）：

```bash
# 时序：Traffic(字节) / Requests / RequestTraffic / PageView
aliyun esa DescribeSiteTimeSeriesData --SiteId <id> \
  --StartTime <ISO> --EndTime <ISO> --Interval 3600 \
  --Fields '[{"FieldName":"Traffic","Dimension":["ALL"]}]'

# Top：按路径 / 国家 / 缓存状态 / 状态码 / 协议 / TLS 版本…
aliyun esa DescribeSiteTopData --SiteId <id> --Limit 10 \
  --StartTime <ISO> --EndTime <ISO> \
  --Fields '[{"FieldName":"Traffic","Dimension":["ClientRequestPath"]}]'
```

2026-11-21 首次接入当天的真实数据（含我自己的压测下载）：

| 维度 | 数据 |
|---|---|
| 流量 / 请求 | **85.4 MB / 136 次**（`app-release.apk` 占 76.6 MB，preview 包 8.5 MB，JSON 合计 <0.2 MB） |
| 来源国家 | CN **99.97%**（US 17 KB、FR 3.9 KB…） |
| 缓存 | HIT 81 / BYPASS 23 / MISS 20 / NONE 10 → **命中率约 60%** |
| 状态码 | 200×101、403×22（`/` 目录访问）、404×9（`/apk` 等不存在的 key）、522×4（回源超时）、206×3、304×1 |
| 协议 / TLS | 请求全是 HTTP/1.1（压测用的 Node `fetch`）、TLSv1.3×115、TLSv1.2×3 |

⚠️ **没有「时延 / 速度」这类指标**。数据分析里只有流量、请求数、请求大小、PV 四个指标 + 一堆维度（缓存状态、状态码、国家、路径、协议…）。想知道「用户下载慢不慢」，ESA 直接给不出来——只能自己从外部测（例如在 CI 里对 APK 拉一小段计时）。这是免费版分析能力的边界，不是配置没开。

优化开关的实际状态：

| 项 | 状态 | 值不值 |
|---|---|---|
| 压缩规则（Brotli / Gzip / Zstd） | **已开 Brotli + Gzip**（2026-11 加，ConfigId `531359596607488`） | 对 APK 无意义（已压缩）；JSON 小，收益接近 0。开着是为了将来主站挂 ESA 时不用再配 |
| 网络优化（`ListNetworkOptimizations`） | 1 条全局配置：上传上限 300 MB、WebSocket off | 默认值即可 |
| 跨境优化（`GetCrossBorderOptimization`） | **未配置**（返回空） | 受众 99.97% 在境内，没有价值 |
| 刷新 / 预热 | 文件刷新额度 **1000**，预热接口也在 | 见 §4.2.3：刷新有用，预热没用 |
| HTTP/3 / QUIC | API 里没有对应开关 | 免费版没有 |

> 流量结构很说明问题：**90% 的流量是 APK 下载**。所以这条链路上真正影响「速度」的是大文件分发，而不是 HTML/JS 压缩——把它放在含免费流量的 ESA 后面（而不是 OSS 直连按 ¥0.5/GB 计费）才是省钱的那一步。

#### 4.2.5 主站 `zyxf.top` 也在 ESA 后面（2026-11-22 迁入）

主站从「A 记录直连服务器」改成「CNAME → ESA → `origin.zyxf.top` → 服务器」。目的：边缘统一处理 HTTP/2 与 TLS、源站能看到真实客户端 IP。

| 项 | 值 |
|---|---|
| ESA 记录 | `zyxf.top` → CNAME `origin.zyxf.top`（源类型 `Domain`、HostPolicy `follow_hostname`、Proxied） |
| 边缘 CNAME | `zyxf.top.a1.initrr.com` |
| 源站主机名 | `origin.zyxf.top` A → 服务器公网 IP。**ESA 记录里不能直接写 IP**：CNAME 接入的站点只接受 CNAME 记录（`InvalidParameter.CnameSiteRecordUnsupport`），所以先给服务器起一个主机名 |
| 边缘证书 | ESA 免费证书（Let's Encrypt，`ApplyCertificate --Type lets_encrypt`）。DCV 是 **HTTP** 类型：把挑战文件放进源站 `/var/www/letsencrypt/.well-known/acme-challenge/`，几分钟后自动验证通过，不需要加 DNS 记录 |
| 源站证书 | 仍是 certbot 那张（ZeroSSL），现在只用于 **ESA → 源站** 这一段 |

> **`www` 也要单独加一条 ESA 记录和一张证书**（踩过）：DNS 里 `www` 是 CNAME 到 `zyxf.top`，
> 解析到 ESA 之后，ESA 需要为 `www.zyxf.top` 也有记录才能回源——只配了 apex 的话，
> `http://www.zyxf.top` 会返回 **530**（ESA 找不到源站），而 apex 完全正常。
> `ApplyCertificate --Domains "www.zyxf.top"` 单独签一张，DCV 同样是 HTTP 挑战文件。

**翻 DNS 之前必须先做的两件事**（不做就会自伤）：

1. **真实客户端 IP**：ESA「托管转换 → 添加真实客户端 IP 标头」注入 `ali-real-client-ip`
   （`UpdateManagedTransform --AddRealClientIpHeader on`），nginx 用
   `set_real_ip_from 0.0.0.0/0` + `real_ip_header ali-real-client-ip` 换回真实 IP。
   不做的话 `$binary_remote_addr` 是节点 IP，`limit_conn 24` 会把**整个 ESA 节点**当成一个
   客户端来限流，正常用户直接 429。
   ⚠️ 免费版没有「源站防护」（`CreateOriginProtection` → `FunctionQuotaCheckFailed`），
   拿不到回源网段列表，所以 `set_real_ip_from` 只能写 `0.0.0.0/0`：**直连源站并自带该标头
   的人可以伪装来源、绕过按 IP 的限流**。这是接 CDN 的固有代价，要堵死得把防火墙收窄到
   ESA 回源网段（付费版或手工维护 IP 列表）。
2. **缓存规则**：`/api/`、`/.well-known/`、`/games/` 一律 **bypass**
   （`CreateCacheRule --BypassCache bypass_all --Rule "(http.request.uri.path contains \"/api/\" or …)"`）。
   不设的话 API 响应和证书挑战会被边缘缓存——API 缓存会串用户数据，证书挑战被缓存会让
   续期偶发失败。

**DNS 切换（含回滚）**：

```bash
# 切过去：CNAME 不能与其它记录共存，所以必须先删掉 @ A 与 @ TXT
aliyun alidns DeleteDomainRecord --RecordId <@ A 的 RecordId>
aliyun alidns DeleteDomainRecord --RecordId <@ TXT 的 RecordId>      # 见下方「代价」
aliyun alidns AddDomainRecord --DomainName zyxf.top --RR @ --Type CNAME \
  --Value zyxf.top.a1.initrr.com --TTL 600

# 回滚：删掉 @ CNAME，再把 A 与 TXT 加回去（TTL 600，最长 10 分钟内完成迁移）
```

> ⚠️ **代价：apex 不能同时有 CNAME 和其它记录**，所以裸域那条 `@ TXT "v=spf1 -all"` 被删了。
> `_dmarc` 与 `mail` 子域那套 SPF/DKIM/DMARC 不受影响（发信身份一直是 `system@mail.zyxf.top`），
> 但裸域因此可以被人伪造发信。这是「把 apex 挂 CDN」的固有取舍。

**验证**（本地 DNS 可能还缓存着旧 A 记录，以服务器或 `+trace` 为准）：

```bash
curl -sI https://zyxf.top/ | grep -iE '^(server|http/)'      # 期望 HTTP/2 + server: ESA
curl -s  https://zyxf.top/api/health                          # 期望 JSON，且每次时间戳都变（没被缓存）
echo | openssl s_client -servername zyxf.top -connect zyxf.top:443 2>/dev/null |
  openssl x509 -noout -issuer -enddate                        # 期望 Let's Encrypt（ESA 边缘证书）
tail -3 /var/log/nginx/access.log    # 第一列应是真实客户端 IP，不是 ESA 节点 IP
```

#### 4.2.6 资源库下载域 `oss.zyxf.top`（2026-11-22 加）

文件预览/下载原本是「后端签一条 30 分钟的 OSS 直链」：`<bucket>.oss-cn-beijing.aliyuncs.com/zyxf/…?Expires&Signature`。现在改成**干净路径 + 边缘回源鉴权**：URL 是 `https://oss.zyxf.top/zyxf/…`，没有签名、也没有有效期。

| 项 | 值 |
|---|---|
| ESA 记录 | `oss.zyxf.top` → CNAME `xjtu-zyxf.oss-cn-beijing.aliyuncs.com`；源类型 **OSS**、回源 HOST **跟随源站域名**、鉴权 **私有访问 `private_same_account`**（STS 临时令牌）、Proxied |
| 边缘 CNAME | `oss.zyxf.top.a1.initrr.com` |
| 证书 | ESA 免费证书（`ApplyCertificate --Domains oss.zyxf.top --Type lets_encrypt`）。DCV 是 HTTP 挑战，**由 ESA 边缘直接应答**，`/.well-known/acme-challenge/*` 不需要往桶里放文件（与 dzhz 那条 `_acme-challenge.dzhz` 的托管 DCV 是两种路子） |
| 缓存 | **bypass**：`CreateCacheRule --RuleName oss-bypass --BypassCache bypass_all --Rule '(http.host eq "oss.zyxf.top")'`（ConfigId `531463577600000`） |
| 响应头 | `CreateHttpResponseHeaderModificationRule`（ConfigId `531463466448896`）：`X-Robots-Tag: noindex`、`Content-Disposition: attachment`、`X-Content-Type-Options: nosniff` |
| CORS | **不在边缘加**：桶自带 `AllowedOrigin: *` 的跨域规则，ESA 转发的 `Origin` 会让 OSS 自己回 `Access-Control-Allow-Origin`。边缘再 `add` 一遍会变成重复头，浏览器直接判 CORS 失败 |
| 代码开关 | `OSS_PUBLIC_BASE=https://oss.zyxf.top`（`backend/src/oss.js` 的 `fileUrl()`）。**生产必填**：漏配时 `index.js` 直接拒绝启动，不再回退签名直链 |
| 回滚 | 签名直链的代码已删除（2026-11-22），所以回滚 = `git revert` 该提交 + 重新部署（约 1 分钟）；DNS/ESA 记录留不留都不影响 |

为什么这么做、以及代价：

- **ESA 记录不等于 DNS 记录**（踩过）：`aliyun esa CreateRecord` 只是边缘侧的配置，**不会**在 Aliyun DNS 里自动加解析。必须再补一条：

  ```bash
  aliyun alidns AddDomainRecord --DomainName zyxf.top --RR oss --Type CNAME \
    --Value oss.zyxf.top.a1.initrr.com --TTL 600
  ```

  少了这一步，公网解析不到 `oss.zyxf.top`，证书申请会永远卡在 `Applying` / `pending validation`（HTTP DCV 的验证方也解析不到这个域）。`dzhz` 当初同理。
- **省钱**：OSS 侧从「外网流出 ¥0.5/GB」变成「CDN 回源 ¥0.15/GB」。实测 11 月 1–22 日资源库外网流出 5.94 GB（¥2.97），同样流量走这条链路降到 ¥0.9 左右。
- **为什么 bypass 不缓存**：签名取消后 URL 永久有效，边缘若还有缓存，**删了文件、改了名字，旧路径在 TTL 内仍能下到**；要立刻干净就得在每次写操作后调 `PurgeCaches`（后端没有 ESA 凭证，只能靠外部脚本）。bypass 让删除即时生效（`X-Site-Cache-Status: DYNAMIC`），代价是每次都回源——收益本来就来自计费口径，命中率影响很小。
- **CORS 也要求 bypass**：一旦开缓存，先被缓存的「不带 Origin 的版本」会缺 `Access-Control-Allow-Origin`，预览的 `fetch` 会偶发失败。
- **前端必须继续走 `/api/files/:id/url`**：限流（每 IP 60 次/分、240 次/时）和下载记账都挂在那条接口上，前端自己拼 `oss.zyxf.top/<key>` 会同时绕开两者。
- **附件头由边缘统一加**：配了下载域名后 `forceDownload` 不再影响 URL；app 的所有预览/下载本来就是 `fetch → blob`（PDF、TXT 也一样），所以 `attachment` 不影响任何页面。
- **OSS 桶自带的「防盗链」在这条链路上不起作用**（2026-11-22 实测，别再往桶上加）：给桶配 `RefererList` 白名单后——
  - 直连 OSS 的签名请求：外站 Referer → **403**、本域 Referer → 200、空 Referer → 200（`AllowEmptyReferer: true`），说明 OSS 侧规则本身是生效的；
  - 同样的三个请求经 `oss.zyxf.top`（ESA → 桶）：外站 Referer 也是 **200**。

  也就是 ESA 回源没有把客户端的 Referer 带到 OSS（或 OSS 对 CDN 回源请求不校验），桶级白名单对「经 ESA 的下载」等于没开，留着只会造成「已经防住外链」的错觉。测试用的临时白名单已撤销（桶上仍是 `AllowEmptyReferer: true` + 空列表）。
- **所以防外链只能在边缘做**：免费版没有独立的 Referer 配置（`--help-search Referer` 为空），只能用 **WAF 自定义规则**（`CreateWafRule --Phase http_custom`，当前自定义规则 0 条、额度未验证），例如把 `oss.zyxf.top` 上 `referer` 不含 `zyxf.top` 的请求拒掉。直下的前提是知道 key，而 key 形如 `zyxf/<目录>/<文件名>`——可猜。这是「去掉签名」的代价，接受它是因为资源库本来就对游客开放（`/api/files/:id/url` 没有 `requireAuth`）。
- **路径会带一层前缀**：`oss.zyxf.top/zyxf/<key>`。去掉它得加一条边缘改写（`CreateRewriteUrlRule`），目前不做——多一跳配置就多一个会坏的地方。

验证（`x-oss-cdn-auth: success` 是 STS 回源成功的标记）：

```bash
curl -sD- -o /dev/null https://oss.zyxf.top/zyxf/ACM/DP.pptx |
  grep -iE '^(http/|server|content-disposition|x-oss-cdn-auth|x-site-cache-status|x-robots-tag)'
# 期望 200 + Server: ESA + content-disposition: attachment + x-oss-cdn-auth: success + DYNAMIC
```

#### 4.2.7 岱宗盒子收拢到独立域名 `dzhz.zyxf.top`（2026-11-22）

此前盒子的东西散在三处：页面在主站 SPA 的 `/dzhz*` 路由里、排行榜在主站 nginx 的 `/games/` 反代里、APK 与 JSON 在 `dzhz.zyxf.top`（ESA → OSS 私有桶）。现在**全部收在这个域名下**，主站只在 `/dzhz*` 上留 301。

硬约束：**ESA 一条 CNAME 记录只能配一个源站**，而两类请求要的源站相反：

| 路径 | 源站必须是 | 原因 |
|---|---|---|
| `/`、`/legal`、`/license`、`/games/*` | nginx（本机） | 页面是 SPA 产物；排行榜是 `127.0.0.1:4100` 的独立进程 |
| `/xjtu-toolbox/*`（APK、`stable.json`、`bulletin.json`） | OSS 私有桶 | 85 MB 的包走 2C2G 的机器会被带宽卡死；OSS 侧按 CDN 回源计费（¥0.15/GB） |

折中办法是 **ESA 回源规则按路径分流**（免费版可用，2026-11-22 实测）：

```
dzhz.zyxf.top ──ESA──┬─ 不含 /xjtu-toolbox/  ──► origin.zyxf.top:443（本机 nginx）
                     └─ /xjtu-toolbox/*      ──► 默认源站：OSS 私有桶（STS 回源，不动）
```

```bash
aliyun esa CreateOriginRule --SiteId <id> \
  --RuleName 'dzhz-pages-to-nginx' --RuleEnable on --Sequence 1 \
  --Rule '(http.host eq "dzhz.zyxf.top" and not http.request.uri.path contains "/xjtu-toolbox/")' \
  --DnsRecord 'origin.zyxf.top' --OriginHost 'dzhz.zyxf.top' --OriginScheme https
```

nginx 侧是 `frontend/nginx.conf` 末尾的白名单 vhost：只放行 `/`、`/legal`、`/license`、`/dzhz/…`、`/assets/`、`/dzhz-assets/`、`/games/`、`/api/`，其余 301 回主站——避免这个域名变成整站副本。

前端仍是**同一个 bundle**：`App.jsx` 用 `isDzhzHost()`（`frontend/src/dzhz.js`）判断，盒子域名上根路径渲染 `DzhzPage`、`/legal` 渲染协议页、`/license` 渲染开源协议，版式走「整页落地页」（不挂左栏 / 搜索 / 知识图谱 / 全站菜单）。

主站侧的收尾：

- `/dzhz` → 301 `https://dzhz.zyxf.top/`；`/dzhz/…` → 301 `https://dzhz.zyxf.top$request_uri`。`/dzhz-assets/` 的前缀是 `/dzhz-`，不会被这两条吃掉。
- **主站的 `/games/` 反代保留**：旧版 App（≤ 6.0.2）硬编码了 `https://zyxf.top/games`，删了排行榜就断；新版（App 仓库 `dev`）已改指 `dzhz.zyxf.top/games`。
- 源站证书用 `certbot --expand` 把 `dzhz.zyxf.top` 加进了 SAN（webroot 验证，挑战请求经回源规则到 nginx）；否则 ESA → 源站这段校验不过，只能把回源规则的「源站证书校验」关掉。

验证：

```bash
curl -sD- -o /dev/null https://dzhz.zyxf.top/ | grep -iE 'HTTP/|server|content-type'
# 期望 200 + Server: ESA + text/html（落地页）

curl -sD- -o /dev/null https://dzhz.zyxf.top/xjtu-toolbox/apk/latest/app-release.apk |
  grep -iE 'HTTP/|x-oss-cdn-auth'
# 期望 200 + x-oss-cdn-auth: success —— 证明它仍从 OSS 出，没被打到 nginx

curl -s -o /dev/null -w '%{http_code}\n' https://dzhz.zyxf.top/games/health   # 排行榜
curl -sI https://zyxf.top/dzhz | grep -i location                              # 301 到 dzhz
```

回滚：删掉那条回源规则 → `dzhz.zyxf.top` 恢复成纯 OSS 源（APK/JSON 全程没动过），页面回主站；同时撤掉 nginx 里主站的两条 301 与末尾的 vhost。
#### 线上踩过的坑（已固化在模板里，改配置时别弄丢）

- **刷新任何前端路由都是 404**（`/folder/6`、`/dashboard`、`/about`、`/settings`）：缺 `location / { try_files $uri $uri/ /index.html; }`（BUG-97）。dist/ 里没有这些文件，必须交给 index.html 由前端路由接管。
- **直接访问 `/dzhz` 是 301 → `/dzhz/` 然后 403**：图片原先放在 `public/dzhz/`，构建后是 `dist/dzhz/` 目录；`try_files $uri $uri/` 命中目录、里面没有 `index.html`，nginx 返回 403。资源已迁到 `public/dzhz-assets/`（URL `/dzhz-assets/…`），**不要再把资源放回 `public/dzhz/`**。服务器上残留旧的 `dist/dzhz/` 时，重新构建（Vite 会清空 dist）或手动删掉。
- **静态资源必须有 `Cache-Control`**（BUG-100），否则浏览器退回「10% × (Date − Last-Modified)」启发式缓存，字体每次冷启动重新协商：
  - `location ^~ /assets/`（文件名带内容 hash，含 `opposans-subset-<hash>.woff2`）→ `max-age=31536000, immutable` + `try_files $uri =404`；
  - `location ~* \.(?:ttf|otf|woff2?|png|jpe?g|webp|gif|svg|ico)$`（文件名无 hash，如 `/favicon.png`、`/images/*.webp`）→ `max-age=604800`。
  - ⚠️ **`^~` 不能省**：nginx 的**正则 location 优先级高于普通前缀 location**，而扩展名正则也含 `woff2`——写成普通前缀时 `/assets/*.woff2` 会被正则抢走、只拿到 7 天（线上实测确认过）。
- **`add_header` 不会被子级 location 继承**：任何自己写了 `add_header` 的 location 都会屏蔽 server 级那一组。所以安全头（CSP / HSTS / `X-Content-Type-Options` / `Referrer-Policy` / `Permissions-Policy` / `COOP`）统一放在 [frontend/security-headers.conf](../frontend/security-headers.conf)，每个这类 location `include /etc/nginx/snippets/zyxf-headers.conf;` 一次——**加头或改策略只改那一个文件**，不要再往 location 里手抄。
- **限流 zone 的 IP 来源是真的还是假的**：`limit_req_zone $binary_remote_addr` 成立的前提是「nginx 直接面向客户端」。主站 2026-11-22 起挂在 ESA 后面（§4.2.5），所以模板里常驻了 `set_real_ip_from 0.0.0.0/0` + `real_ip_header ali-real-client-ip`；**删掉它，`$binary_remote_addr` 就变回节点 IP，全站会被当成同一个来源限流（等于自伤）**。换到别家 CDN 时同理：
  ```nginx
  set_real_ip_from <CDN/ESA 回源网段>;
  real_ip_header X-Forwarded-For;
  real_ip_recursive on;
  ```
  并确认对方回源时确实带 `X-Forwarded-For`。ESA 的源站防护 / 回源 IP 网段可在控制台查到。
- **`index.html` 必须 `Cache-Control: no-cache`**：它没有内容 hash，缓存里的旧 HTML 引用构建后**已被删除**的 chunk 文件名，那次请求落到 SPA 回退拿到 HTML，浏览器按 `type="module"` 解析失败 → **整页白屏**（BUG-100，发版后最容易复现的事故）。前端另有一层兜底：路由出口的 `ErrorBoundary` 会给出可恢复界面，且识别到「懒 chunk 加载失败」时把「重试」直接接成整页重载——`React.lazy` 会把失败的 import 缓存在模块级 payload 上，原地重试不可能恢复（issue #63）。
- **不存在的 `/assets/*` 必须回 404**：回 200 + `text/html` 同样会让模块脚本因 MIME 不符拒绝执行。
- **CSP 已转为强制模式**（2026-11，原为 Report-Only）：切换前做过静态审计——构建产物里 `eval(` / `new Function(` 均 0 命中、无内联 `<script>`、无 Web Worker，因此 `script-src 'self'` 不需要 `unsafe-eval`。⚠️ `frame-src` 必须含 `blob:`：PDF 预览是 `fetch` 成 blob URL 后塞进 iframe（见 `Preview/PdfViewer.jsx`），少了它生产环境 PDF 会整块白屏。日后若再接入外链预览 SDK（如旧版 WebOffice），要把它的域名同时加进该文件的 `script-src` / `style-src` / `frame-src`。若某个功能被拦，最快的回退是把 snippet 第一行改回 `Content-Security-Policy-Report-Only`（只改一处，因为头已经收敛到单个文件）。
- **`/api` 反代必须覆写 `X-Forwarded-For` 为 `$remote_addr`**（不能 append 透传客户端带来的值）：后端按 trust proxy 取 XFF 做限流，可直连时伪造 XFF 能绕过所有限流（BUG-36）。这条成立的前提是后端只监听 `127.0.0.1`、无法被公网直连。
- **`X-Forwarded-For` 必须覆盖而不是追加**。宝塔的 `proxy/<域名>/*.conf` 默认写的是 `$proxy_add_x_forwarded_for`（追加），而 `backend/src/index.js` 的 `app.set('trust proxy', 1)` 明确要求 nginx 用 `$remote_addr` 覆盖，否则客户端自带的 XFF 会一并传进后端，限流按伪造 IP 计数（BUG-36 的前提被破坏）。改成：

  ```bash
  sed -i 's/\$proxy_add_x_forwarded_for/\$remote_addr/' \
    /www/server/panel/vhost/nginx/proxy/zyxf.top/*.conf
  ```

- 宝塔的 nginx **不是 systemd 服务**（`systemctl reload nginx` 会报 `nginx.service is not active`），reload 用 `/www/server/nginx/sbin/nginx -s reload`；配置测试用 `/www/server/nginx/sbin/nginx -t`（路径 `/www/server/nginx/conf/nginx.conf`）。
- `location /` 不会吃掉 API：`^~ /api` 是最长前缀匹配，优先级高于 `location /`；上面的正则 location 优先级高于 `location /`、低于 `^~ /api`，因此也不影响 SPA 深链。改完顺手验一下 `/api/health` 仍是 JSON、`curl -sI https://<域名>/folder/1` 是 200、`curl -sI https://<域名>/assets/nope.js` 是 404。

---

## 5. HTTPS（两层证书：ESA 边缘 + 源站 certbot）

**2026-11-22 起有两张证书，不要混为一谈**（§4.2.5）：

| 层 | 谁签的 | 干什么用 | 怎么续 |
|---|---|---|---|
| **边缘**（浏览器看到的） | ESA 免费证书（Let's Encrypt） | 客户端 ↔ ESA | ESA 自动；申请时用 **HTTP DCV**：把挑战文件放进源站 `/var/www/letsencrypt/.well-known/acme-challenge/`，几分钟自动通过。可用 `aliyun esa GetCertificate` 看 `DCV` 与状态 |
| **源站**（下面的 certbot） | ZeroSSL | 仅 **ESA → 源站** 这一段（`origin.zyxf.top`，Host 跟随 `zyxf.top`） | certbot timer + webroot，见下 |

源站证书原先由 certbot 的 **nginx 插件**做 HTTP-01，现在改成 **webroot**：站点挂到 ESA 之后，
LE 的验证请求要穿过边缘才能到源站，而 nginx 插件会临时改写 `conf.d/zyxf.conf`——那个文件
每次部署都会被仓库版本整份覆盖，两条路径会打架。所以：

```bash
certbot certonly --webroot -w /var/www/letsencrypt -d zyxf.top --cert-name zyxf.top \
  --server https://acme.zerossl.com/v2/DV90
```

`frontend/nginx.conf` 在 80 与 443 各留了一个 `/.well-known/acme-challenge/` → `/var/www/letsencrypt`
的 location（80 那个必须用 location 而不是 server 级 `return 301`，否则挑战请求会被一起重定向走），
`deploy/deploy.sh` 负责 `mkdir -p`。ESA 侧用缓存规则把 `/.well-known/` 设为不缓存。

证书落在 `/etc/letsencrypt/live/zyxf.top/`，`certbot.timer` 每 12 小时跑 `certbot renew`，
续期后由 `renew_hook = systemctl reload nginx` 让 nginx 加载（`installer = nginx` 也会 reload，双保险）。

> **2026-11 改过方式**：之前是 **DNS-01**（手工在阿里云 DNS 加 `_acme-challenge` TXT），依赖 3 个不在仓库里的 `/usr/local/bin/*.sh` 钩子、`/root/.zyxf-certbot.env`（AK/SK）和服务器上的 `aliyun` CLI——机器重建时这套东西补不回来，而文档里写的却是 `certbot --nginx`（issue #98）。那 4 个仓库外的活动件已全部删除。
>
> 同时删掉了 `dzhz.zyxf.top` 的证书谱系：它已由 ESA 提供证书（§4.2.2），而这本证书的 `renew_hook` 指向**已删除的旧 CDN 域名**，留着只会在 2026-12-22（到期前 30 天）起每天失败两次。

前提：域名解析指向 ESA（边缘侧），且 **让 LE 能验证到源站**——`_acme-challenge` 走 80 端口时会被
ESA 转发回源站（`/.well-known/` 已设为不缓存）。

**一张证书覆盖两个域名**（裸域 + `www`）。首次只签裸域，后来加 `www` 时用 `--expand`：

```bash
certbot certonly --nginx -d zyxf.top -d www.zyxf.top --cert-name zyxf.top \
  --expand --server https://acme.zerossl.com/v2/DV90
# SAN 应包含 DNS:zyxf.top, DNS:www.zyxf.top
openssl x509 -in /etc/letsencrypt/live/zyxf.top/cert.pem -noout -text |
  grep -A1 "Subject Alternative Name"
```

`--expand` 之后 renewal 配置里自动带上两个域名，续期不需要再管。⚠️ 加 `www` 前先把 DNS 的 `www` 记录建好（CNAME → `zyxf.top`），否则 HTTP-01 验证会失败。

> ⚠️ **重签会重写 renewal 配置并丢掉自定义键**：`--force-renewal` 重签或 `--expand` 加域名时，certbot 会按当时的参数重写 `[renewalparams]`，`renew_hook = systemctl reload nginx` 已经因此被删过两次（2026-11）。所以每次动完证书都要补一遍：
>
> ```bash
> grep -q '^renew_hook' /etc/letsencrypt/renewal/zyxf.top.conf || \
>   echo 'renew_hook = systemctl reload nginx' >> /etc/letsencrypt/renewal/zyxf.top.conf
> ```
>
> `installer = nginx` 时 certbot 续期本身也会 reload，这一行是双保险；但没有它时，任何一次「证书换了、nginx 没 reload」都会让站点继续用旧证书直到下次重启。

> **`--nginx` 验证器会临时改写 `/etc/nginx/conf.d/zyxf.conf`**（插入 challenge 的 location，验证完还原）。而本仓库每次部署都会用仓库版本整份覆盖这个文件——两者一般不会撞上，但**不要在发布的同时手动跑 certbot**。真撞上了那次验证会失败，等下一次 `certbot.timer`（每天 00:00 / 12:00）重试即可。

自检：

```bash
certbot certificates | grep -E "Certificate Name|Domains|Expiry"
certbot renew --dry-run --cert-name zyxf.top --non-interactive --no-random-sleep-on-renew
```

> ⚠️ **`--dry-run` 会去连 Let's Encrypt 的 staging**（certbot 强制把 CA 换成 staging 做演练），而从北京访问 `acme-staging-v02.api.letsencrypt.org` 经常 `Read timed out`（2026-11-21 实测：23:05 通过，23:49 超时）。这**不是**续期配置有问题——同一天对 ZeroSSL 的真实签发多次都成功。判断续期是否健康，看这三处而不是 dry-run：
>
> - `certbot certificates` 的到期时间（现在是 2027-02-19，90 天）；
> - `journalctl -u certbot --since "-7 days"`，成功的运行只有 `Starting`/`Finished`、没有 `Failed to renew`；
> - `uptime.yml` 每天探测线上证书剩余天数（少于 14 天即失败告警）——它才是真正兜底的那一层。
>
> ⚠️ 另外**非交互模式会先随机睡最多 5 分钟**再开始验证（`Non-interactive renewal: random delay of …`）。用 `timeout` 包着跑时会被误判成「卡住/失败」，务必加 `--no-random-sleep-on-renew`。2026-11-22 用这个参数实测：`zyxf.top` 与 `www.zyxf.top` 都通过（webroot 经 ESA 回源站）。

---

## 6. 校验清单

- [ ] 后端目录对服务用户可写（`sudo -u www test -w /opt/zyxf/backend`），`journalctl -u zyxf` 无 `SQLITE_CANTOPEN`
- [ ] `https://zyxf.top` 能看到首页
- [ ] 展开右侧菜单 → 底部账户卡右侧箭头展开菜单 → 「登录」 → 用 `.env` 账号密码能登录
- [ ] 上传一个 PDF → 不报 CORS 错
- [ ] 点击 PDF → 能在浮层里直接看；点击 TXT → 显示文本；Word / PPT / 压缩包 → 给出下载按钮（在线预览只覆盖浏览器原生可渲染的两类）
- [ ] 点「下载」→ 文件名是原中文文件名

---

## 7. 日常运维

- 后端日志：`journalctl -u zyxf -f`
- 外部可用性探测：`.github/workflows/uptime.yml` 检查 `/api/health`、首页、`www` 跳转、证书剩余
  天数（<14 天即失败），失败由 GitHub 发邮件告警。可在 Actions 页面手动 Run 一次验证。
  ⚠️ **这是「尽力而为」，不是 SLA**：2026-11-21 实测该 workflow 合入 main 后一个多小时里
  `gh run list --event schedule` 仍然是 **0 次**（workflow `state=active`、cron 也在 main 上），
  即 GitHub 的 cron 既会延迟也可能长期不触发；它还会对**连续 60 天无提交**的仓库直接停用 schedule。
  需要确定性时手跑一次：`gh workflow run uptime.yml --repo Guochaoo/zyxf`。
- 后端重启：`systemctl restart zyxf`
- 后端状态：`systemctl status zyxf`
- nginx 配置变更：改仓库 [frontend/nginx.conf](../frontend/nginx.conf) → 走正常发布（`deploy/deploy.sh` 会覆盖 + `nginx -t` + reload，失败自动还原）
- 前端产物：**服务器上不构建**。发布流程由 CI 构建并替换 `dist/`；只想重跑一次部署而不改代码时，在 Actions 页面手动 `Deploy to Server` → **Run workflow**（`workflow_dispatch`）。上一份产物留在 `/opt/zyxf/frontend/dist.prev`
- 部署脚本单独运行（线上排障时不需要重新构建）：

  ```bash
  cd /opt/zyxf && git fetch origin main && git reset --hard origin/main
  PREV_SHA=<部署前的 sha> bash deploy/deploy.sh
  # 前端有改动时 CI 会先把产物 rsync 到 frontend/.incoming/；存在就替换 dist，不存在就沿用
  ```
- 同步干跑（核对「会新增/会删除什么」，**一个字节都不落库**；游客即可调用，限 2 次/分钟）：

  ```bash
  curl -s -X POST 'http://127.0.0.1:4000/api/sync?dry_run=1' | python3 -m json.tool
  # 关注 removed.folder_paths（将被剪的目录）与 removed.files / added.*
  ```

  干跑走的是与真实同步完全相同的事务体，只是在 COMMIT 前回滚，所以「会删什么」是精确的；
  怀疑剪枝会误删时先跑它，再决定要不要调 `FOLDER_PRUNE_MIN_AGE_DAYS`（见 §2.5）。
- 数据库备份（**已自动化**，2026-11 起）：`deploy/zyxf-backup.timer` 每天 04:17 触发
  `backend/scripts/backup-db.mjs`——`VACUUM INTO` 产出一致性快照 → gzip → 上传到 OSS 的
  `backup/` 前缀（`BACKUP_OSS_PREFIX` 可改，默认在 `OSS_KEY_PREFIX` 之外，不会被 sync 当成站内文件），
  默认保留 7 天（`BACKUP_RETENTION_DAYS`）。service/timer 由部署自动安装并 `enable --now`，
  首发那次部署还会立刻跑一遍。

  ```bash
  systemctl list-timers zyxf-backup.timer              # 下次触发时间
  systemctl start zyxf-backup.service                  # 立刻备份一次
  journalctl -u zyxf-backup -n 50                      # 上次结果（JSON 摘要 / 失败原因）
  node /opt/zyxf/backend/scripts/backup-db.mjs --dry   # 只算不写：报告快照大小与目标 key
  ```

  ⚠️ 只备份数据库、**不备份 `.env`**：它含密钥，塞进对象存储等于多开一处泄露面；丢了只是
  `JWT_SECRET` / `ADMIN_PASSWORD` / OSS 密钥需要重新生成，属于可恢复项（请自行在密码管理器留一份）。

  **恢复**：取 OSS 上最新的 `.db.gz` 解压，停服后覆盖 `/opt/zyxf/backend/data.db`，并**连同
  `data.db-wal` / `data.db-shm` 一起删掉**（旧 WAL 配新库会直接损坏），确认属主是 `www` 后启动：

  ```bash
  systemctl stop zyxf
  rm -f /opt/zyxf/backend/data.db-wal /opt/zyxf/backend/data.db-shm
  gunzip -c zyxf-data-YYYYMMDDTHHMMSSZ.db.gz > /opt/zyxf/backend/data.db
  chown www:www /opt/zyxf/backend/data.db && chmod 600 /opt/zyxf/backend/data.db
  systemctl start zyxf && curl -fsS http://127.0.0.1:4000/api/health
  ```

- 手工备份（**注意 WAL 模式**）：`db.js` 的 `PRAGMA journal_mode = WAL` 意味着已提交事务可能
  全在 `data.db-wal` 里，只 `cp data.db` 会得到一个**空库或严重陈旧的库**（早期开发库出现过
  「`data.db` 4 KB、`data.db-wal` 600 KB，拷出来连 `files` 表都没有」）。临时手工备份用：

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

  无论哪条路，**定期抽查备份能打开**（`sqlite3 ~/data.db.bak-xxxx '.tables'`）——没验证过的备份
  等于没有备份。

---

## 8. 常见坑

| 现象 | 原因 | 解决 |
|---|---|---|
| `/api/*` 502 | 后端没起 | `systemctl status zyxf`；`journalctl -u zyxf -n 50` 看启动报错 |
| 后端启动即退（无正常启动日志） | `JWT_SECRET`/`ADMIN_PASSWORD` 不合生产校验（会打印 `[index] FATAL...` 到 stderr） | 用 `openssl rand -hex 32` + 12 位强密码 |
| 上传报 CORS | OSS 跨域规则没加域名 | 回 0.2 节加 `https://zyxf.top` |
| 上传报 SignatureDoesNotMatch | 服务器时间不准 | `sudo timedatectl set-ntp true` |
| 下载/上传全都不通，接口却返回 200 | **密钥已失效**：`OSS_ACCESS_KEY_ID` 指向被删除/停用的 AccessKey（轮换后漏改服务器 `.env` 最常见）。签名是本地算的、不校验，所以接口照常给 URL，真链一取就 `InvalidAccessKeyId`。改 `/opt/zyxf/.env` → `systemctl restart zyxf` |
| 首页白屏 / `https` 连不上 | SSL 未配或证书没生效 | 见第 5 节申请 Let's Encrypt |
| 访问命中默认站点（旧页） | 按 IP 访问，非域名 | 用域名 `zyxf.top` 访问；确认域名已解析 |

---

## 9. 账号级资源清单（2026-11 盘点）

部署架构不止服务器上的东西，还包括账号里"存在但可能在空转"的部分。当前账号（cn-beijing 为主）实盘如下，**空转项的判定依据一并列出**，避免下次还要重新查一遍：

| 资源 | 现状 | 判定 |
|---|---|---|
| 轻量应用服务器 | 1 台 `swas.s.c2m2s40b1.linux`（2C2G/40G），到期 2027-01-03 | 唯一生产机 |
| OSS Bucket | 业务桶（文件库，私有 + ESA 私有回源 `oss.zyxf.top`）+ 发布桶（`dzhz` APK/静态，私有 + ESA 私有回源） | 都在用 |
| ESA | 站点 1 个（`zyxf.top`，免费版 `entranceplan`）+ 加速记录 **3 条**（主站、`dzhz`、`oss`）+ 压缩规则 1 条（Brotli+Gzip）+ 缓存规则 2 条（主站动态路径绕过、`oss` 整站绕过）+ 响应头规则 1 条 | 三条链路都走它；WAF / 边缘函数仍需另购 |
| 阿里云 CDN | 域名 **0**（旧域名 2026-11-21 已删） | 已下线，回滚成本见 §4.2.2 |
| SWAS 防火墙 | 22 / 80 / 443 / ICMP，来源均 `0.0.0.0/0` | 见 §0.1（22 无法收窄） |
| VPC | **0 个**（原有一个空的 `172.16.0.0/12`，0 交换机 0 ENI，2026-11-21 已删） | 轻量服务器不走 VPC，VPC 在这里没有用途 |
| EIP | 0 个 | 无 |
| NAS / 云备份 HBR / 日志服务 SLS | 0 个实例；SLS 仅有 OSS 自动创建的日志库（免费额度内） | 无可清理 |
| docker / containerd | 2026-11 已整包卸载（此前有 6.2 GB 只读构建缓存） | 已清 |

> 盘点命令：`aliyun swas-open ListInstances`、`aliyun oss ls`、`aliyun esa ListSites`、`aliyun cdn DescribeUserDomains`、`aliyun vpc DescribeVpcs`、`aliyun vpc DescribeVSwitches`、`aliyun ecs DescribeNetworkInterfaces`、`aliyun vpc DescribeEipAddresses`。
