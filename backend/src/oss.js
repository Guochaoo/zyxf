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
 * Generate a signed GET url for previewing/downloading a file.
 * forceDownload 让 OSS 按签名下发 `Content-Disposition: attachment` 与通用二进制
 * 类型——桶绑定了站点自有域名时，内联 SVG/HTML 会在站点源上执行脚本，所以
 * extPolicy.shouldForceDownload() 判为「不可内联」的对象必须走这条路径，
 * 由服务端强制，而不是指望客户端遵守 force_download 字段。
 */
export function signedGetUrl(key, expiresSec = 1800, { forceDownload = false, filename } = {}) {
  const options = { expires: expiresSec };
  if (forceDownload) {
    const name = encodeURIComponent(filename || key.split('/').pop() || 'download');
    options.response = {
      'content-disposition': `attachment; filename="${name}"`,
      'content-type': 'application/octet-stream',
    };
  }
  const url = ossClient().signatureUrl(key, options);
  return url.replace(/^http:/, 'https:');
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
