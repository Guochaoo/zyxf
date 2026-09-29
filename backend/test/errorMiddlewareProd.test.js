// IMPROVE-58 第 5 组（后端）：生产环境下 src/index.js 末尾的错误中间件不得把内部错误
// 信息回给客户端（isProd ? 'internal error' : err.message）。
//
// isProd 在 src/index.js **导入时**只读一次，所以本文件先改写环境变量、再动态 import app。
// 生产启动自检要求强 JWT_SECRET / ADMIN_PASSWORD / CORS_ORIGIN，否则进程直接 exit(1)。
// test/env.js 已把 DB_PATH 设为 :memory:，因此这里改写 ADMIN_PASSWORD 只影响本进程的
// 内存库，不会污染其它测试文件的 admin/admin123。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import folderRoutes from '../src/routes/folders.js';
import { wrapAsync } from '../src/http.js';
import { request, setBaseUrl } from './helpers.js';

process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'sK9pQ2xV7mR4tY8bN3wZ6cH1jL5dG0fA';
process.env.ADMIN_PASSWORD = 'Qw7Zr2Mn9Bx4Tv6K';
process.env.CORS_ORIGIN = 'https://library.test.local';

let server;

before(async () => {
  const { app } = await import('../src/index.js');
  // 同 routeGaps.test.js：探针必须挂在已被 app.use 挂载的子路由上，才能命中末尾那个
  // 四参错误中间件（app 导入后再 app.get() 注册的路由在层栈里排在它之后）。
  folderRoutes.get('/_probe/prod-error', wrapAsync(async () => {
    throw new Error('boom');
  }));
  folderRoutes.get('/_probe/prod-error-status', wrapAsync(async () => {
    throw Object.assign(new Error('teapot'), { status: 418 });
  }));
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  setBaseUrl(`http://127.0.0.1:${server.address().port}`);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

describe('IMPROVE-58: 生产环境的错误中间件不泄漏内部信息', () => {
  test('普通 Error → 500 + 通用文案，响应体里没有原始 message', async () => {
    const r = await request('GET', '/api/folders/_probe/prod-error');
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'internal error');
    assert.ok(!JSON.stringify(r.body).includes('boom'));
  });

  test('带 status 的错误仍按其 status 返回（418），但 message 同样被脱敏', async () => {
    const r = await request('GET', '/api/folders/_probe/prod-error-status');
    assert.equal(r.status, 418);
    assert.equal(r.body.error, 'internal error');
    assert.ok(!JSON.stringify(r.body).includes('teapot'));
  });
});
