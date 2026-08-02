import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signToken, verifyToken, attachUser, requireAdmin } from '../src/auth.js';

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
    const token = signToken({ id: 7, username: 'u', role: 'admin' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    attachUser(req, {}, () => {});
    assert.equal(req.user.id, 7);
    assert.equal(req.user.role, 'admin');
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
