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

// 复用 api.test.js 的测试基建：每次清空数据，留下 admin 用户。
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

describe('BUG-08: sync 批量删除（>999 文件场景）', () => {
  test('删除超过 999 个失联文件时分批 IN 删除，不触及 SQLite 参数上限', async () => {
    const token = await adminLogin();
    // 本地登记 1200 个文件（都在 OSS 中不存在 → 应全部删除）。
    const ins = db.prepare(
      'INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, uploader, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const N = 1200;
    for (let i = 0; i < N; i++) {
      ins.run(null, `stale${i}.txt`, `zyxf-test/stale${i}.txt`, 1024, null, 'txt', null, i, Date.now());
    }
    // OSS 只剩 `keep.txt`，本地 1200 个文件全部失联 → 应全部删除，
    // 并且 keep.txt 会被当作新增文件导入（added_files = 1）。
    ossObjectStore.keys = ['zyxf-test/keep.txt'];

    const { status, body } = await request('POST', '/api/sync', { token });
    assert.equal(status, 200);
    assert.equal(body.removed.files, N);
    assert.equal(body.added.files, 1);
    // 若分批逻辑失败触及参数上限，这里会抛 500。
    assert.equal(body.ok, true);

    const remaining = db.prepare('SELECT COUNT(*) c FROM files').get().c;
    assert.equal(remaining, 1); // 仅剩新导入的 keep.txt
  });

  test('批量修复 ext 后 repaired_files 计数正确', async () => {
    const token = await adminLogin();
    const ins = db.prepare(
      'INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, uploader, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    // 模拟旧 bug：ext 存成了整个文件名。
    ins.run(null, 'a.pdf', 'zyxf-test/a.pdf', 1024, null, 'a.pdf', null, 0, Date.now());
    ins.run(null, 'b.txt', 'zyxf-test/b.txt', 1024, null, 'b.txt', null, 1, Date.now());
    ossObjectStore.keys = ['zyxf-test/a.pdf', 'zyxf-test/b.txt'];

    const { body } = await request('POST', '/api/sync', { token });
    assert.equal(body.repaired_files, 2);
    assert.equal(db.prepare("SELECT ext FROM files WHERE oss_key='zyxf-test/a.pdf'").get().ext, 'pdf');
    assert.equal(db.prepare("SELECT ext FROM files WHERE oss_key='zyxf-test/b.txt'").get().ext, 'txt');
  });

  test('sync 响应结构与统计在批量后保持一致（scanned/added/removed/repaired_files）', async () => {
    const token = await adminLogin();
    ossObjectStore.keys = [
      'zyxf-test/课程/高数.pdf',
      'zyxf-test/课程/图书/作业.txt',
      'zyxf-test/new.txt',
    ];
    const { body } = await request('POST', '/api/sync', { token });
    assert.deepEqual(body.added, { folders: 2, files: 3 });
    assert.deepEqual(body.removed, { folders: 0, files: 0 });
    assert.equal(body.scanned, 3);
    assert.equal(typeof body.repaired_files, 'number');
    assert.equal(body.ok, true);
  });

  // IMPROVE-13：导入前一次性建「父级 → 清洗后段名 → id」内存索引。索引必须
  // 以**父级**为键登记新建行，否则同一层的文件夹会被重复创建（每个对象各建一份）。
  test('同一目录下多个对象只建一个文件夹，新链自动复用', async () => {
    const token = await adminLogin();
    const keys = [];
    for (let i = 0; i < 30; i++) keys.push(`zyxf-test/课程/图书/doc${i}.txt`);
    keys.push('zyxf-test/课程/图书/'); // 该目录的占位对象
    keys.push('zyxf-test/课程/试卷/exam.txt');
    ossObjectStore.keys = keys;

    const { body } = await request('POST', '/api/sync', { token });
    assert.equal(body.added.folders, 3); // 课程 / 课程·图书 / 课程·试卷
    assert.equal(body.added.files, 31);

    const rows = db.prepare('SELECT id, name, parent_id FROM folders ORDER BY id').all();
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.name), ['课程', '图书', '试卷']);
    assert.equal(rows[0].parent_id, null);
    // 两个子目录都挂在「课程」下，且不存在重复的「课程」
    assert.equal(rows[1].parent_id, rows[0].id);
    assert.equal(rows[2].parent_id, rows[0].id);
  });
});
