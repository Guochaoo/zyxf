import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// IMPROVE-58 第 2 条：db.js 的迁移分支（users.role 重建表 + 各补列）。
// fresh 的 :memory: 库永远走不到这些分支（表已是最新 schema），所以做法是：
// 先用**旧 schema** 预建一个 DB 文件 → 在子进程里 import db.js → 断言迁移结果。
// 必须用子进程：db.js 在 import 时就把库开好（进程级单例），而本测试进程的库是 :memory:。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'db.js')).href;

// 迁移前的旧 schema：users 无 email/token_epoch 且 role 默认 'admin'（BUG-73），
// folders/files 无 sort_order，download_logs 无 ip/ua，email_codes 无 uses。
const LEGACY_SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at INTEGER NOT NULL
);
CREATE TABLE folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (parent_id, name)
);
CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER,
  name TEXT NOT NULL,
  oss_key TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  mime_type TEXT,
  ext TEXT,
  uploader TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE download_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER,
  file_name TEXT,
  downloaded_at INTEGER
);
CREATE TABLE email_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  first_sent_at INTEGER NOT NULL
);
`;

function seedLegacyDb() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zyxf-migrate-')), 'legacy.db');
  const legacy = new DatabaseSync(file);
  legacy.exec(LEGACY_SCHEMA);
  legacy
    .prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (1, 'admin', 'hash-admin', 'admin', 111)")
    .run();
  legacy
    .prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (2, 'alice', 'hash-alice', 'user', 222)")
    .run();
  legacy.prepare("INSERT INTO folders (id, name, parent_id, created_at) VALUES (7, '高数', NULL, 10)").run();
  legacy.prepare("INSERT INTO folders (id, name, parent_id, created_at) VALUES (9, '线代', NULL, 11)").run();
  legacy
    .prepare("INSERT INTO files (id, folder_id, name, oss_key, size, created_at) VALUES (3, 7, 'a.pdf', 'zyxf-test/a.pdf', 42, 12)")
    .run();
  legacy
    .prepare("INSERT INTO download_logs (id, file_id, file_name, downloaded_at) VALUES (1, 3, 'a.pdf', 99)")
    .run();
  legacy
    .prepare(
      "INSERT INTO email_codes (email, code_hash, attempts, expires_at, created_at, sent_count, first_sent_at) VALUES ('x@y.z', 'h', 0, 1, 2, 1, 2)"
    )
    .run();
  legacy.close();
  return file;
}

// 子进程里 import 真实 db.js（触发迁移），再把结果以 JSON 打回主进程。
const PROBE = `
const { db } = await import(${JSON.stringify(dbUrl)});
const cols = (t) => db.prepare('PRAGMA table_info(' + t + ')').all().map((c) => c.name);
const out = {
  usersCols: cols('users'),
  roleDefault: db.prepare('PRAGMA table_info(users)').all().find((c) => c.name === 'role').dflt_value,
  usersSql: db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get().sql,
  users: db.prepare('SELECT id, username, password_hash, role, email, token_epoch FROM users ORDER BY id').all(),
  folderCols: cols('folders'),
  folders: db.prepare('SELECT id, sort_order FROM folders ORDER BY id').all(),
  fileCols: cols('files'),
  logCols: cols('download_logs'),
  codeCols: cols('email_codes'),
};
// BUG-73 的实际保护点：漏写 role 的写入必须落到 'user'，而不是旧的 'admin'
// （先清掉同名行，脚本可重复执行——幂等性用例会跑第二遍）
db.prepare("DELETE FROM users WHERE username = 'norole'").run();
db.prepare("INSERT INTO users (username, password_hash, created_at) VALUES ('norole', 'h', 1)").run();
out.noroleRole = db.prepare("SELECT role FROM users WHERE username = 'norole'").get().role;
console.log(JSON.stringify(out));
`;

function runMigrationProbe(dbFile) {
  const res = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', PROBE],
    { env: { ...process.env, DB_PATH: dbFile, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 20000 }
  );
  assert.equal(res.status, 0, `迁移子进程失败：${res.stderr}`);
  return { out: JSON.parse(res.stdout.trim().split('\n').at(-1)), stdout: res.stdout, stderr: res.stderr };
}

describe('db.js 迁移分支（旧 schema → 新 schema）', () => {
  test("users.role 重建表：默认值 'user'、旧行与字段完整搬移", () => {
    const { out, stdout } = runMigrationProbe(seedLegacyDb());

    assert.equal(out.roleDefault, "'user'");
    assert.match(out.usersSql, /DEFAULT 'user'/);
    assert.match(stdout, /migrated users\.role default: admin -> user/);

    // 旧行必须逐字段搬过来（id/username/password_hash/role/created_at 都不能丢）
    assert.equal(out.users.length, 2);
    assert.deepEqual(
      out.users.map((u) => [u.id, u.username, u.password_hash, u.role, u.token_epoch]),
      [
        [1, 'admin', 'hash-admin', 'admin', 0],
        [2, 'alice', 'hash-alice', 'user', 0],
      ]
    );
    // email/token_epoch 是迁移时补的列，旧行取值应为 NULL / 0
    assert.deepEqual(out.users.map((u) => u.email), [null, null]);
  });

  test('漏写 role 的新行落到 user（BUG-73 的实际保护点）', () => {
    const { out } = runMigrationProbe(seedLegacyDb());
    assert.equal(out.noroleRole, 'user');
  });

  test('folders/files 的 sort_order 补列并回填为 id 的稳定初始顺序', () => {
    const { out } = runMigrationProbe(seedLegacyDb());
    assert.ok(out.folderCols.includes('sort_order'));
    assert.ok(out.fileCols.includes('sort_order'));
    assert.deepEqual(out.folders, [
      { id: 7, sort_order: 7 },
      { id: 9, sort_order: 9 },
    ]);
  });

  test('download_logs 补 ip/ua 审计列、email_codes 补 uses 列', () => {
    const { out } = runMigrationProbe(seedLegacyDb());
    assert.ok(out.logCols.includes('ip'));
    assert.ok(out.logCols.includes('ua'));
    assert.ok(out.codeCols.includes('uses'));
  });

  test('已是最新 schema 的库再跑一次是幂等的（不再重建表）', () => {
    const file = seedLegacyDb();
    runMigrationProbe(file); // 第一次：执行迁移
    const { out, stdout } = runMigrationProbe(file); // 第二次：应无迁移动作
    assert.doesNotMatch(stdout, /migrated users\.role default/);
    assert.equal(out.roleDefault, "'user'");
    assert.deepEqual(out.folders.map((f) => f.sort_order), [7, 9]);
  });
});
