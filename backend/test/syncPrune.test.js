import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { request, adminToken, setBaseUrl, clearLibraryTables } from './helpers.js';
import { app } from '../src/index.js';
import { ossObjectStore } from './setup.js';
import { placeholderKeyForFolder } from '../src/storagePath.js';

// IMPROVE-26（issue #55）：剪枝原先只从 parent_id IS NULL 的顶层开始判活，顶层活着就完全
// 不往下走 —— 挂在活根下面的「死」文件夹（子树里既没有文件、也没有 OSS 占位对象）永远
// 收不回来，只能一直挂在侧边栏上。现在逐节点后序遍历 + 年龄闸门 + dry_run 干跑。
//
// 判活规则没变：子树里有文件 / 有活着的子节点 / OSS 里有自己的占位对象（`<路径>/` 空对象）。
// 所以「界面里建的空文件夹」永远是活的（建的时候后端会写占位对象），不会被刷新吃掉。
let server;

before(async () => {
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  setBaseUrl(`http://127.0.0.1:${server.address().port}`);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  clearLibraryTables(db);
  ossObjectStore.keys = [];
});

afterEach(() => {
  delete process.env.FOLDER_PRUNE_MIN_AGE_DAYS;
});

const DAY = 24 * 60 * 60 * 1000;
const OLD = Date.now() - 30 * DAY; // 30 天前 → 越过默认闸门

function insertFolder(name, parentId = null, createdAt = OLD) {
  return db
    .prepare('INSERT INTO folders (name, parent_id, created_at) VALUES (?, ?, ?)')
    .run(name, parentId, createdAt).lastInsertRowid;
}

function insertFile(name, folderId, ossKey) {
  return db
    .prepare(
      `INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, created_at)
       VALUES (?, ?, ?, 10, NULL, NULL, ?)`
    )
    .run(folderId, name, ossKey, OLD).lastInsertRowid;
}

const folderIds = () => db.prepare('SELECT id FROM folders ORDER BY id').all().map((r) => r.id);
const sync = (token, qs = '') => request('POST', `/api/sync${qs}`, { token });

describe('IMPROVE-26: 活根下的死文件夹会被回收', () => {
  test('活根下的死子目录（含更深一层）被剪掉，活根本身保留', async () => {
    process.env.FOLDER_PRUNE_MIN_AGE_DAYS = '0';
    const token = await adminToken();
    const keep = insertFolder('keep');
    const stale = insertFolder('stale', keep);
    const deep = insertFolder('deep', stale);
    insertFile('a.pdf', keep, 'zyxf-test/keep/a.pdf');
    // OSS 里只有 keep 的文件与 keep 自己的占位对象：stale / deep 一点痕迹都没有
    ossObjectStore.keys = ['zyxf-test/keep/a.pdf', placeholderKeyForFolder(db, keep)];

    const r = await sync(token);

    assert.equal(r.status, 200);
    assert.equal(r.body.removed.folders, 2);
    assert.deepEqual(r.body.removed.folder_paths.sort(), ['keep/stale', 'keep/stale/deep']);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM folders WHERE id IN (?, ?)').get(stale, deep).c, 0);
    assert.ok(db.prepare('SELECT id FROM folders WHERE id = ?').get(keep), '活根必须保留');
    // 被剪的子树里本来就没有文件 → files 行不受 CASCADE 影响
    assert.equal(db.prepare('SELECT COUNT(*) c FROM files').get().c, 1);
  });

  test('整棵死树（含根）仍然整棵回收（原行为保持）', async () => {
    process.env.FOLDER_PRUNE_MIN_AGE_DAYS = '0';
    const token = await adminToken();
    const deadRoot = insertFolder('deadRoot');
    insertFolder('child', deadRoot);
    ossObjectStore.keys = ['zyxf-test/alive.pdf']; // 列表非空即可，与本库无关

    const r = await sync(token);

    assert.equal(r.body.removed.folders, 2);
    assert.deepEqual(folderIds(), []);
    assert.ok(r.body.removed.folder_paths.includes('deadRoot'));
    assert.ok(r.body.removed.folder_paths.includes('deadRoot/child'));
  });
});

