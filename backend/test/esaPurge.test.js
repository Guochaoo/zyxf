import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isPurgeEnabled, purgeFileKeys, purgeUrls } from '../src/esaPurge.js';

// 下载域的边缘缓存是 7 天（docs/DEPLOY.md §4.2.6），删除/改名靠这里刷缓存。
// 关键约定：未配置时静默跳过、失败不抛（不能让删除操作跟着失败）。
const prevSite = process.env.ESA_SITE_ID;

afterEach(() => {
  if (prevSite === undefined) delete process.env.ESA_SITE_ID;
  else process.env.ESA_SITE_ID = prevSite;
});

function fakeClient(impl) {
  const calls = [];
  return {
    calls,
    async request(action, params) {
      calls.push({ action, params });
      if (impl) return impl(action, params);
      return { TaskId: 'fake-task' };
    },
  };
}

describe('esaPurge', () => {
  test('没配 ESA_SITE_ID 时静默跳过，一个请求都不发', async () => {
    delete process.env.ESA_SITE_ID;
    assert.equal(isPurgeEnabled(), false);
    const client = fakeClient();
    assert.deepEqual(await purgeUrls(['https://oss.test/a'], { client }), { skipped: true });
    assert.equal(client.calls.length, 0);
  });

  test('一次请求带一批 URL：Type=file，Content.Files 是数组', async () => {
    process.env.ESA_SITE_ID = '123';
    const client = fakeClient();
    const res = await purgeUrls(['https://oss.test/a', 'https://oss.test/b'], { client });
    assert.equal(res.purged, 2);
    assert.equal(client.calls.length, 1);
    const { action, params } = client.calls[0];
    assert.equal(action, 'PurgeCaches');
    assert.equal(params.Type, 'file');
    assert.equal(params.SiteId, '123');
    assert.deepEqual(JSON.parse(params.Content), {
      Files: ['https://oss.test/a', 'https://oss.test/b'],
    });
  });

  test('重复 URL 会去重', async () => {
    process.env.ESA_SITE_ID = '123';
    const client = fakeClient();
    await purgeUrls(['https://oss.test/a', 'https://oss.test/a'], { client });
    assert.deepEqual(JSON.parse(client.calls[0].params.Content).Files, ['https://oss.test/a']);
  });

  test('超过 100 个会分批（API 单次塞太多会被拒）', async () => {
    process.env.ESA_SITE_ID = '123';
    const client = fakeClient();
    const urls = Array.from({ length: 250 }, (_, i) => `https://oss.test/f${i}`);
    const res = await purgeUrls(urls, { client });
    assert.equal(res.purged, 250);
    assert.equal(client.calls.length, 3);
    const sizes = client.calls.map((c) => JSON.parse(c.params.Content).Files.length);
    assert.deepEqual(sizes, [100, 100, 50]);
  });

  test('刷新失败不抛，只把错误收集回来', async () => {
    process.env.ESA_SITE_ID = '123';
    const client = fakeClient(() => {
      throw new Error('InvalidContent');
    });
    const res = await purgeUrls(['https://oss.test/a'], { client });
    assert.equal(res.purged, 0);
    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0], /InvalidContent/);
  });

  test('purgeFileKeys 把 OSS key 拼成下载 URL（逐段编码）', async () => {
    process.env.ESA_SITE_ID = '123';
    const client = fakeClient();
    await purgeFileKeys(['zyxf-test/ACM/a b.pdf'], { client });
    assert.deepEqual(JSON.parse(client.calls[0].params.Content).Files, [
      'https://oss.test/zyxf-test/ACM/a%20b.pdf',
    ]);
  });

  test('没配下载域名时跳过（本地/测试环境没有 CDN）', async () => {
    process.env.ESA_SITE_ID = '123';
    const prevBase = process.env.OSS_PUBLIC_BASE;
    delete process.env.OSS_PUBLIC_BASE;
    try {
      const client = fakeClient();
      const res = await purgeFileKeys(['zyxf-test/a.pdf'], { client });
      assert.equal(res.skipped, true);
      assert.equal(client.calls.length, 0);
    } finally {
      process.env.OSS_PUBLIC_BASE = prevBase;
    }
  });
});
