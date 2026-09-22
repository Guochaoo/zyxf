// 共享 HTTP 测试基建（原先后在 api/auditFixes/syncBatch/foldersFixes/
// statsTopDownloads/statsAndMime 六个文件各复制约 50 行，审计后收敛到这里）。
// 普通 import，不经 mock.module——本文件只做 HTTP 编排，不碰任何被 mock 的模块。
import assert from 'node:assert/strict';

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
