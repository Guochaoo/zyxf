import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { nextSortOrder, makeSortOrderCursor } from '../src/dbHelpers.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE folders (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parent_id INTEGER, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, folder_id INTEGER, name TEXT NOT NULL, oss_key TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  `);
  return db;
}

describe('nextSortOrder', () => {
  test('starts at 0 and increments within the same parent', () => {
    const db = makeDb();
    assert.equal(nextSortOrder(db, 'folders', 'parent_id', null), 0);
    db.prepare('INSERT INTO folders (name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?)').run('a', null, 0, 0);
    db.prepare('INSERT INTO folders (name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?)').run('b', null, 1, 0);
    assert.equal(nextSortOrder(db, 'folders', 'parent_id', null), 2);
  });

  test('counts per-parent independently', () => {
    const db = makeDb();
    db.prepare('INSERT INTO folders (name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?)').run('a', 1, 5, 0);
    assert.equal(nextSortOrder(db, 'folders', 'parent_id', 1), 6);
    assert.equal(nextSortOrder(db, 'folders', 'parent_id', null), 0);
  });

  // 批量导入用游标：同父级连续取值递增，且各自从数据库当前 MAX 起步。
  test('makeSortOrderCursor 不碰库连续取值，且各父级互不影响', () => {
    const db = makeDb();
    const ins = db.prepare('INSERT INTO folders (name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?)');
    ins.run('a', 1, 5, 0);
    ins.run('root1', null, 0, 0);

    const next = makeSortOrderCursor(db);
    assert.equal(next('folders', 'parent_id', 1), 6); // 沿用库里的 MAX+1
    assert.equal(next('folders', 'parent_id', 1), 7);
    assert.equal(next('folders', 'parent_id', null), 1); // 根级独立计数
    assert.equal(next('folders', 'parent_id', 1), 8);
    // files 表也独立
    assert.equal(next('files', 'folder_id', 1), 0);
  });
});
