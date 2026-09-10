// 覆盖本轮全仓审计中已修复的后端缺陷（逐条对应 BUG-39 起的编号，见 docs/ISSUES.md）。
// 保留原测试文件不动，新的回归集中在这里，便于「一条发现一个用例」地回溯。
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { app } from '../src/index.js';
import { mimeOf } from '../src/mime.js';
import { ALLOWED_EXTS, isExtAllowed } from '../src/extPolicy.js';
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

async function adminToken() {
  const { body } = await request('POST', '/api/auth/login', {
    body: { username: 'admin', password: 'admin123' },
  });
  return body.token;
}

function insertFolder(name, parentId = null) {
  return db
    .prepare('INSERT INTO folders (name, parent_id, sort_order, created_at) VALUES (?, ?, 0, ?)')
    .run(name, parentId, Date.now()).lastInsertRowid;
}

function insertFile({ name, folderId = null, ossKey, ext, size = 100 }) {
  return db
    .prepare(
      'INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(folderId, name, ossKey, size, mimeOf(ext), ext, Date.now()).lastInsertRowid;
}

describe('审计修复：搜索查询长度上限（匿名 DoS）', () => {
  test('超长 q 返回 400，正常长度仍然可用', async () => {
    const tooLong = await request('GET', `/api/search?q=${'a'.repeat(200)}`);
    assert.equal(tooLong.status, 400);

    const ok = await request('GET', '/api/search?q=gaoshu');
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.body.folders) && Array.isArray(ok.body.files));
  });

  test('边界：恰好 64 字符放行，65 字符拒绝', async () => {
    assert.equal((await request('GET', `/api/search?q=${'a'.repeat(64)}`)).status, 200);
    assert.equal((await request('GET', `/api/search?q=${'a'.repeat(65)}`)).status, 400);
  });
});

describe('审计修复：contents 的 sort 白名单不再是原型链查找', () => {
  test('sort=constructor 等原型键回退默认排序而不是 500', async () => {
    insertFolder('甲乙');
    insertFolder('丙丁');
    for (const key of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      const r = await request('GET', `/api/folders/0/contents?sort=${key}`);
      assert.equal(r.status, 200, `sort=${key} 不应 500`);
      assert.equal(r.body.folders.length, 2);
    }
  });

  test('未知 sort 回退为名称排序', async () => {
    insertFolder('b');
    insertFolder('a');
    const r = await request('GET', '/api/folders/0/contents?sort=不存在的字段');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.folders.map((f) => f.name), ['a', 'b']);
  });
});

describe('审计修复：DELETE 文件夹的存在性与伪键清理', () => {
  test('删除不存在的文件夹返回 404，而不是 200 + removed_files 虚报', async () => {
    const token = await adminToken();
    const r = await request('DELETE', '/api/folders/999999', { token });
    assert.equal(r.status, 404);
  });

  test('删除真实文件夹时计数只含真实文件', async () => {
    const token = await adminToken();
    const fid = insertFolder('数学');
    insertFile({ name: 'a.pdf', folderId: fid, ossKey: 'zyxf-test/数学/a.pdf', ext: 'pdf' });
    insertFile({ name: 'b.pdf', folderId: fid, ossKey: 'zyxf-test/数学/b.pdf', ext: 'pdf' });
    const r = await request('DELETE', `/api/folders/${fid}`, { token });
    assert.equal(r.status, 200);
    // 2 个文件 + 1 个文件夹占位键 = 3（占位键来自真实存在的 folderMap 项）
    assert.equal(r.body.removed_files, 3);
  });
});

describe('审计修复：文件名不允许路径分隔符', () => {
  test('含 / 或 \\ 的文件名在 upload-url 阶段就被拒', async () => {
    const token = await adminToken();
    for (const name of ['a/b.pdf', 'a\\b.pdf']) {
      const r = await request('POST', '/api/files/upload-url', { token, body: { filename: name } });
      assert.equal(r.status, 400, `${name} 应被拒绝`);
      assert.match(r.body.error, /路径分隔符/);
    }
  });
});

describe('审计修复：文件移动补 key 冲突检查（防覆盖他人对象）', () => {
  test('目标 key 已被别的文件占用时返回 409 而不是覆盖后 500', async () => {
    const token = await adminToken();
    const fid = insertFolder('目标目录');
    // 目录内已有 a-b.pdf（key 归一化后为 …/a-b.pdf）
    insertFile({ name: 'a-b.pdf', folderId: fid, ossKey: 'zyxf-test/目标目录/a-b.pdf', ext: 'pdf' });
    // 历史脏数据：名叫 a/b.pdf 的文件，key 与上面相同（分隔符被归一化成 '-'）
    const dirty = insertFile({ name: 'a/b.pdf', folderId: null, ossKey: 'zyxf-test/a-b.pdf', ext: 'pdf' });

    const r = await request('PATCH', `/api/files/${dirty}`, { token, body: { folder_id: fid } });
    assert.equal(r.status, 409, '应因存储路径冲突而拒绝');
    // 原行未被改动，仍留在根目录
    const row = db.prepare('SELECT folder_id, oss_key FROM files WHERE id = ?').get(dirty);
    assert.equal(row.folder_id, null);
    assert.equal(row.oss_key, 'zyxf-test/a-b.pdf');
  });
});

