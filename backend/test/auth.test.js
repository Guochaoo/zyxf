import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signToken, verifyToken, attachUser, requireAdmin } from '../src/auth.js';
import { db } from '../src/db.js';
import { ensureTestUser } from './setup.js';

function mockRes() {
  const res = { statusCode: 0, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

describe('auth', () => {
  test('signToken produces a token that verifies with the right payload', () => {
    const token = signToken({ id: 1, username: 'admin', role: 'admin' });
    assert.equal(typeof token, 'string');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    assert.equal(decoded.id, 1);
    assert.equal(decoded.username, 'admin');
    assert.equal(decoded.role, 'admin');
  });

  test('verifyToken returns null for garbage or expired tokens', () => {
    assert.equal(verifyToken('not-a-token'), null);
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '-1s' });
    assert.equal(verifyToken(token), null);
  });

  test('attachUser ignores missing/wrong-format headers', () => {
    let called = 0;
    attachUser({ headers: {} }, {}, () => called++);
    attachUser({ headers: { authorization: 'Basic abc' } }, {}, () => called++);
    attachUser({ headers: { authorization: 'Bearer ' } }, {}, () => called++);
    assert.equal(called, 3);
  });

  test('attachUser attaches a valid user payload', () => {
    // attachUser 现在回查用户行，故必须先让该 id 真实存在（BUG-51/52）
    ensureTestUser({ id: 7, username: 'u', role: 'admin' });
    const token = signToken({ id: 7, username: 'u', role: 'admin' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    attachUser(req, {}, () => {});
    assert.equal(req.user.id, 7);
    assert.equal(req.user.username, 'u');
    assert.equal(req.user.role, 'admin');
  });

  test('BUG-51: 用户行不存在（已删号）时 token 失效', () => {
    const token = signToken({ id: 4242, username: 'ghost', role: 'user' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    attachUser(req, {}, () => {});
    assert.equal(req.user, undefined);
  });

  test('BUG-51: token_epoch 不匹配（改密后）时 token 失效', () => {
    ensureTestUser({ id: 8, username: 'epochy', role: 'user' });
    const stale = signToken({ id: 8, username: 'epochy', role: 'user', epoch: 0 });
    const fresh = signToken({ id: 8, username: 'epochy', role: 'user', epoch: 1 });

    const req1 = { headers: { authorization: `Bearer ${stale}` } }; // epoch=0 与库中 0 一致
    attachUser(req1, {}, () => {});
    assert.equal(req1.user?.id, 8);

    db.prepare('UPDATE users SET token_epoch = 1 WHERE id = 8').run(); // 模拟改密
    const req2 = { headers: { authorization: `Bearer ${stale}` } };
    attachUser(req2, {}, () => {});
    assert.equal(req2.user, undefined, '改密前的 token 必须失效');

    const req3 = { headers: { authorization: `Bearer ${fresh}` } };
    attachUser(req3, {}, () => {});
    assert.equal(req3.user?.id, 8, '改密后新签发的 token 有效');
  });

  test('BUG-52: 角色以库中为准，payload 里写 admin 也不会绕过降权', () => {
    ensureTestUser({ id: 9, username: 'demoted', role: 'user' });
    const token = signToken({ id: 9, username: 'demoted', role: 'admin' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    attachUser(req, {}, () => {});
    assert.equal(req.user.role, 'user', '库里已是普通用户，payload 的 admin 不应生效');
  });

  test('attachUser ignores a tampered token', () => {
    const req = { headers: { authorization: 'Bearer abc.def.ghi' } };
    attachUser(req, {}, () => {});
    assert.equal(req.user, undefined);
  });

  test('requireAdmin rejects unauthenticated (401) and non-admin (403)', () => {
    const res = mockRes();
    requireAdmin({}, res, () => assert.fail('next should not be called'));
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'unauthenticated' });

    const res2 = mockRes();
    requireAdmin({ user: { role: 'user' } }, res2, () => assert.fail('next should not be called'));
    assert.equal(res2.statusCode, 403);
    assert.deepEqual(res2.body, { error: 'forbidden' });
  });

  test('requireAdmin allows admins through', () => {
    let passed = false;
    requireAdmin({ user: { role: 'admin' } }, mockRes(), () => (passed = true));
    assert.ok(passed);
  });
});
