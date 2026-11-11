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

  test('文件被删除后从榜单消失，但下载历史保留（#87）', async () => {
    const token = await adminLogin();
    const reg = await request('POST', '/api/files', {
      token,
      body: { name: 'gone.txt', oss_key: 'zyxf-test/gone.txt', size: 10, mime_type: 'text/plain' },
    });
    const fileId = reg.body.id;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const t0 = todayStart.getTime() + 1;
    db.prepare(
      'INSERT INTO download_logs (file_id, file_name, oss_key, downloaded_at) VALUES (?, ?, ?, ?)'
    ).run(fileId, 'gone.txt', 'zyxf-test/gone.txt', t0);

    const del = await request('DELETE', `/api/files/${fileId}`, { token });
    assert.equal(del.status, 200);

    // 历史行不能被级联删除：外键改成 ON DELETE SET NULL，file_id 置空、快照保留
    const log = db
      .prepare('SELECT file_id, file_name, oss_key FROM download_logs WHERE file_name = ?')
      .get('gone.txt');
    assert.ok(log, '下载历史应保留，而不是随文件删除');
    assert.equal(log.file_id, null);
    assert.equal(log.oss_key, 'zyxf-test/gone.txt');

    const { body } = await request('GET', '/api/stats', { token });
    assert.equal(body.total_downloads, 1, '累计下载不因删文件而减少');
    assert.equal(body.top_downloads.filter((r) => r.file_id === fileId).length, 0, '已删文件不再进榜');
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

/* recent_downloads = 近期下载卡（原「热门文件夹」）：按文件去重、取每个文件最近一次下载、
   按该时间倒序、最多 8 个。 */
describe('recent_downloads 按文件去重取最近一次', () => {
  const t0 = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() + 1;
  };
  const logDownload = (fileId, name, at) =>
    db
      .prepare('INSERT INTO download_logs (file_id, file_name, downloaded_at) VALUES (?, ?, ?)')
      .run(fileId, name, at);
  const mkFile = async (token, name, size = 100) => {
    const reg = await request('POST', '/api/files', {
      token,
      body: { name, oss_key: `zyxf-test/${name}`, size, mime_type: 'text/plain' },
    });
    assert.equal(reg.status, 200, `登记文件失败：${JSON.stringify(reg.body)}`);
    return reg.body.id;
  };

  test('同一文件多次下载只出现一行，时间取最近一次', async () => {
    const token = await adminLogin();
    const id = await mkFile(token, 'dup.txt');
    const t = t0();
    logDownload(id, 'dup.txt', t + 1000);
    logDownload(id, 'dup.txt', t + 5000); // 最近一次
    logDownload(id, 'dup.txt', t + 3000);

    const { body } = await request('GET', '/api/stats', { token });
    const rows = body.recent_downloads.filter((r) => r.id === id);
    assert.equal(rows.length, 1, '同一文件去重为一行');
    assert.equal(rows[0].downloaded_at, t + 5000, '取该文件最近一次下载时间');
  });

  test('按最近下载时间倒序，最多 8 个文件', async () => {
    const token = await adminLogin();
    const t = t0();
    for (let i = 1; i <= 10; i++) {
      const id = await mkFile(token, `f${i}.txt`, i);
      logDownload(id, `f${i}.txt`, t + i * 1000); // f10 最新
    }

    const { body } = await request('GET', '/api/stats', { token });
    assert.equal(body.recent_downloads.length, 8, '最多返回 8 个文件');
    assert.deepEqual(
      body.recent_downloads.map((r) => r.name),
      ['f10.txt', 'f9.txt', 'f8.txt', 'f7.txt', 'f6.txt', 'f5.txt', 'f4.txt', 'f3.txt']
    );
    // 与 recent_uploads 同形：id / name / ext / size / folder_id + 时间字段
    const row = body.recent_downloads[0];
    assert.ok('id' in row && 'name' in row && 'ext' in row && 'size' in row && 'folder_id' in row);
    assert.equal(row.size, 10);
  });

  test('文件改名后取 files 表持久名，而不是日志里的旧名', async () => {
    const token = await adminLogin();
    const id = await mkFile(token, 'old.txt');
    logDownload(id, 'old.txt', t0());

    const renamed = await request('PATCH', `/api/files/${id}`, { token, body: { name: 'new.txt' } });
    assert.equal(renamed.status, 200);

    const { body } = await request('GET', '/api/stats', { token });
    const row = body.recent_downloads.find((r) => r.id === id);
    assert.ok(row);
    assert.equal(row.name, 'new.txt');
  });

  test('文件被删除后不再出现在近期下载，历史只计入累计（#87）', async () => {
    const token = await adminLogin();
    const id = await mkFile(token, 'gone-recent.txt');
    const t = t0();
    logDownload(id, 'gone-recent.txt', t);

    const del = await request('DELETE', `/api/files/${id}`, { token });
    assert.equal(del.status, 200);

    const { body } = await request('GET', '/api/stats', { token });
    assert.equal(body.recent_downloads.filter((r) => r.id === id).length, 0, '已删文件不进「近期下载」');
    assert.equal(body.total_downloads, 1, '但那次下载仍留在累计里');
  });

  test('没有任何下载记录时返回空数组（前端显示「暂无数据」）', async () => {
    const token = await adminLogin();
    await mkFile(token, 'never-downloaded.txt');
    const { body } = await request('GET', '/api/stats', { token });
    assert.deepEqual(body.recent_downloads, []);
  });
});
