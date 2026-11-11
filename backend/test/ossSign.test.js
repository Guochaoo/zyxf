import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { signedGetUrl } from '../src/oss.js';

// 下载链路的签名 URL 只能覆盖 response-content-disposition。
// 带上 response-content-type 会让 OSS 直接 400
// （InvalidRequest: Can not override response header on content-type），
// 线上表现为点「下载」必失败——见 BUG-96。
//
// 该参数**始终存在**：强制下载时是 attachment，其余情况显式声明 inline
// （桶关掉强制下载 / 绑定自有域名后 PDF、TXT 才能直接内嵌，见 b398dd4）。
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

  test('未要求强制下载时显式声明 inline，且仍不覆盖 content-type', () => {
    const url = signedGetUrl('zyxf-test/a.pdf', 600);
    const overrides = [...new URL(url).searchParams.keys()].filter((k) => k.startsWith('response-'));
    // 只允许 content-disposition 这一个覆盖：多一个就可能再踩 BUG-96 的 400。
    assert.deepEqual(overrides, ['response-content-disposition']);
    assert.match(url, /response-content-disposition=inline/);
  });
});
