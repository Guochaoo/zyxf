import OSS from 'ali-oss';
import crypto from 'node:crypto';
import { ossPrefix } from './storagePath.js';
import { envOrThrow } from './env.js';

// Shared credentials for both OSS clients (env vars are static at runtime).
function baseOssConfig() {
  return {
    region: envOrThrow('OSS_REGION'),
    accessKeyId: envOrThrow('OSS_ACCESS_KEY_ID'),
    accessKeySecret: envOrThrow('OSS_ACCESS_KEY_SECRET'),
    bucket: envOrThrow('OSS_BUCKET'),
    secure: true,
  };
}

let _client = null;
export function ossClient() {
  if (_client) return _client;
  _client = new OSS(baseOssConfig());
  return _client;
}

// ---- cached module-level constants (env vars are static at runtime) ----

const _ossPublicHost = (() => {
  const ep = process.env.OSS_ENDPOINT;
  if (ep) {
    const trimmed = ep.replace(/\/+$/, '');
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }
  return `https://${envOrThrow('OSS_BUCKET')}.${envOrThrow('OSS_REGION')}.aliyuncs.com`;
})();

function ossPublicHost() {
  return _ossPublicHost;
}

/**
 * Build a PostObject policy + signature for direct browser upload.
 * Returns the fields the browser must include in the multipart/form-data POST.
 */
export function buildPostPolicy({ key, maxSizeBytes = 200 * 1024 * 1024, expiresSec = 600 }) {
  const { accessKeyId, accessKeySecret } = baseOssConfig();
  const expiration = new Date(Date.now() + expiresSec * 1000).toISOString();

  const policy = {
    expiration,
    conditions: [
      ['content-length-range', 0, maxSizeBytes],
      ['eq', '$key', key],
      ['eq', '$success_action_status', '200'],
    ],
  };
  const policyB64 = Buffer.from(JSON.stringify(policy)).toString('base64');
  const signature = crypto
    .createHmac('sha1', accessKeySecret)
    .update(policyB64)
    .digest('base64');

  return {
    host: ossPublicHost(),
    key,
    policy: policyB64,
    OSSAccessKeyId: accessKeyId,
    signature,
    success_action_status: '200',
  };
}

/**
 * 下载域名（ESA 边缘 → 私有 OSS 源站，边缘用 STS 临时令牌回源）。
 * 配了它以后客户端不再持有签名：URL 就是 `<base>/<key>`，有效期也没了（跟随文件本身）。
 * 见 docs/DEPLOY.md §4.2.6。
 *
 * 与 `OSS_ENDPOINT`（上传用 PostObject 的 host）是两个方向，别混。
 */
export function ossPublicBase() {
  return (process.env.OSS_PUBLIC_BASE || '').trim().replace(/\/+$/, '');
}

/**
 * URL for a library object：`<base>/<key>`，签名由边缘用 STS 令牌完成，客户端只拿路径。
 * 逐段编码、保留 `/`——key 里可能有中文、空格、`#`、`?`，整段 encodeURIComponent 会把
 * 目录分隔符也编码掉。
 *
 * 没有「回退到签名直链」：那条路会让「漏配环境变量」悄悄变成另一种计费口径
 * （外网流出 ¥0.5/GB），所以宁可启动时直接失败（生产校验在 index.js）。
 */
export function fileUrl(key) {
  const base = ossPublicBase();
  if (!base) throw new Error('OSS_PUBLIC_BASE 未配置，无法生成下载 URL（见 docs/DEPLOY.md §4.2.6）');
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * List every object key under the configured OSS_KEY_PREFIX (paginated).
 * Folder placeholders (keys ending with '/') are included.
 * Returns [{ key, size }].
 */
export async function listOssObjects() {
  const client = ossClient();
  const prefix = ossPrefix() ? `${ossPrefix()}/` : '';
  // Internal `.preview/` shadow copies (legacy IMM workaround) are never
  // library content, so sync must skip them until the bucket is cleaned.
  const previewPrefix = `${prefix}.preview/`;
  const out = [];
  let marker;
  do {
    const res = await client.list({ prefix, marker, 'max-keys': 1000 });
    for (const o of res.objects || []) {
      if (!o.name.startsWith(previewPrefix)) out.push({ key: o.name, size: o.size });
    }
    marker = res.nextMarker;
    if (!res.isTruncated) break;
  } while (marker);
  return out;
}

export async function deleteOssObjectIfExists(key) {
  try {
    await ossClient().delete(key);
  } catch (e) {
    if (e?.code === 'NoSuchKey' || e?.status === 404 || e?.statusCode === 404) return;
    throw e;
  }
}

export async function putEmptyOssObject(key) {
  if (!key) return;
  await ossClient().put(key, Buffer.alloc(0));
}

export async function copyOssObject(fromKey, toKey) {
  if (fromKey === toKey) return;
  await ossClient().copy(toKey, fromKey);
}
