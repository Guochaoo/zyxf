import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  hashPassword,
  verifyPassword,
  dummyPasswordHash,
  isLegacyHash,
} from '../src/password.js';

// BUG-104 的偶发签名是「某次 admin 登录没拿到 token」，而登录失败的**真实状态码**
// 一直没被捕获到。定位到的这一条会让失败彻底隐身：verifyPassword 原先把所有 scrypt
// 异常都吞成 { ok: false }，于是一次瞬时的资源性失败（内存/线程池）在登录接口上
// 与「密码错误」完全同形（401），既误导用户也掩盖真实原因。
//
// 本文件用 t.mock.method 替换 crypto.scrypt 来构造这种失败（真实的 ENOMEM 无法按需复现）。
// 注意先跑「失败」用例：dummyPasswordHash 是惰性 memo，先在别的用例里成功过就不走失败分支了。

describe('verifyPassword 的错误分类（BUG-104 相关）', () => {
  test('dummyPasswordHash：瞬时失败不写进 memo，恢复后仍能成功', async (t) => {
    const failing = t.mock.method(crypto, 'scrypt', (_pwd, _salt, _len, _opts, cb) =>
      cb(Object.assign(new Error('simulated out of memory'), { code: 'ENOMEM' }))
    );
    await assert.rejects(() => dummyPasswordHash(), /simulated out of memory/);
    failing.mock.restore();

    // 若失败被缓存成 rejected promise，这里会继续 reject——所有「账号不存在」的登录将永久 500
    const hash = await dummyPasswordHash();
    assert.match(hash, /^scrypt\$32768\$8\$1\$/);
  });

  test('scrypt 执行期失败（ENOMEM）抛出而不是伪装成「密码错误」', async (t) => {
    const stored = await hashPassword('right-password');
    t.mock.method(crypto, 'scrypt', (_pwd, _salt, _len, _opts, cb) =>
      cb(Object.assign(new Error('simulated out of memory'), { code: 'ENOMEM' }))
    );
    await assert.rejects(() => verifyPassword('right-password', stored), /simulated out of memory/);
  });

  test('存储哈希参数畸形时按校验不通过处理（不抛错、不 500）', async () => {
    const malformed = [
      'scrypt$abc$8$1$c2FsdA==$a2V5', // N 不是数字 → ERR_OUT_OF_RANGE
      'scrypt$1048576$8$1$c2FsdA==$a2V5', // N 超出 maxmem → ERR_CRYPTO_INVALID_SCRYPT_PARAMS
      'scrypt$32768$8$1$@@@@$@@@@', // base64 垃圾 → 长度不同
      'scrypt$32768$8$1$c2FsdA==', // 段数不对
      'bcrypt-ish-garbage',
      '',
    ];
    for (const stored of malformed) {
      const r = await verifyPassword('whatever', stored);
      assert.deepEqual(r, { ok: false, legacy: false }, `畸形哈希应判为不通过：${stored}`);
    }
  });

  test('正常路径不变：正确密码 ok、错误密码不 ok、legacy 标记正确', async () => {
    const stored = await hashPassword('right-password');
    assert.equal(isLegacyHash(stored), false);
    assert.deepEqual(await verifyPassword('right-password', stored), { ok: true, legacy: false });
    assert.deepEqual(await verifyPassword('wrong-password', stored), { ok: false, legacy: false });

    // 历史 bcrypt 哈希仍可校验，并标记 legacy（调用方据此升级为 scrypt）
    const bcryptHash = bcrypt.hashSync('legacy-password', 10);
    assert.ok(isLegacyHash(bcryptHash));
    assert.equal((await verifyPassword('legacy-password', bcryptHash)).legacy, true);
    assert.deepEqual(await verifyPassword('nope', bcryptHash), { ok: false, legacy: false });
  });
});
