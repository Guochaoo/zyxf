// IMPROVE-58 第 5 组（次要缺口·后端）：文件改名路径中「新旧 OSS key 相同」的分支
// （copyUpdateDelete 的 deleteOld === false）。NFC/NFD 两种写法的名字经
// cleanObjectSegment 会落到同一个 key，改名时若照常删旧 key，删掉的就是真身。
import { describe, test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
// ?real=1 绕开 setup.js 注册的 oss 模块 mock（module id 不同），拿真实导出做底子。
import * as realOss from '../src/oss.js?real=1';
import { db } from '../src/db.js';
import { request, adminToken, setBaseUrl, clearLibraryTables } from './helpers.js';
import { objectKeyForFile } from '../src/storagePath.js';

// setup.js 把 deleteOssObjectIfExists 换成了 no-op——「少传 deleteOld 参数」（默认 true，
// 于是对同一个 key 调删除）这种回归在那里完全静默，用例区分不出来。这里 reset 掉共享
// mock 再重挂一份**记账**的 OSS stub，使「删没删、搬没搬」变成可断言的事实。
// 必须在导入 src/index.js（→ routes/files.js → oss.js）之前重挂，故用动态导入。
mock.reset();
const ossCalls = { copied: [], deleted: [] };
mock.module('../src/oss.js', {
  exports: {
    ...realOss,
    listOssObjects: async () => [],
    copyOssObject: async (from, to) => {
      ossCalls.copied.push([from, to]);
    },
    putEmptyOssObject: async () => {},
    deleteOssObjectIfExists: async (key) => {
      ossCalls.deleted.push(key);
    },
  },
});
const { app } = await import('../src/index.js');

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
  ossCalls.copied.length = 0;
  ossCalls.deleted.length = 0;
  clearLibraryTables(db);
});

const NFD_NAME = 'caf\u00e9.pdf'.normalize('NFD');
const NFC_NAME = 'caf\u00e9.pdf'.normalize('NFC');

// 上传/改名都会把 name 归一化成 NFC，库里造不出 NFD 名，只能直接落库模拟
// 「外部导入/historical」的 NFD 行：它的 oss_key 就是 NFC 写法算出来的那个 key。
// 文件行：oss_key 由 objectKeyForFile 按 name 算出（NFD/NFC 同 key 场景）
function seedFileWithKeyFromName(name) {
  const key = objectKeyForFile(db, null, name);
  const id = db
    .prepare(
      `INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, created_at)
       VALUES (NULL, ?, ?, 12, 'application/pdf', 'pdf', ?)`
    )
    .run(name, key, Date.now()).lastInsertRowid;
  return { id, key };
}

describe('IMPROVE-58: PATCH /api/files/:id 改名的同 key 分支', () => {
  test('NFD→NFC 改名：key 不变即不删旧对象，行仍指向原对象且文件可读', async () => {
    const token = await adminToken();
    const { id, key } = seedFileWithKeyFromName(NFD_NAME);
    // 前提：两种写法映射到同一个 OSS key（否则本条用例覆盖不到 deleteOld=false 分支）
    assert.equal(key, objectKeyForFile(db, null, NFC_NAME));

    const r = await request('PATCH', `/api/files/${id}`, { token, body: { name: NFC_NAME } });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, NFC_NAME);
    // key 未变 → copyUpdateDelete 收到 deleteOld === false
    assert.equal(r.body.oss_key, key);
    assert.deepEqual(ossCalls.deleted, []); // 核心：没有对真身发删除
    assert.ok(ossCalls.copied.every(([from, to]) => from === to), '同 key 改名不该搬运到别的 key');

    const row = db.prepare('SELECT name, oss_key, size FROM files WHERE id = ?').get(id);
    assert.equal(row.name, NFC_NAME);
    assert.equal(row.oss_key, key);
    assert.equal(row.size, 12);

    // 「文件仍可读取」：下载签名仍指向同一个 key，说明行没被搬去新对象（也没留下悬空引用）
    const url = await request('GET', `/api/files/${id}/url`);
    assert.equal(url.status, 200);
    assert.equal(url.body.name, NFC_NAME);
    const signed = url.body.url;
    assert.ok(
      signed.includes(key) || signed.includes(encodeURI(key)),
      `签名 URL 未指向原 key：${signed}`
    );
  });

  test('对照：改成真正的新名（key 变了）确实会删掉旧 key —— 上面的空删除不是桩没生效', async () => {
    const token = await adminToken();
    const { id, key } = seedFileWithKeyFromName(NFC_NAME);
    const newKey = objectKeyForFile(db, null, 'renamed.pdf');
    assert.notEqual(newKey, key);

    const r = await request('PATCH', `/api/files/${id}`, { token, body: { name: 'renamed.pdf' } });
    assert.equal(r.status, 200);
    assert.deepEqual(ossCalls.copied, [[key, newKey]]);
    assert.deepEqual(ossCalls.deleted, [key]);
    assert.equal(db.prepare('SELECT oss_key FROM files WHERE id = ?').get(id).oss_key, newKey);
  });

  test('NFC 名改成等价的 NFD 写法视为未变化（unchanged），不进入搬运流程', async () => {
    const token = await adminToken();
    const { id, key } = seedFileWithKeyFromName(NFC_NAME);

    const r = await request('PATCH', `/api/files/${id}`, { token, body: { name: NFD_NAME } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, unchanged: true });
    assert.deepEqual(ossCalls, { copied: [], deleted: [] }); // 未变化 → 一个 OSS 调用都不该有

    const row = db.prepare('SELECT name, oss_key FROM files WHERE id = ?').get(id);
    assert.equal(row.name, NFC_NAME);
    assert.equal(row.oss_key, key);
  });
});
