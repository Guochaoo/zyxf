import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { request, adminToken as adminLogin, setBaseUrl, clearLibraryTables, userToken } from './helpers.js';
import { app } from '../src/index.js';

// IMPROVE-31 / IMPROVE-32 的限流回归：搜索、统计、预览凭证三类「昂贵端点」各自
// 有专属分层配额，与全局 publicLimiter（300 次/分钟）和下载桶互相独立。
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

const insertPdf = () =>
  db
    .prepare(
      `INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, created_at)
       VALUES (NULL, 'preview.pdf', ?, 10, 'application/pdf', '.pdf', ?)`
    )
    .run(`zyxf-test/preview-${ipPool}-${Date.now()}.pdf`, Date.now()).lastInsertRowid;

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

describe('IMPROVE-31: 预览凭证独立配额，不占用下载额度', () => {
  test('游客预览 20 次/分钟后 429，同一 IP 的下载仍可访问', async () => {
    const id = insertPdf();
    const xff = freshXff();
    for (let i = 1; i <= 20; i++) {
      const res = await request('GET', `/api/files/${id}/weboffice-token`, { headers: xff });
      assert.equal(res.status, 200, `第 ${i} 次预览应放行`);
      assert.equal(res.body.token, 'test-access-token');
    }
    const blocked = await request('GET', `/api/files/${id}/weboffice-token`, { headers: xff });
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /预览/);

    // 核心诉求：预览打满不会连带锁死下载（两者各自一个桶）
    const dl = await request('GET', `/api/files/${id}/url`, { headers: xff });
    assert.equal(dl.status, 200);
  });

  test('weboffice-refresh 与签发共用同一桶（都是付费 IMM 调用）', async () => {
    const id = insertPdf();
    const xff = freshXff();
    for (let i = 1; i <= 20; i++) {
      await request('GET', `/api/files/${id}/weboffice-token`, { headers: xff });
    }
    const refresh = await request('POST', `/api/files/${id}/weboffice-refresh`, {
      headers: xff,
      body: { access_token: 'a', refresh_token: 'r' },
    });
    assert.equal(refresh.status, 429);
  });

  test('登录用户预览额度更宽；管理员豁免', async () => {
    const id = insertPdf();
    const xff = freshXff();
    for (let i = 1; i <= 20; i++) {
      await request('GET', `/api/files/${id}/weboffice-token`, { headers: xff });
    }
    assert.equal((await request('GET', `/api/files/${id}/weboffice-token`, { headers: xff })).status, 429);

    const token = userToken();
    assert.equal(
      (await request('GET', `/api/files/${id}/weboffice-token`, { token, headers: xff })).status,
      200
    );
    const admin = await adminLogin();
    assert.equal(
      (await request('GET', `/api/files/${id}/weboffice-token`, { token: admin, headers: xff })).status,
      200
    );
  });
});
