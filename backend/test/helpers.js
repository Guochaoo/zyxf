// 共享 HTTP 测试基建（原先后在 api/auditFixes/syncBatch/foldersFixes/
// statsTopDownloads/statsAndMime 六个文件各复制约 50 行，审计后收敛到这里）。
// 普通 import，不经 mock.module——本文件只做 HTTP 编排，不碰任何被 mock 的模块。
import assert from 'node:assert/strict';
import { signToken } from '../src/auth.js';
import { ensureTestUser } from './seed.js';

let base = null;

/** 各测试文件的 before() 启动服务器后调用，注入 base URL。 */
export function setBaseUrl(url) {
  base = url;
}

export async function request(method, path, { token, body, headers } = {}) {
  if (!base) throw new Error('helpers: 先在 before() 里调用 setBaseUrl()');
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: data };
}

// BUG-104 修法①：登录失败必须 fail-fast 并带出真实状态码与响应体——
// 原先六个文件各自 `return body.token`，登录偶发失败（偶发项见 issue #52）时
// undefined token 静默流向后续请求，失败以无关用例的 401/TypeError 呈现，无法定位。
export async function adminToken() {
  const { status, body } = await request('POST', '/api/auth/login', {
    body: { username: 'admin', password: 'admin123' },
  });
  assert.equal(status, 200, `admin 登录失败（HTTP ${status}）：${JSON.stringify(body)}`);
  assert.ok(body?.token, `登录响应缺少 token：${JSON.stringify(body)}`);
  return body.token;
}

/** 清空资料库三表（各文件 beforeEach 调用；users/email_codes 不动）。 */
export function clearLibraryTables(db) {
  db.prepare('DELETE FROM download_logs').run();
  db.prepare('DELETE FROM files').run();
  db.prepare('DELETE FROM folders').run();
}

// ---- 常用写的封装（issue #66：原先 api / foldersFixes / statsAndMime 各抄一份，
// 三者的默认值还不一样，改一处语义不会同步到别处） ----

/** 建文件夹（管理员）：POST /api/folders。 */
export async function createFolder(token, name, parent_id = null) {
  return request('POST', '/api/folders', { token, body: { name, parent_id } });
}

/** 注册文件元数据（管理员）：POST /api/files。oss_key 默认按 name 派生；mime_type 由服务端按扩展名派生（BUG-26）。 */
export async function registerFile(token, { name, folder_id = null, oss_key, size = 123, mime_type = null }) {
  return request('POST', '/api/files', {
    token,
    body: { name, folder_id, oss_key: oss_key ?? `zyxf-test/${name}`, size, mime_type },
  });
}

/**
 * 普通用户 token。id 默认 99：`ensureTestUser` 先落库（attachUser 会回查用户行），
 * 所以调用方不必自己「先建行再签 token」。
 */
export function userToken({ id = 99, username = 'guest', role = 'user' } = {}) {
  ensureTestUser({ id, username, role });
  return signToken({ id, username, role });
}