describe('审计修复：cleanup-upload 的边界', () => {
  test('前缀外的 key 被拒；被 files 行引用的 key 被拒', async () => {
    const token = await adminToken();
    const outside = await request('POST', '/api/files/cleanup-upload', {
      token,
      body: { oss_key: 'other-app/secret.pdf' },
    });
    assert.equal(outside.status, 400);

    insertFile({ name: 'live.pdf', ossKey: 'zyxf-test/live.pdf', ext: 'pdf' });
    const referenced = await request('POST', '/api/files/cleanup-upload', {
      token,
      body: { oss_key: 'zyxf-test/live.pdf' },
    });
    assert.equal(referenced.status, 409);

    const orphan = await request('POST', '/api/files/cleanup-upload', {
      token,
      body: { oss_key: 'zyxf-test/orphan.pdf' },
    });
    assert.equal(orphan.status, 200);
  });
});

describe('审计修复：搜索快照缓存的写路径失效', () => {
  test('注册文件后立即可被搜索到（缓存被写路径清掉）', async () => {
    const token = await adminToken();
    const prev = process.env.NODE_ENV;
    // searchService 的缓存只在非 test 环境启用，这里临时切到生产口径来验证失效接线。
    process.env.NODE_ENV = 'production';
    try {
      const before = await request('GET', '/api/search?q=auditcache');
      assert.equal(before.body.files.length, 0, '前置：空库搜不到');

      const reg = await request('POST', '/api/files', {
        token,
        body: {
          name: 'auditcache.pdf',
          folder_id: null,
          oss_key: 'zyxf-test/auditcache.pdf',
          size: 100,
        },
      });
      assert.equal(reg.status, 200);

      const after = await request('GET', '/api/search?q=auditcache');
      assert.equal(after.body.files.length, 1, '新文件必须立刻可搜（缓存已失效）');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('审计修复：sync 的 repaired 与 removed 不再指向同一批记录', () => {
  test('将被删除的失联行不计入 repaired_files', async () => {
    // 桶里只剩 keep.pdf；gone.pdf 的行会被清理
    ossObjectStore.keys = ['zyxf-test/keep.pdf'];
    insertFile({ name: 'keep.pdf', ossKey: 'zyxf-test/keep.pdf', ext: 'wrong' });
    insertFile({ name: 'gone.pdf', ossKey: 'zyxf-test/gone.pdf', ext: 'wrong' });

    const r = await request('POST', '/api/sync');
    assert.equal(r.status, 200);
    assert.equal(r.body.removed.files, 1, 'gone.pdf 应被清理');
    assert.equal(r.body.repaired_files, 1, '只有存活的 keep.pdf 计入修复');
    assert.equal(db.prepare("SELECT COUNT(*) c FROM files WHERE ext = 'wrong'").get().c, 0);
  });
});

describe('审计修复：MIME 表覆盖全部白名单扩展名', () => {
  test('ALLOWED_EXTS 中每个扩展名都能派生出 MIME', () => {
    const missing = [...ALLOWED_EXTS].filter((e) => mimeOf(e) === null);
    assert.deepEqual(missing, [], `缺 MIME 映射: ${missing.join(', ')}`);
  });
});

describe('审计修复：宏格式扩展名一律拒绝', () => {
  test('ppsm 及同族宏格式均不在白名单内', () => {
    for (const ext of ['ppsm', 'pptm', 'potm', 'docm', 'dotm', 'xlsm', 'xltm', 'ppam']) {
      assert.ok(!isExtAllowed(ext), `${ext} 是宏格式，必须被拒绝`);
      assert.ok(!ALLOWED_EXTS.has(ext), `${ext} 不应出现在 ALLOWED_EXTS`);
    }
  });
});

describe('审计修复：reorder 条目数量上限', () => {
  test('超长 order 返回 400，不再同步逐项校验/写库', async () => {
    const token = await adminToken();
    const order = Array.from({ length: 2001 }, (_, i) => ({ type: 'file', id: i + 1 }));
    const r = await request('POST', '/api/folders/reorder', { token, body: { parent_folder_id: null, order } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /过长/);
  });
});

describe('审计修复：保留文件夹名 .preview', () => {
  test('创建与改名都不允许使用保留名', async () => {
    const token = await adminToken();
    const created = await request('POST', '/api/folders', { token, body: { name: '.preview' } });
    assert.equal(created.status, 400);
    assert.match(created.body.error, /保留名称/);

    const fid = insertFolder('正常目录');
    const renamed = await request('PATCH', `/api/folders/${fid}`, { token, body: { name: '.preview' } });
    assert.equal(renamed.status, 400);

    // 大小写不同也算保留名
    const upper = await request('POST', '/api/folders', { token, body: { name: '.PREVIEW' } });
    assert.equal(upper.status, 400);
  });
});

describe('审计修复：统计接口的支撑索引已建立', () => {
  test('files(created_at) 与 download_logs(file_id, downloaded_at) 索引存在', () => {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((r) => r.name);
    assert.ok(names.includes('idx_files_created'), '缺 idx_files_created');
    assert.ok(names.includes('idx_download_logs_file'), '缺 idx_download_logs_file');
  });
});
