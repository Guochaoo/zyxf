import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { signedGetUrl } from '../src/oss.js';

// 下载链路的签名 URL 只能覆盖 response-content-disposition。
// 带上 response-content-type 会让 OSS 直接 400
// （InvalidRequest: Can not override response header on content-type），
// 线上表现为点「下载」必失败——见 BUG-96。
describe('signedGetUrl', () => {
  test('forceDownload 只带 content-disposition，不带 content-type', () => {
    const url = signedGetUrl('zyxf-test/ACM/DP.pptx', 600, { forceDownload: true, filename: 'DP.pptx' });
    assert.match(url, /^https:\/\//);
    assert.match(url, /response-content-disposition=attachment/);
    assert.doesNotMatch(url, /response-content-type/);
  });

  test('中文文件名经过编码，URL 里不出现原始非 ASCII 字符', () => {
    const url = signedGetUrl('zyxf-test/x.zip', 600, { forceDownload: true, filename: '中文 名.zip' });
    assert.doesNotMatch(url, /[^\x20-\x7E]/, 'URL 里不应出现原始非 ASCII 字符');
    assert.match(url, /response-content-disposition=/);
  });

  test('未要求强制下载时不带任何 response-* 覆盖', () => {
    const url = signedGetUrl('zyxf-test/a.pdf', 600);
    assert.doesNotMatch(url, /response-/);
  });
});
