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
});
