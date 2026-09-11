// 认证加固的专项回归（BUG-53/69/70/71/72）。
// 单独成文件：限流器是模块级状态，登录类用例会互相污染，放这里可保证计数干净。
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { db } from '../src/db.js';
import { app } from '../src/index.js';
import { mailState } from './setup.js';
import { hashPassword } from '../src/password.js';

let server;
let base;

before(async () => {
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  db.prepare('DELETE FROM email_codes').run();
  db.prepare("DELETE FROM users WHERE username != 'admin'").run();
  mailState.enabled = true;
  mailState.failNext = false;
  mailState.lastCode = null;
  mailState.calls = [];
});

async function request(method, path, { body, headers } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: data };
}

const createUser = (username, password, role = 'user') =>
  db
    .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run(username, bcrypt.hashSync(password, 10), role, Date.now());

const login = (username, password, ip) =>
  request('POST', '/api/auth/login', { body: { username, password }, headers: { 'x-forwarded-for': ip } });

describe('BUG-53: 登录限流按「IP + 账号」分桶', () => {
  test('同一出口打满某账号的额度后，其它账号仍可正常登录', async () => {
    createUser('alice', 'alice-password-1');
    createUser('bob', 'bob-password-1');
    const ip = '203.0.113.210';

    // 针对 alice 打满 10 次错误密码（额度上限 10/15min）
    let lastStatus = 0;
    for (let i = 0; i < 10; i++) {
      lastStatus = (await login('alice', 'wrong-password', ip)).status;
    }
    assert.equal(lastStatus, 401, '前 10 次应为 401');
    assert.equal((await login('alice', 'wrong-password', ip)).status, 429, 'alice 应被限流');

    // 关键点：同一出口的另一个账号不应被连坐（改前这里也是 429）
    const bobLogin = await login('bob', 'bob-password-1', ip);
    assert.equal(bobLogin.status, 200, 'bob 不应因 alice 被爆破而连坐');
    assert.ok(bobLogin.body.token, '应签发 token');
  });
});

describe('IMPROVE-16: 密码哈希不再独占事件循环', () => {
  // 判据：登录进行中并发打 /api/health，health 的排队时间应远小于一次哈希的耗时。
  // 改前（bcryptjs 同步/分片实现）health 会被挡到约一整个哈希时长（≈40 ms）；
  // 改后走 libuv 线程池的 scrypt，health 只需排队一个 tick（实测 1 ms 量级）。
  test('登录进行中，并发的 /api/health 不被哈希阻塞', async () => {
    const t = Date.now();
    await hashPassword('measure-cost');
    const hashCost = Date.now() - t;

    const loginPromise = request('POST', '/api/auth/login', {
      body: { username: 'nobody-bench', password: 'some-password' },
    });
    const healthStart = Date.now();
    const health = await request('GET', '/api/health');
    const healthDelay = Date.now() - healthStart;
    const login = await loginPromise;

    assert.equal(health.status, 200);
    assert.equal(login.status, 401);
    assert.ok(
      healthDelay < hashCost / 2,
      `health 排队 ${healthDelay}ms 不应接近一次哈希的耗时 ${hashCost}ms（说明哈希又回到主线程阻塞）`
    );
  });

  // 存量 bcrypt 账号：仍能登录，并在这次登录时被升级为 scrypt（无需重置密码）。
  test('历史 bcrypt 哈希仍可登录并自动升级为 scrypt', async () => {
    const legacy = bcrypt.hashSync('legacy-pass-123', 10);
    db.prepare(
      `INSERT INTO users (username, password_hash, role, created_at) VALUES ('legacy-user', ?, 'user', ?)`
    ).run(legacy, Date.now());

    const r = await login('legacy-user', 'legacy-pass-123', '203.0.113.220');
    assert.equal(r.status, 200);

    const row = db.prepare("SELECT password_hash FROM users WHERE username = 'legacy-user'").get();
    assert.ok(row.password_hash.startsWith('scrypt$'), '登录后应升级为 scrypt 哈希');
    // 升级后的哈希仍能校验同一个密码
    const again = await login('legacy-user', 'legacy-pass-123', '203.0.113.221');
    assert.equal(again.status, 200);
  });
});

