import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { db, pruneDownloadLogs } from '../src/db.js';
import { signToken, verifyToken, DEV_JWT_SECRET } from '../src/auth.js';

// 与 auth.js 取密钥的逻辑保持一致，使本文件单独运行（不经 test/setup.js 注入
// env）时断言依然成立；在 npm test 下 process.env.JWT_SECRET 已由 setup 设好。
const SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET;

const DAY = 24 * 60 * 60 * 1000;

function insertFile(ossKey) {
  return db
    .prepare('INSERT INTO files (folder_id, name, oss_key, size, created_at) VALUES (NULL, ?, ?, 1, ?)')
    .run(ossKey, ossKey, Date.now()).lastInsertRowid;
}

function insertLog(fileId, at) {
  db.prepare(
    'INSERT INTO download_logs (file_id, file_name, downloaded_at, ip, ua) VALUES (?, ?, ?, ?, ?)'
  ).run(fileId, 'x.pdf', at, '203.0.113.9', 'test-agent');
}

// 下载日志含 ip/ua（PII），需按保留期清理；热力图需要近一年数据。
describe('pruneDownloadLogs 按保留期清理下载日志（PII）', () => {
  test('删除超期行、保留窗口内行', () => {
    const fileId = insertFile('zyxf-test/prune-a.pdf');
    const now = Date.now();
    insertLog(fileId, now - 500 * DAY); // 超期
    insertLog(fileId, now - 401 * DAY); // 超期（刚过边界）
    insertLog(fileId, now - 30 * DAY); // 保留
    insertLog(fileId, now - 1 * DAY); // 保留

    const removed = pruneDownloadLogs(400);

    assert.equal(removed, 2, '应删除 2 条超期日志');
    const left = db.prepare('SELECT COUNT(*) c FROM download_logs WHERE file_id = ?').get(fileId).c;
    assert.equal(left, 2, '窗口内 2 条应保留');
    db.prepare('DELETE FROM download_logs WHERE file_id = ?').run(fileId);
    db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
  });

  test('无可清理行时返回 0', () => {
    assert.equal(pruneDownloadLogs(400), 0);
  });
});

// JWT 显式 pin HS256：不同算法签发的 token 必须被拒绝。
describe('JWT 算法固定为 HS256', () => {
  test('HS256 签发的 token 可正常校验', () => {
    const t = signToken({ id: 7, username: 'u', role: 'user' });
    const payload = verifyToken(t);
    assert.equal(payload.id, 7);
    assert.equal(payload.role, 'user');
  });

  test('用同一密钥但 HS512 签发的 token 被拒绝（算法混淆防护）', () => {
    const other = jwt.sign({ id: 7, role: 'admin' }, SECRET, {
      algorithm: 'HS512',
      expiresIn: '7d',
    });
    assert.equal(verifyToken(other), null);
  });

  test('畸形 token 返回 null 而不抛错', () => {
    assert.equal(verifyToken('not-a-jwt'), null);
    assert.equal(verifyToken(''), null);
  });
});
