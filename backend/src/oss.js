import OSS from 'ali-oss';
import crypto from 'node:crypto';
import { ossPrefix } from './storagePath.js';

function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

let _client = null;
export function ossClient() {
  if (_client) return _client;
  _client = new OSS({
    region: envOrThrow('OSS_REGION'),
    accessKeyId: envOrThrow('OSS_ACCESS_KEY_ID'),
    accessKeySecret: envOrThrow('OSS_ACCESS_KEY_SECRET'),
    bucket: envOrThrow('OSS_BUCKET'),
    secure: true,
  });
  return _client;
}

let _immClient = null;
/**
 * Get an OSS client configured for IMM (WebOffice) preview.
 * Requires V4 signature and custom domain (cname) support.
 */
function immClient() {
  if (_immClient) return _immClient;
  _immClient = new OSS({
    region: envOrThrow('OSS_REGION'),
    accessKeyId: envOrThrow('OSS_ACCESS_KEY_ID'),
    accessKeySecret: envOrThrow('OSS_ACCESS_KEY_SECRET'),
    bucket: envOrThrow('OSS_BUCKET'),
    endpoint: envOrThrow('OSS_ENDPOINT'),
    cname: true,
    secure: true,
  });
  return _immClient;
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

export function ossPublicHost() {
  return _ossPublicHost;
}

/**
 * Build a PostObject policy + signature for direct browser upload.
 * Returns the fields the browser must include in the multipart/form-data POST.
 */
export function buildPostPolicy({ key, maxSizeBytes = 200 * 1024 * 1024, expiresSec = 600 }) {
  const accessKeyId = envOrThrow('OSS_ACCESS_KEY_ID');
  const accessKeySecret = envOrThrow('OSS_ACCESS_KEY_SECRET');
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
 * Optionally overrides the response Content-Type and Content-Disposition so that:
 *  - Files stored with wrong/empty content-type (e.g. application/octet-stream)
 *    are still served correctly (PDF previews inline instead of forced download).
 *  - The download filename matches the original (supports UTF-8 via RFC 5987).
 */
export function signedGetUrl(key, expiresSec = 3600, opts = {}) {
  const client = ossClient();
  const response = {};
  if (opts.contentType) response['content-type'] = opts.contentType;
  if (opts.disposition) response['content-disposition'] = opts.disposition;

  const signOpts = { expires: expiresSec };
  if (opts.process) signOpts.process = opts.process;
  if (Object.keys(response).length) signOpts.response = response;

  const url = client.signatureUrl(key, signOpts);
  return url.replace(/^http:/, 'https:');
}

// ---- IMM preview constants ----

// Files are uploaded directly to OSS (browser PostObject), so from IMM's
// perspective they are *externally uploaded* and MUST be previewed with
// ExternalUploaded=true, otherwise IMM rejects them with StatusConflict
// (error code 0056-00000001).
const DEFAULT_IMM_STYLE = process.env.IMM_STYLE
  ? `style/${process.env.IMM_STYLE}`
  : 'doc/preview,export_0,print_0,ExternalUploaded=true';

/**
 * True for legacy `.preview/` shadow copies (from the earlier preview-copy
 * workaround) — internal objects, never library content. Kept so sync/list
 * still skip them until the leftovers are cleaned up from the bucket.
 */
export function isPreviewCopyKey(ossKey) {
  const prefix = ossPrefix();
  return prefix
    ? String(ossKey).startsWith(`${prefix}/.preview/`)
    : String(ossKey).startsWith('.preview/');
}

/**
 * Generate a signed GET URL for IMM (WebOffice) document preview.
 *
 * IMPORTANT: IMM preview requires a custom domain bound to the OSS bucket.
 * Set OSS_ENDPOINT in .env to your custom domain, e.g. https://zyxf.top.
 *
 * @param key        OSS object key
 * @param expiresSec URL validity in seconds
 * @param style      Override IMM processing style
 * @param externalUploaded  true (default) for browser-uploaded objects (adds
 *                          ExternalUploaded=true); false for internal objects
 *                          like preview copies (strips the flag)
 */
export function immPreviewUrl(key, expiresSec = 1800, style = null, { externalUploaded = true } = {}) {
  let processStyle = style || DEFAULT_IMM_STYLE;
  const hasFlag = /,\s*ExternalUploaded\s*=\s*true/gi.test(processStyle);
  if (externalUploaded && !hasFlag) {
    processStyle = `${processStyle},ExternalUploaded=true`;
  } else if (!externalUploaded && hasFlag) {
    processStyle = processStyle.replace(/,\s*ExternalUploaded\s*=\s*true/gi, '');
  }
  const client = immClient();
  const url = client.signatureUrl(key, { expires: expiresSec, process: processStyle });
  return url.replace(/^http:/, 'https:');
}

export async function deleteOssObject(key) {
  const client = ossClient();
  await client.delete(key);
}

/**
 * List every object key under the configured OSS_KEY_PREFIX (paginated).
 * Folder placeholders (keys ending with '/') are included.
 * Returns [{ key, size }].
 */
export async function listOssObjects() {
  const client = ossClient();
  const prefix = ossPrefix() ? `${ossPrefix()}/` : '';
  const out = [];
  let marker;
  do {
    const res = await client.list({ prefix, marker, 'max-keys': 1000 });
    // Skip internal `.preview/` shadow copies — they exist only for IMM
    // rendering and must never appear as library content (e.g. via sync).
    for (const o of res.objects || []) {
      if (!isPreviewCopyKey(o.name)) out.push({ key: o.name, size: o.size });
    }
    marker = res.nextMarker;
    if (!res.isTruncated) break;
  } while (marker);
  return out;
}

export async function deleteOssObjectIfExists(key) {
  try {
    await deleteOssObject(key);
  } catch (e) {
    if (e?.code === 'NoSuchKey' || e?.status === 404 || e?.statusCode === 404) return;
    throw e;
  }
}

export async function putEmptyOssObject(key) {
  if (!key) return;
  const client = ossClient();
  await client.put(key, Buffer.alloc(0));
}

export async function copyOssObject(fromKey, toKey) {
  if (fromKey === toKey) return;
  const client = ossClient();
  await client.copy(toKey, fromKey);
}