describe('BUG-70: 账号不存在时也走一次哈希校验（抹平时间差）', () => {
  // ESM 导出的绑定是只读的，没法 spy 模块函数；这里直接量时间：账号不存在的 401 与
  // 「账号存在但密码错」的 401 必须是同一量级。一旦有人把不存在分支短路掉（直接 return），
  // 前者会快一个数量级，这条就会红。
  test('账号不存在与密码错误的耗时同量级', async () => {
    const known = 'timing-known';
    db.prepare(
      'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)'
    ).run(known, await hashPassword('the-right-password'), 'user', Date.now());

    const t1 = Date.now();
    const missing = await login('nobody-here-at-all', 'whatever-password', '203.0.113.211');
    const missingMs = Date.now() - t1;

    const t2 = Date.now();
    const wrong = await login(known, 'the-wrong-password', '203.0.113.212');
    const wrongMs = Date.now() - t2;

    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    // 取密码错误耗时的 1/3 作下界，跨机器保守；只验证「不存在分支确实跑了哈希」
    assert.ok(
      missingMs > wrongMs / 3,
      `账号不存在耗时 ${missingMs}ms 远低于密码错误 ${wrongMs}ms，说明该分支没有跑哈希`
    );
  });
});

describe('BUG-69: 验证码先发信、成功后才落库', () => {
  test('发信失败不消耗冷却、不覆写旧码，紧接着重试即可成功', async () => {
    const email = 'send-fail@test.dev';

    // 第一次：发信失败
    mailState.failNext = true;
    const failed = await request('POST', '/api/auth/register/code', {
      body: { email },
      headers: { 'x-forwarded-for': '203.0.113.212' },
    });
    assert.equal(failed.status, 502, '邮件服务故障应返回 502');
    assert.equal(
      db.prepare('SELECT COUNT(*) c FROM email_codes WHERE email = ?').get(email).c,
      0,
      '发送失败不应留下记录（否则占用冷却与当日额度）'
    );

    // 紧接着重试：不应被 60 秒冷却拦下
    const retry = await request('POST', '/api/auth/register/code', {
      body: { email },
      headers: { 'x-forwarded-for': '203.0.113.212' },
    });
    assert.equal(retry.status, 200, '失败不应消耗冷却时间');
    assert.equal(mailState.lastCode?.length, 6, '这次应真的发出验证码');

    // 冷却只在这之后才生效
    const tooSoon = await request('POST', '/api/auth/register/code', {
      body: { email },
      headers: { 'x-forwarded-for': '203.0.113.212' },
    });
    assert.equal(tooSoon.status, 429, '成功发信后冷却才生效');
  });
});

describe('BUG-71: 合法验证码不可无限复用（用户名枚举 oracle）', () => {
  test('同一枚验证码最多用于 3 次注册提交', async () => {
    const email = 'oracle@test.dev';
    await request('POST', '/api/auth/register/code', {
      body: { email },
      headers: { 'x-forwarded-for': '203.0.113.213' },
    });
    const code = mailState.lastCode;
    createUser('taken-name', 'taken-password-1');

    const attempt = (username) =>
      request('POST', '/api/auth/register', {
        body: { username, email, password: 'valid-password-1', code },
        headers: { 'x-forwarded-for': '203.0.113.213' },
      });

    // 前 3 次：都探测同一个已被占用的用户名（每次消耗一次「已核验」额度）
    for (let i = 0; i < 3; i++) {
      const r = await attempt('taken-name');
      assert.equal(r.status, 409, `第 ${i + 1} 次应因冲突被拒`);
      assert.equal(r.body.error, '用户名或邮箱已被使用', '冲突文案统一，不透露具体字段');
    }

    // 第 4 次：额度用尽，必须重新获取验证码，不能再拿来探测
    const exhausted = await attempt('another-probe');
    assert.equal(exhausted.status, 400);
    assert.match(exhausted.body.error, /使用次数过多/);
  });
});

describe('BUG-72: 密码长度按字节校验（bcrypt 只取前 72 字节）', () => {
  const register = (email, password, code) =>
    request('POST', '/api/auth/register', {
      body: { username: `u${Date.now() % 100000}`, email, password, code },
      headers: { 'x-forwarded-for': '203.0.113.214' },
    });

  test('40 个汉字（120 字节）的密码被拒绝', async () => {
    const email = 'longpw@test.dev';
    await request('POST', '/api/auth/register/code', {
      body: { email },
      headers: { 'x-forwarded-for': '203.0.113.214' },
    });
    const r = await register(email, '密'.repeat(40), mailState.lastCode);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /72 字节/);
  });

  test('24 个汉字（72 字节）刚好可用', async () => {
    const email = 'okpw@test.dev';
    await request('POST', '/api/auth/register/code', {
      body: { email },
      headers: { 'x-forwarded-for': '203.0.113.214' },
    });
    const r = await register(email, '密'.repeat(24), mailState.lastCode);
    assert.equal(r.status, 200, '72 字节应放行（bcrypt 的全部有效长度）');
  });
});
