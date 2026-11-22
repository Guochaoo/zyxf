import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileUrl } from '../src/oss.js';

// 下载链路有两种形态：
// - 配了 OSS_PUBLIC_BASE：干净路径，签名由 ESA 边缘用 STS 临时令牌完成（docs/DEPLOY.md §4.2.6）；
// - 没配：退回签名直链（本地开发 / 回滚）。签名只能覆盖 response-content-disposition，
//   带上 response-content-type 会让 OSS 直接 400（BUG-96）。
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

    test('返回干净路径：无签名、无过期参数，forceDownload 也不再影响 URL', () => {
      const url = fileUrl('zyxf-test/ACM/DP.pptx', { forceDownload: true, filename: 'DP.pptx' });
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

  describe('未配置下载域名（回退签名直链）', () => {
    beforeEach(() => {
      delete process.env.OSS_PUBLIC_BASE;
    });

    test('forceDownload 落成 response-content-disposition，且不覆盖 content-type', () => {
      const url = fileUrl('zyxf-test/ACM/DP.pptx', { forceDownload: true, filename: 'DP.pptx' });
      assert.match(url, /^https:\/\//);
      assert.match(url, /[?&]Signature=/);
      assert.match(url, /response-content-disposition=attachment/);
      assert.doesNotMatch(url, /response-content-type/);
    });

    test('不强制下载时显式声明 inline', () => {
      const url = fileUrl('zyxf-test/a.pdf');
      assert.match(url, /response-content-disposition=inline/);
    });
  });
});
