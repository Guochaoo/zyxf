import OSS from 'ali-oss';
import crypto from 'node:crypto';

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

export function ossPublicHost() {
  const region = envOrThrow('OSS_REGION');
  const bucket = envOrThrow('OSS_BUCKET');
  const ep = process.env.OSS_ENDPOINT;
  if (ep) return ep.replace(/\/+$/, '');
  return `https://${bucket}.${region}.aliyuncs.com`;
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
  const url = client.signatureUrl(key, {
    expires: expiresSec,
    response: Object.keys(response).length ? response : undefined,
  });
  return url.replace(/^http:/, 'https:');
}

export async function deleteOssObject(key) {
  const client = ossClient();
  await client.delete(key);
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
