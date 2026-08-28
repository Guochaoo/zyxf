import crypto, { randomUUID } from 'node:crypto';
import { envOrThrow } from './env.js';

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

// Aliyun RPC 签名规范与 form 表单体的空格编码不同：
//  - 签名（stringToSign / canonical）用 RFC 3986，空格编码为 %20；
//  - application/x-www-form-urlencoded 表单体用 HTML 表单规则，空格编码为 +。
// 此外 `!` `'` `(` `)` `*` 都需要按 utf8 字节转义（RPC 规范要求）。
// 若两者共用同一个编码器（把 %20 换成 +），含空格的文件名/oss_key 会导致
// 签名串与实际发送的 body 不一致 → IMM 签名校验失败（BUG-03）。
const encodeRfc3986 = (str) =>
  encodeURIComponent(String(str)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// 签名用：空格 → %20（RFC 3986）
export const percentEncodeForSign = (str) => encodeRfc3986(str);

// 表单体（urlencoded）用：空格 → +（仍保持 `!` `'` `(` `)` `*` 的转义）
export const percentEncodeUrlencoded = (str) => encodeRfc3986(str).replace(/%20/g, '+');

const hmacSha1 = (secret, str) =>
  crypto.createHmac('sha1', secret).update(str).digest('base64');

// 把 AbortSignal.timeout 触发的中止错误统一包装成友好超时错误（BUG-13）。
// Node ≥ 17 的 AbortSignal.timeout 抛 TimeoutError（name TimeoutError / code 23），
// 某些环境下可能抛 AbortError（code ABORT_ERR）。
export function toImmTimeoutError(action, e) {
  if (e.name === 'AbortError' || e.name === 'TimeoutError' || e.code === 'ABORT_ERR' || e.code === 23) {
    const err = new Error(`IMM ${action} 请求超时（10 秒）`);
    err.code = 'IMM_TIMEOUT';
    return err;
  }
  return null;
}

// OSS_REGION is like "oss-cn-beijing"; IMM uses "cn-beijing".
const regionId = () => envOrThrow('OSS_REGION').replace(/^oss-/, '');

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
  const sortedKeys = Object.keys(all).sort();
  // 签名 canonical：空格 → %20（RFC 3986）
  const canonicalForSign = sortedKeys
    .map((k) => `${percentEncodeForSign(k)}=${percentEncodeForSign(String(all[k]))}`)
    .join('&');
  const stringToSign = `POST&${percentEncodeForSign('/')}&${percentEncodeForSign(canonicalForSign)}`;
  const signature = hmacSha1(accessKeySecret + '&', stringToSign);

  // 表单体 parameters：空格 → +（urlencoded）。两者不能共用同一编码器，否则
  // 含空格文件名的签名与实际发送的 body 不一致（BUG-03）。
  const bodyParams = sortedKeys
    .map((k) => `${percentEncodeUrlencoded(k)}=${percentEncodeUrlencoded(String(all[k]))}`)
    .join('&');
  const body = `${bodyParams}&Signature=${percentEncodeUrlencoded(signature)}`;

  let res;
  try {
    res = await fetch(`https://imm.${regionId()}.aliyuncs.com/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      // IMM 是外部服务，无超时会让请求槽与 socket 被长期占用（BUG-13）。
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    // AbortSignal.timeout 触发时包装成友好错误，避免把「超时」误报成「预览服务不可用」（BUG-13）。
    const timeoutErr = toImmTimeoutError(action, e);
    if (timeoutErr) throw timeoutErr;
    throw e;
  }
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
