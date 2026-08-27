import crypto, { randomUUID } from 'node:crypto';

// ---- IMM (Intelligent Media Management) WebOffice preview ----
//
// Unlike the OSS `x-oss-process=doc/preview` chain — which silently refuses
// to render browser-PostObject ("externally uploaded") objects — the IMM
// `GenerateWebofficeToken` OpenAPI renders any object referenced by
// `SourceURI`, external uploads included (pass ExternalUploaded=true). The
// frontend pairs the returned WebofficeURL + AccessToken with the official
// WebOffice JS-SDK, so previews work on mobile WebViews too.
//
// This module hand-rolls the Aliyun RPC signature (HMAC-SHA1) so we don't
// need to pull in the full OpenAPI SDK dependency tree just for one call.

function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const percentEncode = (str) =>
  encodeURIComponent(str)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');

const hmacSha1 = (secret, str) =>
  crypto.createHmac('sha1', secret).update(str).digest('base64');

// OSS_REGION is like "oss-cn-beijing"; IMM uses "cn-beijing".
const regionId = () => (envOrThrow('OSS_REGION') || '').replace(/^oss-/, '');

/** IMM project bound to the bucket (OSS console → IMM binding). */
export function immProject() {
  return process.env.IMM_PROJECT || 'zyxf';
}

/**
 * Build the form body for an RPC-style IMM OpenAPI call, fully signed.
 * @returns {Promise<object>} parsed JSON response body
 */
async function immRpc(action, params) {
  const accessKeyId = envOrThrow('OSS_ACCESS_KEY_ID');
  const accessKeySecret = envOrThrow('OSS_ACCESS_KEY_SECRET');
  const common = {
    Format: 'JSON',
    Version: '2020-09-30',
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomUUID(),
    SignatureVersion: '1.0',
    Timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    Action: action,
  };
  const all = { ...common, ...params };
  const canonical = Object.keys(all)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(String(all[k]))}`)
    .join('&');
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonical)}`;
  const signature = hmacSha1(accessKeySecret + '&', stringToSign);
  const body = `${canonical}&Signature=${percentEncode(signature)}`;

  const res = await fetch(`https://imm.${regionId()}.aliyuncs.com/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.Message || `IMM ${action} failed (HTTP ${res.status})`);
    err.code = json.Code || `HTTP_${res.status}`;
    err.requestId = json.RequestId;
    throw err;
  }
  return json;
}

/**
 * Get a WebOffice preview token for a file.
 *
 * @param {object} file DB row (must have oss_key, name)
 * @returns {Promise<{url: string, token: string, refresh_token: string}>}
 *          WebofficeURL + AccessToken for the frontend JS-SDK.
 */
export async function generateWebofficeToken({ oss_key: ossKey, name }) {
  const res = await immRpc('GenerateWebofficeToken', {
    ProjectName: immProject(),
    SourceURI: `oss://${envOrThrow('OSS_BUCKET')}/${ossKey}`,
    Filename: name || '',
    User: JSON.stringify({ UserId: 'guest', Role: 'viewer' }),
    // PDF only supports readonly preview (editing is Office-only).
    Permission: JSON.stringify({ Readonly: true }),
    // The object was uploaded via browser PostObject → external upload.
    ExternalUploaded: true,
  });
  return {
    url: res.WebofficeURL,
    token: res.AccessToken,
    refresh_token: res.RefreshToken,
    expires: res.AccessTokenExpiredTime,
  };
}

/**
 * Refresh a WebOffice access token before it expires (30 min lifetime).
 * The refresh token itself lives 1 day; when it expires the caller should
 * fall back to generateWebofficeToken() for a brand-new session.
 *
 * @param {object} opts { accessToken, refreshToken }
 * @returns {Promise<{token: string, refresh_token: string, expires: string}>}
 */
export async function refreshWebofficeToken({ accessToken, refreshToken }) {
  const res = await immRpc('RefreshWebofficeToken', {
    ProjectName: immProject(),
    AccessToken: accessToken,
    RefreshToken: refreshToken,
  });
  return {
    token: res.AccessToken,
    refresh_token: res.RefreshToken,
    expires: res.AccessTokenExpiredTime,
  };
}
