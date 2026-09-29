import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request, setBaseUrl } from './helpers.js';
import { app } from '../src/index.js';
import {
  getCachedStats,
  setCachedStats,
  invalidateStatsCache,
  statsCacheEnabled,
} from '../src/statsCache.js';
import { invalidateLibraryCaches } from '../src/libraryCaches.js';

// IMPROVE-58 第 3 条：GET /api/stats/heatmap 的 days 钳制与 statsCache 的生产口径。
// 树/搜索缓存早有生产口径验证，唯独统计缺——而它的「30s TTL + 随写路径统一失效」
// 是仪表盘正确性的一部分（缓存没被失效会让刚上传的文件在统计里消失 30 秒）。
let server;

before(async () => {
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  setBaseUrl(`http://127.0.0.1:${server.address().port}`);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  invalidateStatsCache();
});

describe('GET /api/stats/heatmap 的 days 钳制', () => {
  test('钳制在 [31, 731]，缺失/非法值回落 365，series 长度 = days', async () => {
    const cases = [
      ['?days=10', 31],
      ['?days=31', 31],
      ['?days=731', 731],
      ['?days=9999', 731],
      ['', 365],
      ['?days=abc', 365],
      ['?days=90', 90],
    ];
    for (const [qs, expected] of cases) {
      const { status, body } = await request('GET', `/api/stats/heatmap${qs}`);
      assert.equal(status, 200);
      assert.equal(body.days, expected, `${qs || '(无参数)'} 应钳制为 ${expected}`);
      assert.equal(body.series.length, expected);
    }
  });

  test('series 按天升序、最后一天是今天的本地零点', async () => {
    const { body } = await request('GET', '/api/stats/heatmap?days=31');
    const ts = body.series.map((d) => d.ts);
    assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    assert.equal(body.series.at(-1).ts, today.getTime());
    // 相邻两项严格差一天（本地时区无 DST 跳跃时成立；跨 DST 的机器按 23/25 小时放宽）
    const gap = body.series.at(-1).ts - body.series.at(-2).ts;
    assert.ok(gap >= 23 * 3600 * 1000 && gap <= 25 * 3600 * 1000, `相邻日间隔异常：${gap}`);
  });
});

describe('statsCache：只在非 test 环境启用、30s TTL、随写路径统一失效', () => {
  const asProd = (fn) => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      return fn();
    } finally {
      process.env.NODE_ENV = prev;
      invalidateStatsCache();
    }
  };

  test('test 环境不缓存（否则用例之间会读到彼此的陈旧数据）', () => {
    assert.equal(statsCacheEnabled(), false);
    setCachedStats('stats:30', { marker: 1 });
    assert.equal(getCachedStats('stats:30'), null);
  });

  test('生产口径：写入即命中同一份对象，超过 30s 过期', (t) => {
    asProd(() => {
      t.mock.timers.enable({ apis: ['Date'] });
      t.mock.timers.setTime(1_700_000_000_000);
      t.after(() => t.mock.timers.reset());

      const payload = { marker: 'stats' };
      setCachedStats('stats:30', payload);
      assert.equal(getCachedStats('stats:30'), payload, '应原样命中（同一对象引用）');

      t.mock.timers.tick(29_000);
      assert.equal(getCachedStats('stats:30'), payload, '29s 仍在 TTL 内');

      t.mock.timers.tick(2_000);
      assert.equal(getCachedStats('stats:30'), null, '第 31s 已过期');
    });
  });

  test('invalidateLibraryCaches 会清掉统计缓存（写路径的统一失效入口）', () => {
    asProd(() => {
      setCachedStats('heatmap:365', { marker: 'heat' });
      assert.ok(getCachedStats('heatmap:365'));
      invalidateLibraryCaches();
      assert.equal(getCachedStats('heatmap:365'), null);
    });
  });

  test('entries 上限 32：写满后清空重来（防任意 key 撑大 Map）', () => {
    asProd(() => {
      for (let i = 0; i <= 32; i += 1) setCachedStats(`stats:${i}`, { i });
      assert.equal(getCachedStats('stats:0'), null, '最早的条目应被清掉');
      assert.deepEqual(getCachedStats('stats:32'), { i: 32 }, '最后写入的条目保留');
    });
  });
});
