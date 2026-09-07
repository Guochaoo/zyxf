import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { app } from '../src/index.js';
import { ossObjectStore } from './setup.js';

let server;
let base;

before(async () => {
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  ossObjectStore.keys = [];
  db.prepare('DELETE FROM download_logs').run();
  db.prepare('DELETE FROM files').run();
  db.prepare('DELETE FROM folders').run();
});

async function request(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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

async function adminLogin() {
  const { body } = await request('POST', '/api/auth/login', {
    body: { username: 'admin', password: 'admin123' },
  });
  return body.token;
}

describe('BUG-15: top_downloads 按 file_id 分组', () => {
  test('窗口内重命名同一文件不出现重复行，且取当前持久名', async () => {
    const token = await adminLogin();
    // 登记一个文件，然后改名（download_logs 记录旧名，files 记录新名）。
    const reg = await request('POST', '/api/files', {
      token,
      body: { name: 'old.pdf', oss_key: 'zyxf-test/old.pdf', size: 100, mime_type: 'application/pdf' },
    });
    const fileId = reg.body.id;
    // 手动写入 2 次下载日志，模拟历史重命名窗口（都指向同一 file_id，用旧名）。
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const t0 = todayStart.getTime() + 1;
    const dl = db.prepare('INSERT INTO download_logs (file_id, file_name, downloaded_at) VALUES (?, ?, ?)');
    dl.run(fileId, 'old.pdf', t0);
    dl.run(fileId, 'old.pdf', t0 + 1000);

    // 通过 PATCH 改名（files 表持久名变为 new.pdf）。
    const renamed = await request('PATCH', `/api/files/${fileId}`, { token, body: { name: 'new.pdf' } });
    assert.equal(renamed.status, 200);

    const { body } = await request('GET', '/api/stats', { token });
    const row = body.top_downloads.find((r) => r.file_id === fileId);
    assert.ok(row, '改组后应有一行');
    assert.equal(row.count, 2, '改名前后共 2 次下载，聚合为一行');
    // 文件名优先取 files 表持久名 new.pdf（而非旧的 old.pdf）。
    assert.equal(row.file_name, 'new.pdf');
  });

  test('文件删除后（无 files 行）仍按 file_id 聚合，取组内最新名字，元数据不报 null 行重复', async () => {
    const token = await adminLogin();
    // 直接写入一个在 files 表中不存在（已被删除）的下载日志。
    // DB 外键为 ON，模拟「文件删除后遗留」需临时关闭外键。
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const t0 = todayStart.getTime() + 1;
    const dl = db.prepare('INSERT INTO download_logs (file_id, file_name, downloaded_at) VALUES (?, ?, ?)');
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      dl.run(777777, 'deleted-a.txt', t0);
      dl.run(777777, 'deleted-b.txt', t0 + 1000);
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }

    const { body } = await request('GET', '/api/stats', { token });
    const row = body.top_downloads.find((r) => r.file_id === 777777);
    assert.ok(row, '删除后的一行仍应出现');
    assert.equal(row.count, 2);
    // 无 files 行时取组内最新名字（deleted-b.txt 后写），而不是固定一个或 null。
    assert.equal(row.file_name, 'deleted-b.txt');
    assert.equal(row.ext, null);
    assert.equal(row.size, null);
  });

  test('保留 file_name 字段（前端兼容），字段名不变', async () => {
    const token = await adminLogin();
    const reg = await request('POST', '/api/files', {
      token,
      body: { name: 'keep.txt', oss_key: 'zyxf-test/keep.txt', size: 50, mime_type: 'text/plain' },
    });
    const fileId = reg.body.id;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    db.prepare('INSERT INTO download_logs (file_id, file_name, downloaded_at) VALUES (?, ?, ?)').run(
      fileId,
      'keep.txt',
      todayStart.getTime() + 1
    );
    const { body } = await request('GET', '/api/stats', { token });
    const row = body.top_downloads.find((r) => r.file_id === fileId);
    assert.ok(row);
    // 兼容字段：file_id / file_name / count / ext / size / folder_id 全部保留。
    assert.ok('file_id' in row && 'file_name' in row && 'count' in row && 'ext' in row && 'size' in row && 'folder_id' in row);
    assert.equal(row.file_name, 'keep.txt');
  });
});
