import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileUrl } from '../src/oss.js';

// 下载 URL 全部由 OSS_PUBLIC_BASE 拼出来：签名已经搬到 ESA 边缘（STS 临时令牌回源），
// 客户端只拿干净路径。见 docs/DEPLOY.md §4.2.6。
const prev = process.env.OSS_PUBLIC_BASE;

describe('fileUrl', () => {
  afterEach(() => {
    if (prev === undefined) delete process.env.OSS_PUBLIC_BASE;
    else process.env.OSS_PUBLIC_BASE = prev;
  });

  describe('配了下载域名', () => {
    beforeEach(() => {
      process.env.OSS_PUBLIC_BASE = 'https://oss.zyxf.top/';
    });

    test('返回干净路径：无查询串、无签名/过期参数', () => {
      const url = fileUrl('zyxf-test/ACM/DP.pptx');
      assert.equal(url, 'https://oss.zyxf.top/zyxf-test/ACM/DP.pptx');
      assert.deepEqual([...new URL(url).searchParams.keys()], []);
    });

    test('逐段编码：中文/空格/# 都编码，目录分隔符保留', () => {
      const url = fileUrl('zyxf-test/ACM/课程 #1.pdf');
      assert.doesNotMatch(url, /[^\x20-\x7E]/, 'URL 里不应出现原始非 ASCII 字符');
      assert.ok(url.includes('/zyxf-test/ACM/'), '目录分隔符不能被编码掉');
      assert.ok(!url.includes(' '));
      assert.ok(!url.includes('#'));
      assert.match(url, /%E8%AF%BE%E7%A8%8B/, '「课程」按段编码');
      assert.match(url, /%231/, '# 编码成 %23');
    });
  });

  describe('没配下载域名', () => {
    beforeEach(() => {
      delete process.env.OSS_PUBLIC_BASE;
    });

    // 刻意不给「回退签名直链」：那条路会让漏配悄悄变成另一种计费口径（¥0.5/GB）。
    test('直接报错，而不是悄悄换一条链路', () => {
      assert.throws(() => fileUrl('zyxf-test/a.pdf'), /OSS_PUBLIC_BASE/);
    });
  });
});
