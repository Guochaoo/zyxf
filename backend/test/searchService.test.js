import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { searchLibrary, listTopFolders, invalidateSearchCache } from '../src/searchService.js';

function insertFolder(name, parentId) {
  const now = Date.now();
  const info = db
    .prepare('INSERT INTO folders (name, parent_id, created_at) VALUES (?, ?, ?)')
    .run(name, parentId, now);
  return info.lastInsertRowid;
}

function insertFile(name, { folderId = null, ossKey } = {}) {
  const now = Date.now();
  db.prepare(
    'INSERT INTO files (name, folder_id, oss_key, size, ext, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, folderId, ossKey, 1024, 'pdf', now);
}

describe('searchService library (BUG-07 / BUG-10 / BUG-16)', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM files').run();
    db.prepare('DELETE FROM folders').run();
  });

  test('BUG-07: invalidateSearchCache is exported and searchLibrary reads fresh data', () => {
    assert.equal(typeof invalidateSearchCache, 'function');
    invalidateSearchCache(); // 不应抛错
    const empty = searchLibrary('高数');
    assert.deepEqual(empty, { folders: [], files: [], truncated: false });
    // 全库一致，命中/未命中结果结构相同（测试环境禁用 TTL 缓存，始终保持最新）
    insertFolder('高等数学', null);
    insertFile('高等数学.pdf', { ossKey: 'zyxf-test/高等数学.pdf' });
    const r1 = searchLibrary('高数');
    assert.equal(r1.files.length, 1);
    assert.equal(r1.files[0].name, '高等数学.pdf');
    const r2 = searchLibrary('高数');
    assert.deepEqual(r2, r1);
  });

  test('BUG-10: a name-direct match always ranks above a path-only match', () => {
    const folderId = insertFolder('高等数学', null);
    // 仅路径命中：文件名不含「高数」，但所在文件夹含「高等数学」
    insertFile('第1章.pptx', { folderId, ossKey: 'zyxf-test/高等数学/第1章.pptx' });
    // 名称直接命中：文件名含「高数」
    insertFile('高等数学复习.pdf', { ossKey: 'zyxf-test/高等数学复习.pdf' });

    const { files } = searchLibrary('高数');
    assert.equal(files.length, 2);
    // 名称直配（高等数学复习.pdf）排在最前，路径命中（第1章.pptx）仅靠路径排在后面。
    assert.equal(files[0].name, '高等数学复习.pdf');
    assert.equal(files[0].folder_path, undefined); // 根目录文件
    assert.equal(files[1].name, '第1章.pptx');
    assert.equal(files[1].folder_path, '高等数学');
  });

  test('BUG-16: listTopFolders only returns NULL-root folders, never nested ones', () => {
    const rootA = insertFolder('线性代数', null);
    insertFolder('大学物理', null);
    insertFolder('第一章', rootA); // 嵌套目录，不应出现在顶层

    const top = listTopFolders();
    const names = top.map((f) => f.name);
    assert.deepEqual(names, ['大学物理', '线性代数']); // ORDER BY name，仅 NULL 根
  });
});
