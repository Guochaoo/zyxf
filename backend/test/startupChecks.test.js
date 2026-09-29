import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// IMPROVE-58 第 1 条：index.js 的生产启动自检（弱 JWT / 弱密码 / 开放 CORS 拒绝启动）
// 是安全底线逻辑，但它是「进程启动期」的分支，进程内测不到——只能起子进程看退出码。
// ⚠️ db.js 在 import 阶段就打开数据库，而 ESM 的 import 求值**早于** index.js 里那段
// 生产自检，所以每次都必须把 DB_PATH 指到临时文件，否则会写到 backend/data.db。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, '..', 'src', 'index.js');

// PORT 必须是「非 0 且不冲突」的值：index.js 里是 `Number(env.PORT) || 4000`，
// 传 '0' 会被当成 falsy 回落到 4000——而开发机的后端正好占着 4000。
const childEnv = (extra) => ({
  ...process.env,
  DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zyxf-startup-')), 't.db'),
  HOST: '127.0.0.1',
  PORT: String(4600 + Math.floor(Math.random() * 300)),
  ...extra,
});

/** 起子进程跑到自己退出（拒绝启动的场景），拿退出码与输出。 */
function runStartup(env) {
  const res = spawnSync(process.execPath, [entry], { env: childEnv(env), encoding: 'utf8', timeout: 8000 });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

/** 起子进程，等到它真的开始监听（或自己退出）就立即收工，不等满超时。 */
function runUntilListening(env, timeout = 5000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry], { env: childEnv(env) });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve({ status, stdout, stderr });
    };
    const timer = setTimeout(() => finish('timeout'), timeout);
    child.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.includes('[zyxf-backend] listening on')) finish('listening');
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('exit', (code) => finish(code));
  });
}

// 生产环境下可用的最小合法配置（注意值里不能出现 change/example/placeholder
// /secret/dev/test/admin123/123456 这些自检词——连续数字 0-9 里就含 123456）。
const SAFE = {
  NODE_ENV: 'production',
  JWT_SECRET: '9f2c7a1e5b3d8046af12cd34ef56ab78',
  ADMIN_PASSWORD: 'Str0ng-Pr0duction-Passw0rd',
  CORS_ORIGIN: 'https://zyxf.top',
};

describe('生产启动自检（NODE_ENV=production）', () => {
  test('弱 JWT_SECRET（示例占位值）拒绝启动并指明变量', () => {
    const r = runStartup({ ...SAFE, JWT_SECRET: 'please-change-me-to-a-random-32-byte-string' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /FATAL/);
    assert.match(r.stderr, /JWT_SECRET/);
    assert.doesNotMatch(r.stdout, /listening on/);
  });

  test('JWT_SECRET 长度不足 32 也拒绝启动（不含弱词）', () => {
    const r = runStartup({ ...SAFE, JWT_SECRET: 'AbCdEf0123456789xyz' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /JWT_SECRET/);
  });

  test('弱 ADMIN_PASSWORD（admin123）拒绝启动', () => {
    const r = runStartup({ ...SAFE, ADMIN_PASSWORD: 'admin123' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ADMIN_PASSWORD/);
  });

  test('过短 ADMIN_PASSWORD（<12 位）拒绝启动', () => {
    const r = runStartup({ ...SAFE, ADMIN_PASSWORD: 'Ab3$xyz9' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ADMIN_PASSWORD/);
  });

  test('CORS_ORIGIN 缺失或为 "*" 拒绝启动（不允许开放 CORS）', () => {
    const missing = runStartup({ ...SAFE, CORS_ORIGIN: '' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /CORS_ORIGIN/);

    const wildcard = runStartup({ ...SAFE, CORS_ORIGIN: '*' });
    assert.equal(wildcard.status, 1);
    assert.match(wildcard.stderr, /CORS_ORIGIN/);
  });

  test('合法配置不再误拒：能真正起来监听（自检只拦不安全默认值）', async () => {
    const r = await runUntilListening(SAFE);
    assert.equal(r.status, 'listening');
    assert.doesNotMatch(r.stderr, /FATAL/);
  });

  test('开发环境不做生产自检（默认弱值也能起）', async () => {
    const r = await runUntilListening({ NODE_ENV: 'development', JWT_SECRET: '', ADMIN_PASSWORD: '' });
    assert.equal(r.status, 'listening');
    assert.doesNotMatch(r.stderr, /FATAL/);
  });
});