describe('IMPROVE-26: 什么算「活」，绝不误删', () => {
  test('空但有占位对象的文件夹算活：刷新不会吃掉刚建好还没上传的目录', async () => {
    process.env.FOLDER_PRUNE_MIN_AGE_DAYS = '0';
    const token = await adminToken();
    const empty = insertFolder('empty');
    ossObjectStore.keys = [placeholderKeyForFolder(db, empty)];

    const r = await sync(token);

    assert.equal(r.body.removed.folders, 0);
    assert.ok(db.prepare('SELECT id FROM folders WHERE id = ?').get(empty));
  });

  test('子树里有文件就是活：父目录与祖先都不剪（CASCADE 波及不到文件行）', async () => {
    process.env.FOLDER_PRUNE_MIN_AGE_DAYS = '0';
    const token = await adminToken();
    const root = insertFolder('root');
    const mid = insertFolder('mid', root);
    const leaf = insertFolder('leaf', mid);
    insertFile('deep.pdf', leaf, 'zyxf-test/root/mid/leaf/deep.pdf');
    ossObjectStore.keys = ['zyxf-test/root/mid/leaf/deep.pdf']; // 一个占位对象都没有

    const r = await sync(token);

    assert.equal(r.body.removed.folders, 0);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM folders').get().c, 3);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM files').get().c, 1);
  });

  test('默认闸门（7 天）下，刚建的死目录先留着，由运维看过再处理', async () => {
    const token = await adminToken();
    const keep = insertFolder('keep', null, Date.now());
    const fresh = insertFolder('fresh', keep, Date.now() - 60 * 1000);
    ossObjectStore.keys = [placeholderKeyForFolder(db, keep)];

    const r = await sync(token);

    assert.equal(r.body.prune_min_age_days, 7);
    assert.equal(r.body.removed.folders, 0);
    assert.ok(db.prepare('SELECT id FROM folders WHERE id = ?').get(fresh), '未过闸门的目录应保留');
  });

  test('OSS 列表为空时一律不删（桶配错/打包失败的兜底仍然生效）', async () => {
    process.env.FOLDER_PRUNE_MIN_AGE_DAYS = '0';
    const token = await adminToken();
    insertFolder('deadRoot');
    ossObjectStore.keys = [];

    const r = await sync(token);

    assert.equal(r.body.removed.folders, 0);
    assert.equal(folderIds().length, 1);
  });
});

describe('IMPROVE-26: dry_run 干跑', () => {
  test('?dry_run=1 只报告将会发生的变化，一个字节都不落库', async () => {
    process.env.FOLDER_PRUNE_MIN_AGE_DAYS = '0';
    const token = await adminToken();
    const keep = insertFolder('keep');
    const staleFolder = insertFolder('stale', keep);
    const staleFile = insertFile('gone.pdf', keep, 'zyxf-test/keep/gone.pdf');
    ossObjectStore.keys = [placeholderKeyForFolder(db, keep)];

    const r = await sync(token, '?dry_run=1');

    assert.equal(r.status, 200);
    assert.equal(r.body.dry_run, true);
    assert.equal(r.body.removed.files, 1); // gone.pdf 在 OSS 里没了
    assert.equal(r.body.removed.folders, 1);
    assert.deepEqual(r.body.removed.folder_paths, ['keep/stale']);

    // 库完全没动
    assert.ok(db.prepare('SELECT id FROM files WHERE id = ?').get(staleFile));
    assert.ok(db.prepare('SELECT id FROM folders WHERE id = ?').get(staleFolder));
    assert.equal(db.prepare('SELECT COUNT(*) c FROM folders').get().c, 2);
  });

  test('干跑同样会报告「将会新增」的行，且不写入', async () => {
    const token = await adminToken();
    ossObjectStore.keys = ['zyxf-test/newsub/x.pdf'];

    const r = await sync(token, '?dry_run=1');

    assert.equal(r.body.dry_run, true);
    assert.equal(r.body.added.folders, 1); // newsub
    assert.equal(r.body.added.files, 1);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM folders').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM files').get().c, 0);
  });

  test('干跑之后正常同步仍能真正落库（回滚没有留下半成品状态）', async () => {
    const token = await adminToken();
    ossObjectStore.keys = ['zyxf-test/newsub/x.pdf'];

    await sync(token, '?dry_run=1');
    const r = await sync(token);

    assert.equal(r.body.dry_run, false);
    assert.equal(r.body.added.folders, 1);
    assert.equal(r.body.added.files, 1);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM folders').get().c, 1);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM files').get().c, 1);
    // 本次刚导入的目录不该被同一轮剪掉（它活着：子树里有文件）
    assert.equal(r.body.removed.folders, 0);
  });
});
