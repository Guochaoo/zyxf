// 覆盖本轮全仓审计中已修复的后端缺陷（逐条对应 BUG-39 起的编号；该编号体系随 ISSUES.md 于 2026-09-20 迁到 GitHub Issues）。
// 保留原测试文件不动，新的回归集中在这里，便于「一条发现一个用例」地回溯。
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { request, adminToken, setBaseUrl, clearLibraryTables } from './helpers.js';
import { app } from '../src/index.js';
import { mimeOf } from '../src/mime.js';
import { MAX_SUBTREE_MOVE_ITEMS } from '../src/services/folders.js';
import { ALLOWED_EXTS, isExtAllowed } from '../src/extPolicy.js';
import { ossObjectStore } from './setup.js';

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

describe('审计修复：cleanup-upload 不得越出 OSS_KEY_PREFIX（`..` 段）', () => {
  test('前缀内的正常 key 仍可清理（best-effort 行为不变）', async () => {
    const token = await adminToken();
    ossObjectStore.keys = ['zyxf-test/x/leaf.txt'];
    const r = await request('POST', '/api/files/cleanup-upload', {
      token,
      body: { oss_key: 'zyxf-test/x/leaf.txt' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });

  test('含 `..` / `.` 段的 key 一律 400（即使字符串层面以 prefix 开头）', async () => {
    const token = await adminToken();
    for (const key of [
      'zyxf-test/../otherapp/secret.txt',
      'zyxf-test/./a.txt',
      'zyxf-test/a/../../b.txt',
    ]) {
      const r = await request('POST', '/api/files/cleanup-upload', { token, body: { oss_key: key } });
      assert.equal(r.status, 400, `${key} 应被拒绝`);
    }
  });
});

describe('审计修复：文件夹名里的点段被清洗（不产生可越前缀的 key）', () => {
  test('新建名为 `..` 的文件夹后，其下文件的 oss_key 仍在 prefix 内', async () => {
    const token = await adminToken();
    const dir = await request('POST', '/api/folders', { token, body: { name: '..', parent_id: null } });
    assert.equal(dir.status, 200);
    const up = await request('POST', '/api/files/upload-url', {
      token,
      body: { filename: 'x.pdf', folder_id: dir.body.id },
    });
    assert.equal(up.status, 200);
    assert.ok(!up.body.key.split('/').includes('..'), `key 含点段: ${up.body.key}`);
    assert.ok(up.body.key.startsWith('zyxf-test/'), up.body.key);
  });
});

describe('审计修复：contents 的 sort 白名单不再是原型链查找', () => {  test('sort=constructor 等原型键回退默认排序而不是 500', async () => {
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

describe('审计修复：upload-url 按 OSS key 预检同名（防覆盖既有对象内容）', () => {
  test('NFC 已存在时，用 NFD 写法申请上传被 409 拒绝', async () => {
    const token = await adminToken();
    const nfc = 'caf\u00e9.pdf'; // é = U+00E9
    const nfd = 'cafe\u0301.pdf'; // e + U+0301
    assert.notEqual(nfc, nfd); // 字节层面确实不同，SQL 的 name 等值比较拦不住
    insertFile({ name: nfc, ossKey: 'zyxf-test/caf\u00e9.pdf', ext: 'pdf' });

    const r = await request('POST', '/api/files/upload-url', { token, body: { filename: nfd } });
    assert.equal(r.status, 409);
    // 关键：不能把既有对象的 key 发回给浏览器（否则直传会覆盖它的内容）
    assert.equal(r.body.key, undefined);
  });

  test('清洗后等价的段名同样被拦（同级 `_` 与 `.` 都映射为 `_`）', async () => {
    const token = await adminToken();
    const fid = insertFolder('_');
    insertFile({ name: 'x.pdf', folderId: fid, ossKey: 'zyxf-test/_/x.pdf', ext: 'pdf' });
    const r = await request('POST', '/api/files/upload-url', {
      token,
      body: { filename: 'x.pdf', folder_id: fid },
    });
    assert.equal(r.status, 409);
  });
});

describe('审计修复：PATCH 空 body 不得被当成「移动到根」', () => {
  test('空 body / 全是未知字段时返回 400，且文件夹位置不变', async () => {
    const token = await adminToken();
    const parent = insertFolder('父级');
    const child = insertFolder('子级', parent);

    for (const body of [{}, { foo: 1 }]) {
      const r = await request('PATCH', `/api/folders/${child}`, { token, body });
      assert.equal(r.status, 400, `body=${JSON.stringify(body)} 应被拒绝`);
    }
    assert.equal(db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(child).parent_id, parent);
  });

  test('文件 PATCH 空 body 同样 400', async () => {
    const token = await adminToken();
    const id = insertFile({ name: 'a.pdf', ossKey: 'zyxf-test/a.pdf', ext: 'pdf' });
    const r = await request('PATCH', `/api/files/${id}`, { token, body: {} });
    assert.equal(r.status, 400);
  });
});

describe('审计修复：文件夹 PATCH 的校验与写库在同一事务内（BUG-54）', () => {
  test('并发互相移动不会写出 parent 环', async () => {
    const token = await adminToken();
    const a = insertFolder('A');
    const b = insertFolder('B');

    // 两个请求都基于「A、B 都是根级」的同一快照，各自把对方设为自己的父级。
    const [ra, rb] = await Promise.all([
      request('PATCH', `/api/folders/${a}`, { token, body: { parent_id: b } }),
      request('PATCH', `/api/folders/${b}`, { token, body: { parent_id: a } }),
    ]);
    // 至少一个必须失败（400/409），否则就成环
    const failed = [ra, rb].filter((r) => r.status !== 200);
    assert.ok(failed.length >= 1, `两个请求都成功了：${ra.status}/${rb.status}`);

    // 断言树里不存在环：从任意节点向上走不会回到自己
    for (const start of [a, b]) {
      const seen = new Set();
      let cur = start;
      while (cur != null) {
        assert.ok(!seen.has(cur), `节点 ${start} 向上遍历成环`);
        seen.add(cur);
        cur = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(cur)?.parent_id ?? null;
      }
    }
  });

  test('并发移动到同一根级位置时不会出现同名文件夹', async () => {
    const token = await adminToken();
    const p = insertFolder('父');
    const x = insertFolder('X', p);
    const y = insertFolder('Y', p);

    const [rx, ry] = await Promise.all([
      request('PATCH', `/api/folders/${x}`, { token, body: { name: '重名' } }),
      request('PATCH', `/api/folders/${y}`, { token, body: { name: '重名' } }),
    ]);
    const okCount = [rx, ry].filter((r) => r.status === 200).length;
    assert.equal(okCount, 1, `应只有一个成功：${rx.status}/${ry.status}`);
    const dup = db
      .prepare("SELECT COUNT(*) c FROM folders WHERE parent_id = ? AND name = '重名'")
      .get(p).c;
    assert.equal(dup, 1);
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

describe('IMPROVE-15：目录树快照缓存与写路径失效', () => {
  test('生产口径下命中缓存，但写操作后立刻反映新数据', async () => {
    const token = await adminToken();
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // 树缓存只在非 test 环境启用
    try {
      insertFolder('缓存前');
      const first = await request('GET', '/api/folders/tree');
      assert.deepEqual(first.body.tree.map((f) => f.name), ['缓存前']);

      // 绕过路由直接改库：缓存未失效 → 仍返回旧快照（证明缓存确实生效）
      insertFolder('直插不失效');
      const cached = await request('GET', '/api/folders/tree');
      assert.deepEqual(cached.body.tree.map((f) => f.name), ['缓存前']);

      // 走路由创建 → 写路径调 invalidateLibraryCaches → 立刻可见
      const created = await request('POST', '/api/folders', { token, body: { name: '新建', parent_id: null } });
      assert.equal(created.status, 200);
      const fresh = await request('GET', '/api/folders/tree');
      assert.ok(fresh.body.tree.some((f) => f.name === '新建'), '新建的文件夹必须立刻出现在目录树里');
      assert.ok(fresh.body.tree.some((f) => f.name === '直插不失效'), '缓存已整体失效，直插的行也应可见');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('IMPROVE-20：搜索结果带截断标志', () => {
  test('命中超过每类上限时 truncated=true，且两类各自最多 20 条', async () => {
    for (let i = 0; i < 25; i++) {
      insertFile({ name: `trunc${i}.pdf`, ossKey: `zyxf-test/trunc${i}.pdf`, ext: 'pdf' });
    }
    const r = await request('GET', '/api/search?q=trunc');
    assert.equal(r.status, 200);
    assert.equal(r.body.files.length, 20, '每类最多 20 条');
    assert.equal(r.body.truncated, true);
  });

  test('未截断时 truncated=false；空查询结构一致', async () => {
    insertFile({ name: 'only.pdf', ossKey: 'zyxf-test/only.pdf', ext: 'pdf' });
    const one = await request('GET', '/api/search?q=only');
    assert.equal(one.body.truncated, false);
    assert.equal(one.body.files.length, 1);

    const empty = await request('GET', '/api/search?q=');
    assert.deepEqual(empty.body, { folders: [], files: [], truncated: false });
  });
});

describe('IMPROVE-17：子树搬迁的规模阈值', () => {
  test('超过阈值时 409 且不写库；阈值内仍可正常改名', async () => {
    const token = await adminToken();
    const parent = insertFolder('容量测试');
    // 阈值内：2 个文件 + 1 个文件夹 = 3 项，正常改名
    insertFile({ name: 'a.pdf', folderId: parent, ossKey: 'zyxf-test/容量测试/a.pdf', ext: 'pdf' });
    insertFile({ name: 'b.pdf', folderId: parent, ossKey: 'zyxf-test/容量测试/b.pdf', ext: 'pdf' });
    const ok = await request('PATCH', `/api/folders/${parent}`, { token, body: { name: '改过了' } });
    assert.equal(ok.status, 200);
    assert.equal(db.prepare('SELECT name FROM folders WHERE id = ?').get(parent).name, '改过了');

    // 构造超过阈值的子树
    const big = insertFolder('大目录', null);
    const ins = db.prepare(
      'INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, created_at) VALUES (?, ?, ?, 10, ?, ?, ?)'
    );
    const N = MAX_SUBTREE_MOVE_ITEMS + 1;
    for (let i = 0; i < N; i++) {
      ins.run(big, `f${i}.pdf`, `zyxf-test/大目录/f${i}.pdf`, mimeOf('pdf'), 'pdf', Date.now());
    }
    const rejected = await request('PATCH', `/api/folders/${big}`, { token, body: { name: '不该成功' } });
    assert.equal(rejected.status, 409);
    assert.equal(db.prepare('SELECT name FROM folders WHERE id = ?').get(big).name, '大目录');
    // 移动分支同样受限
    const moved = await request('PATCH', `/api/folders/${big}`, { token, body: { parent_id: parent } });
    assert.equal(moved.status, 409);
    assert.equal(db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(big).parent_id, null);
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
