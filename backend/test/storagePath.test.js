import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { objectKeyForFile, placeholderKeyForFolder, folderPathSegments, cleanObjectSegment, ossPrefix, parseOptionalFolderId } from '../src/storagePath.js';

// Minimal folders/files schema matching what the routes use.
function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE folders (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parent_id INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, folder_id INTEGER, name TEXT NOT NULL, oss_key TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);
  `);
  return db;
}

function seed(db, { folders = [], files = [] } = {}) {
  for (const f of folders) {
    db.prepare('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)').run(f.id, f.name, f.parent_id ?? null, 0);
  }
  for (const f of files) {
    db.prepare('INSERT INTO files (id, folder_id, name, oss_key, size, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(f.id, f.folder_id ?? null, f.name, f.oss_key, f.size, 0);
  }
}

describe('cleanObjectSegment', () => {
  test('replaces slashes, backslashes and control chars with dashes', () => {
    assert.equal(cleanObjectSegment('a/b'), 'a-b');
    assert.equal(cleanObjectSegment('a\\b'), 'a-b');
    assert.equal(cleanObjectSegment('a\u0000b'), 'a-b');
    assert.equal(cleanObjectSegment(' a '), 'a');
  });

  test('dots-only names become underscores (avoid ../ style keys)', () => {
    assert.equal(cleanObjectSegment('..'), '_');
    assert.equal(cleanObjectSegment('.'), '_');
  });

  test('normalizes unicode to NFC', () => {
    assert.equal(cleanObjectSegment('\u0065\u0301'), '\u00e9');
  });
});

describe('ossPrefix', () => {
  test('trims surrounding slashes', () => {
    const prev = process.env.OSS_KEY_PREFIX;
    process.env.OSS_KEY_PREFIX = '/zyxf//';
    try {
      assert.equal(ossPrefix(), 'zyxf');
    } finally {
      process.env.OSS_KEY_PREFIX = prev;
    }
  });
});

describe('objectKeyForFile', () => {
  test('root file uses prefix + name', () => {
    const db = makeDb();
    assert.equal(objectKeyForFile(db, null, 'a.pdf'), 'zyxf-test/a.pdf');
  });

  test('nested file uses full folder path', () => {
    const db = makeDb();
    seed(db, {
      folders: [
        { id: 1, name: '\u8bfe\u7a0b', parent_id: null },
        { id: 2, name: '2026 \u79cb', parent_id: 1 },
      ],
    });
    assert.equal(objectKeyForFile(db, 2, '\u8bfe\u4ef6.pptx'), 'zyxf-test/\u8bfe\u7a0b/2026 \u79cb/\u8bfe\u4ef6.pptx');
  });

  test('folder renames/moves are reflected via overrides without touching the DB', () => {
    const db = makeDb();
    seed(db, {
      folders: [
        { id: 1, name: 'Old', parent_id: null },
        { id: 2, name: 'Sub', parent_id: 1 },
      ],
    });
    const key = objectKeyForFile(db, 2, 'f.txt', new Map([[1, 9]]), new Map([[1, 'New']]));
    assert.equal(key, 'zyxf-test/New/Sub/f.txt');
  });

  test('unsafe characters in folder names are sanitized', () => {
    const db = makeDb();
    seed(db, { folders: [{ id: 1, name: 'a/b\\c', parent_id: null }] });
    assert.equal(objectKeyForFile(db, 1, 'f.txt'), 'zyxf-test/a-b-c/f.txt');
  });
});

describe('placeholderKeyForFolder', () => {
  test('root folder has no placeholder key when no prefix is set', () => {
    const db = makeDb();
    const prev = process.env.OSS_KEY_PREFIX;
    process.env.OSS_KEY_PREFIX = '';
    try {
      assert.equal(placeholderKeyForFolder(db, null), null);
    } finally {
      process.env.OSS_KEY_PREFIX = prev;
    }
  });

  test('folder placeholder is its path with trailing slash', () => {
    const db = makeDb();
    seed(db, { folders: [{ id: 1, name: 'A', parent_id: null }] });
    assert.equal(placeholderKeyForFolder(db, 1), 'zyxf-test/A/');
  });
});

describe('folderPathSegments', () => {
  test('walks up the ancestor chain, root first', () => {
    const db = makeDb();
    seed(db, {
      folders: [
        { id: 1, name: 'A', parent_id: null },
        { id: 2, name: 'B', parent_id: 1 },
        { id: 3, name: 'C', parent_id: 2 },
      ],
    });
    assert.deepEqual(folderPathSegments(db, 3), ['A', 'B', 'C']);
  });

  test('terminates on cycles instead of hanging', () => {
    const db = makeDb();
    seed(db, {
      folders: [
        { id: 1, name: 'A', parent_id: 2 },
        { id: 2, name: 'B', parent_id: 1 },
      ],
    });
    assert.equal(folderPathSegments(db, 1).length, 2);
  });
});

describe('parseOptionalFolderId', () => {
  test('nullish/zero/empty map to null (root)', () => {
    for (const v of [null, undefined, 0, '0', '']) assert.equal(parseOptionalFolderId(v), null);
  });

  test('valid positive integers pass through', () => {
    assert.equal(parseOptionalFolderId(3), 3);
    assert.equal(parseOptionalFolderId('3'), 3);
  });

  test('garbage becomes NaN', () => {
    assert.ok(Number.isNaN(parseOptionalFolderId('abc')));
    assert.ok(Number.isNaN(parseOptionalFolderId('-1')));
    assert.ok(Number.isNaN(parseOptionalFolderId(1.5)));
  });
});
