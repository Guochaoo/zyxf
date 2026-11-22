import RPCClient from '@alicloud/pop-core';
import { envStr } from './env.js';
import { fileUrl } from './oss.js';

/**
 * 刷新 ESA 边缘缓存（`PurgeCaches`）。
 *
 * 为什么需要它：`oss.zyxf.top` 的文件缓存现在是 7 天（docs/DEPLOY.md §4.2.6），
 * 路径内容不可变所以长 TTL 是安全的；但删除/改名之后，旧 URL 在边缘还能被命中。
 * 所以写路径（删除、改名/移动、删文件夹）要顺手把旧 URL 刷掉，让链接立刻 404。
 *
 * 设计上的三条约定：
 * 1. **best-effort**：刷新失败只打日志，绝不让删除操作跟着失败——文件已经删了，
 *    报错只会让前端以为没删掉，用户重复操作更糟。
 * 2. **未配置就静默跳过**：本地开发、测试、以及还没配 ESA 凭证的环境不报错。
 * 3. **不阻塞响应**：调用方可以 `await`，单次调用通常几十毫秒；失败也不抛。
 *
 * 环境变量：`ESA_SITE_ID` 必填；`ESA_ACCESS_KEY_ID/SECRET` 缺省时复用
 * `OSS_ACCESS_KEY_*`（建议给同一个 RAM 用户加一条只含 `esa:PurgeCaches` 的策略）。
 */
const ENDPOINT = 'https://esa.cn-hangzhou.aliyuncs.com';
const API_VERSION = '2024-09-10';
// 一次请求里塞太多 URL 会被网关拒绝；按 100 个一批，够用且不至于超时。
const BATCH_SIZE = 100;

let cachedClient = null;
let cachedClientKey = '';

function config() {
  const siteId = envStr('ESA_SITE_ID');
  const accessKeyId = envStr('ESA_ACCESS_KEY_ID') || envStr('OSS_ACCESS_KEY_ID');
  const accessKeySecret = envStr('ESA_ACCESS_KEY_SECRET') || envStr('OSS_ACCESS_KEY_SECRET');
  if (!siteId || !accessKeyId || !accessKeySecret) return null;
  return { siteId, accessKeyId, accessKeySecret };
}

export function isPurgeEnabled() {
  return config() !== null;
}

function clientFor(cfg) {
  const key = `${cfg.accessKeyId}:${cfg.siteId}`;
  if (!cachedClient || cachedClientKey !== key) {
    cachedClient = new RPCClient({
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
      endpoint: ENDPOINT,
      apiVersion: API_VERSION,
    });
    cachedClientKey = key;
  }
  return cachedClient;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * 刷新一组 URL（完整 `https://oss.zyxf.top/...`）。
 * 返回 `{ skipped }` / `{ purged, errors }`，永远不抛。
 *
 * `client` 仅供测试注入（需要一个 `.request(action, params)` 的对象）。
 */
export async function purgeUrls(urls, { client } = {}) {
  const list = [...new Set((urls || []).filter(Boolean))];
  if (list.length === 0) return { skipped: true };

  const cfg = config();
  if (!cfg) return { skipped: true };
  const used = client || clientFor(cfg);

  let purged = 0;
  const errors = [];
  for (const batch of chunk(list, BATCH_SIZE)) {
    try {
      await used.request(
        'PurgeCaches',
        {
          SiteId: cfg.siteId,
          Type: 'file',
          // 字段形状踩过坑：Content 是对象，file 类型把 URL 放进 Files 数组；
          // 写成 Content.1 之类会被 API 以 InvalidContent 拒绝。
          Content: JSON.stringify({ Files: batch }),
        },
        { method: 'POST' }
      );
      purged += batch.length;
    } catch (e) {
      errors.push(e?.message || String(e));
    }
  }

  if (errors.length) {
    // 不抛：调用方是删除/改名路径，缓存刷新失败不该让它回滚。
    console.warn('[esa] 刷新缓存失败:', errors.join(' | '));
  }
  return { purged, errors };
}

/**
 * 刷新的便捷入口：传 OSS key 列表（会自动拼成下载 URL）。
 * `fileUrl` 在没配 `OSS_PUBLIC_BASE` 时会抛，这里兜住——那种环境下本来也没有 CDN。
 */
export async function purgeFileKeys(keys, opts) {
  const list = (keys || []).filter(Boolean);
  if (list.length === 0) return { skipped: true };
  let urls;
  try {
    urls = list.map((k) => fileUrl(k));
  } catch (e) {
    return { skipped: true, reason: e.message };
  }
  return purgeUrls(urls, opts);
}
