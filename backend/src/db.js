import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath =
  process.env.DB_PATH === ':memory:'
    ? ':memory:'
    : path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data.db'));

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE,
  UNIQUE (parent_id, name)
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER,
  name TEXT NOT NULL,
  oss_key TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  mime_type TEXT,
  ext TEXT,
  uploader TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
`);

// --- migration: download_logs table ---
db.exec(`
CREATE TABLE IF NOT EXISTS download_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  downloaded_at INTEGER NOT NULL,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_download_logs_at ON download_logs(downloaded_at);
`);

// --- migration: add sort_order column for manual ordering ---
function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === col);
}
if (!hasColumn('folders', 'sort_order')) {
  db.exec(`ALTER TABLE folders ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
  db.exec(`UPDATE folders SET sort_order = id`); // stable initial order
}
if (!hasColumn('files', 'sort_order')) {
  db.exec(`ALTER TABLE files ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
  db.exec(`UPDATE files SET sort_order = id`);
}
// --- migration: add ip / ua audit columns to download_logs ---
if (!hasColumn('download_logs', 'ip')) {
  db.exec(`ALTER TABLE download_logs ADD COLUMN ip TEXT`);
}
if (!hasColumn('download_logs', 'ua')) {
  db.exec(`ALTER TABLE download_logs ADD COLUMN ua TEXT`);
}
db.exec(`
CREATE INDEX IF NOT EXISTS idx_folders_sort ON folders(parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_files_sort ON files(folder_id, sort_order);
`);

// --- migration: users.email（注册功能）---
// 老库补列；admin 等未绑邮箱的行 email 为 NULL（部分唯一索引跳过 NULL）。
if (!hasColumn('users', 'email')) {
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`);

// --- migration: email_codes（邮箱注册验证码）---
db.exec(`
CREATE TABLE IF NOT EXISTS email_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  first_sent_at INTEGER NOT NULL
);
`);

export function ensureAdmin(username, password) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return;
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)'
  ).run(username, hash, 'admin', Date.now());
  console.log(`[db] created default admin user: ${username}`);
}

// node:sqlite has no `db.transaction()`; wrap a synchronous fn in
// BEGIN/COMMIT/ROLLBACK and keep the call-return-later shape routes rely on
// (`const tx = transaction(() => ...); tx();`).
export function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}
