import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { db, ensureAdmin } from '../src/db.js';

const rowOf = (name) =>
  db.prepare('SELECT role, password_hash FROM users WHERE username = ?').get(name);
const cleanup = (name) => db.prepare('DELETE FROM users WHERE username = ?').run(name);

// 管理员账号由 .env 独占管理，故 .env 每次启动都是权威来源（BUG-34）。
describe('ensureAdmin 以 .env 为权威同步管理员账号', () => {
  test('账号不存在时创建 admin', () => {
    ensureAdmin('sync-new', 'first-password');
    const row = rowOf('sync-new');
    assert.equal(row.role, 'admin');
    assert.ok(bcrypt.compareSync('first-password', row.password_hash));
    cleanup('sync-new');
  });

  test('BUG-34: ADMIN_PASSWORD 变化后同步新密码（旧密码失效）', () => {
    ensureAdmin('sync-upd', 'old-password-1');
    const before = rowOf('sync-upd').password_hash;

    ensureAdmin('sync-upd', 'new-password-2');
    const after = rowOf('sync-upd');

    assert.notEqual(after.password_hash, before, '哈希应被更新');
    assert.ok(bcrypt.compareSync('new-password-2', after.password_hash), '新密码可登录');
    assert.ok(!bcrypt.compareSync('old-password-1', after.password_hash), '旧密码失效');
    cleanup('sync-upd');
  });

  test('密码未变时不重写哈希（避免每次启动产生无谓写入）', () => {
    ensureAdmin('sync-same', 'same-password');
    const before = rowOf('sync-same').password_hash;

    ensureAdmin('sync-same', 'same-password');

    assert.equal(rowOf('sync-same').password_hash, before);
    cleanup('sync-same');
  });

  test('同名普通用户会被升为 admin 并同步密码', () => {
    db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)').run(
      'sync-promo',
      bcrypt.hashSync('user-password', 10),
      'user',
      Date.now()
    );

    ensureAdmin('sync-promo', 'admin-password');

    const row = rowOf('sync-promo');
    assert.equal(row.role, 'admin');
    assert.ok(bcrypt.compareSync('admin-password', row.password_hash));
    cleanup('sync-promo');
  });

  // BUG-52：改 ADMIN_USER 等于「换管理员」。旧行若留着，旧用户名 + 旧密码仍能登录成
  // admin（登录只查 users 表、完全不看配置），而应用内没有用户管理入口，只能手改库才能清掉。
  test('BUG-52: 换 ADMIN_USER 后旧管理员被降权', () => {
    ensureAdmin('sync-old-admin', 'old-admin-password');
    assert.equal(rowOf('sync-old-admin').role, 'admin');

    ensureAdmin('sync-new-admin', 'new-admin-password');

    assert.equal(rowOf('sync-old-admin').role, 'user', '旧管理员应被降权');
    assert.equal(rowOf('sync-new-admin').role, 'admin');
    cleanup('sync-old-admin');
    cleanup('sync-new-admin');
  });

  // BUG-51 的基础：改密码时自增 token_epoch（比对在 auth.attachUser），未改密码则不动。
  test('BUG-51: 改密码使 token_epoch 自增，未改密码则不动', () => {
    ensureAdmin('sync-epoch', 'epoch-password-1');
    const epochOf = () =>
      db.prepare('SELECT token_epoch FROM users WHERE username = ?').get('sync-epoch').token_epoch;
    const e0 = epochOf();

    ensureAdmin('sync-epoch', 'epoch-password-1'); // 密码未变
    assert.equal(epochOf(), e0, '未改密码不应变动');

    ensureAdmin('sync-epoch', 'epoch-password-2'); // 改密码
    assert.equal(epochOf(), e0 + 1, '改密码应自增');
    cleanup('sync-epoch');
  });

  // BUG-73：表级默认值不再是 'admin'——任何漏写 role 的写入都必须落到普通用户。
  test('BUG-73: users.role 的默认值是 user', () => {
    const dflt = db
      .prepare('PRAGMA table_info(users)')
      .all()
      .find((c) => c.name === 'role')?.dflt_value;
    assert.equal(dflt, "'user'");

    db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run(
      'sync-default-role',
      'x',
      Date.now()
    );
    assert.equal(rowOf('sync-default-role').role, 'user');
    cleanup('sync-default-role');
  });
});
