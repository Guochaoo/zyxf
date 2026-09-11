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
-- 统计接口的支撑索引（IMPROVE-12）：stats 的 ORDER BY created_at DESC LIMIT 8、
-- 两次 WHERE created_at >= ?、上传日序列都要扫 / 排序整张 files 表；node:sqlite 是
-- 同步执行，全表扫描会直接占住事件循环。
CREATE INDEX IF NOT EXISTS idx_files_created ON files(created_at);
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
-- top_downloads 是 GROUP BY dl.file_id + 每组「取最近一次」相关子查询：只有
-- downloaded_at 单列索引时，每组都要扫窗口内全部日志；复合索引让分组与取最近都走索引。
CREATE INDEX IF NOT EXISTS idx_download_logs_file ON download_logs(file_id, downloaded_at DESC);
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

// --- migration: users.token_epoch（token 撤销支点，BUG-51）---
// 改密码时自增；签发 token 时带上当时的值，attachUser 回查比对，不符即视为已撤销。
// 老库补列，默认 0；升级前签发的 token 没有该声明，按 0 处理（一次改密后就全失效）。
if (!hasColumn('users', 'token_epoch')) {
  db.exec(`ALTER TABLE users ADD COLUMN token_epoch INTEGER NOT NULL DEFAULT 0`);
}

// --- migration: users.role 的默认值改回 'user'（BUG-73）---
// 授权模型是「注册即普通用户、只有 ensureAdmin 能给 admin」，而建表时的
// DEFAULT 'admin' 恰好相反：任何漏写 role 的写入都会静默创建全站写权限账号。
// SQLite 不支持只改列默认值，只能重建表；仅在老库（dflt_value 仍是 'admin'）执行一次。
const roleDefault = db
  .prepare('PRAGMA table_info(users)')
  .all()
  .find((c) => c.name === 'role')?.dflt_value;
if (roleDefault === "'admin'") {
  db.exec(`
    ALTER TABLE users RENAME TO users_old;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL,
      email TEXT,
      token_epoch INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO users (id, username, password_hash, role, created_at, email, token_epoch)
      SELECT id, username, password_hash, role, created_at, email,
             COALESCE(token_epoch, 0) FROM users_old;
    DROP TABLE users_old;
  `);
  console.log('[db] migrated users.role default: admin -> user');
}

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

// --- migration: email_codes.uses（验证码「已核验通过」次数，BUG-71）---
// 与 attempts（输错次数）分开计数：合法用户输错几次再成功不应被算作滥用，但成功核验
// 之后每用一次都要记账——否则一枚合法验证码能在 10 分钟 TTL 内被无限复用去探测
// 用户名是否被占用（409 = 已占用），枚举速率比 /login 高两个数量级。
if (!hasColumn('email_codes', 'uses')) {
  db.exec(`ALTER TABLE email_codes ADD COLUMN uses INTEGER NOT NULL DEFAULT 0`);
}

export function ensureAdmin(username, password) {
  const existing = db
    .prepare('SELECT id, role, password_hash FROM users WHERE username = ?')
    .get(username);

  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)'
    ).run(username, hash, 'admin', Date.now());
    console.log(`[db] created default admin user: ${username}`);
  } else {
    // 管理员账号由 .env 独占管理（应用内没有改密/提权入口），因此 .env 是唯一权威来源：
    // 每次启动把密码/角色同步为配置值。否则改了 ADMIN_PASSWORD 也不会生效——库里已有
    // 旧哈希，登录仍走旧密码（BUG-34）。密码未变时不重写哈希，避免每次启动产生无谓写入。
    const passwordChanged = !bcrypt.compareSync(password, existing.password_hash);
    const roleChanged = existing.role !== 'admin';
    if (passwordChanged) {
      // 同时自增 token_epoch：让用旧密码签发的 token 立刻失效（BUG-51）。否则改密只让
      // 「用户名+密码」这条路失效，被盗 token 在 exp（默认 7d）之前仍持有全部写权限。
      db.prepare(
        'UPDATE users SET password_hash = ?, token_epoch = token_epoch + 1 WHERE id = ?'
      ).run(bcrypt.hashSync(password, 10), existing.id);
    }
    if (roleChanged) {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
    }
    if (passwordChanged || roleChanged) {
      console.log(
        `[db] synced admin account from env: ${username}` +
          (roleChanged ? ` (role ${existing.role} -> admin)` : '')
      );
    }
  }

  // 回收其它管理员行（BUG-52）：改 ADMIN_USER 等于「换管理员」，旧行若留着，旧用户名 +
  // 旧密码仍能登录成 admin——登录只查 users 表、完全不看配置，而应用内没有用户管理入口，
  // 这条残留行只能手改数据库才能清掉。降权为普通用户并自增 epoch（立即踢掉其 token）。
  const stale = db
    .prepare("SELECT id, username FROM users WHERE role = 'admin' AND username != ?")
    .all(username);
  if (stale.length) {
    db.prepare(
      "UPDATE users SET role = 'user', token_epoch = token_epoch + 1 WHERE role = 'admin' AND username != ?"
    ).run(username);
    console.warn(
      `[db] demoted stale admin account(s) not matching ADMIN_USER: ${stale
        .map((s) => s.username)
        .join(', ')}`
    );
  }
}

// 下载日志保留期（天）。download_logs 含 ip/ua，属可定位到个人的访问记录，
// 不应无限期留存；但仪表盘热力图需要近一年数据，故默认 400 天（略大于 1 年）。
export const DOWNLOAD_LOG_RETENTION_DAYS =
  Number(process.env.DOWNLOAD_LOG_RETENTION_DAYS) || 400;

// 删除超过保留期的下载日志，返回删除行数（启动时调用一次即可）。
export function pruneDownloadLogs(retentionDays = DOWNLOAD_LOG_RETENTION_DAYS) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return db.prepare('DELETE FROM download_logs WHERE downloaded_at < ?').run(cutoff).changes;
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
