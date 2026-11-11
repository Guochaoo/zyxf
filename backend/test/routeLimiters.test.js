import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { request, adminToken as adminLogin, setBaseUrl, clearLibraryTables, userToken } from './helpers.js';
import { app } from '../src/index.js';

// IMPROVE-32 的限流回归：搜索、统计两类「昂贵端点」各有专属分层配额，
// 与全局 publicLimiter（300 次/分钟）和下载桶互相独立。
// 限流器是进程内 MemoryStore，且按 IP 分桶——每个用例取一个全新出口 IP，
// 避免用例之间共享配额（否则新增用例会把后面的顶进 429）。

let server;

before(async () => {
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  setBaseUrl(`http://127.0.0.1:${server.address().port}`);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => clearLibraryTables(db));

let ipPool = 10;
const freshXff = () => ({ 'x-forwarded-for': `198.51.100.${ipPool++}` });

describe('IMPROVE-32: /api/search 有专属分层限流', () => {
  test('游客 60 次/分钟放行，第 61 次 429；同 IP 的登录用户与管理员的桶独立', async () => {
    const xff = freshXff();
    for (let i = 1; i <= 60; i++) {
      const { status } = await request('GET', '/api/search?q=', { headers: xff });
      assert.equal(status, 200, `第 ${i} 次应放行`);
    }
    const blocked = await request('GET', '/api/search?q=', { headers: xff });
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /搜索/);

    // 登录用户按 user id 计数：校园 NAT 下不会因为同出口的游客被限而连坐
    const token = userToken();
    assert.equal((await request('GET', '/api/search?q=', { token, headers: xff })).status, 200);
    // 管理员豁免
    const admin = await adminLogin();
    assert.equal((await request('GET', '/api/search?q=', { token: admin, headers: xff })).status, 200);
  });
});

describe('IMPROVE-32: /api/stats 与 /api/stats/heatmap 共用专属分层限流', () => {
  test('游客 30 次/分钟放行，第 31 次 429；登录用户额度更宽', async () => {
    const xff = freshXff();
    for (let i = 1; i <= 30; i++) {
      // 两条路径（概览 + 热力图）共用一个桶
      const path = i % 2 === 0 ? '/api/stats' : '/api/stats/heatmap';
      const { status } = await request('GET', path, { headers: xff });
      assert.equal(status, 200, `第 ${i} 次（${path}）应放行`);
    }
    const blocked = await request('GET', '/api/stats/heatmap', { headers: xff });
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /统计/);

    const token = userToken();
    assert.equal((await request('GET', '/api/stats', { token, headers: xff })).status, 200);
  });
});
