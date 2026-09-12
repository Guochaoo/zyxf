import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { app } from '../src/index.js';
import { ossObjectStore } from './setup.js';
import { request, adminToken as adminLogin, setBaseUrl, clearLibraryTables } from './helpers.js';

let server;
let base;

before(async () => {
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
  setBaseUrl(base);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  ossObjectStore.keys = [];
  clearLibraryTables(db);
});

async function registerFile(token, { name, oss_key, mime_type }) {
  const body = { name, folder_id: null, oss_key: oss_key ?? `zyxf-test/${name}`, size: 10 };
  if (mime_type !== undefined) body.mime_type = mime_type;
  return request('POST', '/api/files', { token, body });
}

// 直接插行以构造超 8 种扩展名的场景（走接口会受扩展名白名单限制）。
function seedExts(exts) {
  const ins = db.prepare(
    'INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, created_at) VALUES (NULL, ?, ?, 10, NULL, ?, ?)'
  );
  exts.forEach((ext, i) => ins.run(`f${i}.${ext}`, `zyxf-test/seed-${i}.${ext}`, ext, Date.now()));
}

describe('BUG-24: stats 返回真实类型总数', () => {
  test('超 8 种类型时 type_total 反映总数（而非截断后的长度）', async () => {
    seedExts(['pdf', 'docx', 'pptx', 'xlsx', 'txt', 'csv', 'zip', 'rar', 'png', 'jpg', 'mp3']);
    const { status, body } = await request('GET', '/api/stats');
    assert.equal(status, 200);
    assert.equal(body.type_breakdown.length, 8, '明细仍截断为 8 类');
    assert.equal(body.type_total, 11, 'type_total 为真实类型数');
  });

  test('类型不足 8 种时 type_total 与之相等', async () => {
    seedExts(['pdf', 'docx']);
    const { body } = await request('GET', '/api/stats');
    assert.equal(body.type_total, 2);
    assert.equal(body.type_breakdown.length, 2);
  });
});

describe('BUG-26: MIME 以扩展名派生值为权威', () => {
  test('客户端上报错误 mime_type 时被忽略，落库为扩展名派生值', async () => {
    const token = await adminLogin();
    await registerFile(token, {
      name: 'mime.pdf',
      mime_type: 'application/x-evil',
    });
    const row = db.prepare("SELECT mime_type FROM files WHERE name = 'mime.pdf'").get();
    assert.equal(row.mime_type, 'application/pdf');
  });

  test('客户端不传 mime_type 时同样落库派生值', async () => {
    const token = await adminLogin();
    const r = await registerFile(token, { name: 'nomime.docx' });
    // 先断言注册成功：偶发的登录/注册失败会以「row 为 undefined」的 TypeError 呈现，
    // 真实原因（下游 401/409）被掩盖（见 docs/ISSUES.md 的偶发登录失败条目）。
    assert.equal(r.status, 200, `注册应成功，实际 ${r.status}: ${JSON.stringify(r.body)}`);
    const row = db.prepare("SELECT mime_type FROM files WHERE name = 'nomime.docx'").get();
    assert.equal(
      row?.mime_type,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  });

  test('URL 响应的 MIME 与落库值一致（同源）', async () => {
    const token = await adminLogin();
    const created = await registerFile(token, { name: 'same.txt', mime_type: 'text/x-wrong' });
    assert.equal(created.status, 200, `注册应成功，实际 ${created.status}: ${JSON.stringify(created.body)}`);
    const stored = db.prepare('SELECT mime_type FROM files WHERE id = ?').get(created.body.id);
    const { body } = await request('GET', `/api/files/${created.body.id}/url`);
    assert.equal(body.mime_type, stored.mime_type);
    assert.equal(body.mime_type, 'text/plain; charset=utf-8');
  });
});

describe('sync 同步入库的 MIME 与上传路径一致', () => {
  test('sync 导入的文件按扩展名派生 MIME', async () => {
    const token = await adminLogin();
    ossObjectStore.keys = ['zyxf-test/synced.pdf'];
    await request('POST', '/api/sync', { token });
    const row = db.prepare("SELECT mime_type, ext FROM files WHERE name = 'synced.pdf'").get();
    assert.equal(row.ext, 'pdf');
    assert.equal(row.mime_type, 'application/pdf');
  });
});
