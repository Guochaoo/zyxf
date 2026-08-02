import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { nextSortOrder, findByNameInParent, findFileByNameInFolder, findOssKeyConflict } from '../src/dbHelpers.js';

function makeDb() {
  const db = new Database(':memory:');
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
});

describe('findByNameInParent', () => {
  test('finds duplicates in the same parent, ignores other parents', () => {
    const db = makeDb();
    db.prepare('INSERT INTO folders (name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?)').run('dup', null, 0, 0);
    db.prepare('INSERT INTO folders (name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?)').run('dup', 1, 0, 0);
    assert.ok(findByNameInParent(db, 'folders', 'parent_id', 'dup', null));
    assert.ok(findByNameInParent(db, 'folders', 'parent_id', 'dup', 1));
    assert.equal(findByNameInParent(db, 'folders', 'parent_id', 'dup', 2), undefined);
  });

  test('excludeId skips the row being renamed', () => {
    const db = makeDb();
    const { lastInsertRowid } = db.prepare('INSERT INTO folders (name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?)').run('me', null, 0, 0);
    assert.equal(findByNameInParent(db, 'folders', 'parent_id', 'me', null, lastInsertRowid), undefined);
  });
});

describe('findFileByNameInFolder', () => {
  test('delegates with folder_id semantics (null = root)', () => {
    const db = makeDb();
    db.prepare('INSERT INTO files (folder_id, name, oss_key, size, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(null, 'a.txt', 'k1', 1, 0, 0);
    assert.ok(findFileByNameInFolder(db, 'a.txt', null));
    assert.equal(findFileByNameInFolder(db, 'a.txt', 5), undefined);
  });
});

describe('findOssKeyConflict', () => {
  test('detects another row holding the same key', () => {
    const db = makeDb();
    db.prepare('INSERT INTO files (folder_id, name, oss_key, size, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(null, 'a.txt', 'k1', 1, 0, 0);
    db.prepare('INSERT INTO files (folder_id, name, oss_key, size, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(null, 'b.txt', 'k2', 1, 0, 0);
    assert.ok(findOssKeyConflict(db, 'k1', 999));
    assert.equal(findOssKeyConflict(db, 'k1', 1), undefined);
    assert.equal(findOssKeyConflict(db, 'nope', 1), undefined);
  });
});
