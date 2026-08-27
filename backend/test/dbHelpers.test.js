import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { nextSortOrder } from '../src/dbHelpers.js';

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
