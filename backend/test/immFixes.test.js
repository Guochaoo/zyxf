import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// setup.js 会 mock 掉整个 imm 模块（仅 stub 网络调用 generateWebofficeToken /
// refreshWebofficeToken）。为拿到真实的编码/超时辅助函数，这里用查询串
// ?real=1 绕开 mock，直接加载真实模块（module id 不同，不会命中 mock）。
const real = await import('../src/imm.js?real=1');

describe('BUG-03: IMM 签名/表单体编码分离', () => {
  test('percentEncodeForSign 把空格编码为 %20（RPC 签名规范）', () => {
    assert.equal(real.percentEncodeForSign('a b'), 'a%20b');
    assert.equal(real.percentEncodeForSign('高数 复习.pdf'), '%E9%AB%98%E6%95%B0%20%E5%A4%8D%E4%B9%A0.pdf');
  });

  test('percentEncodeUrlencoded 把空格编码为 +（表单体）', () => {
    assert.equal(real.percentEncodeUrlencoded('a b'), 'a+b');
    assert.equal(real.percentEncodeUrlencoded('高数 复习.pdf'), '%E9%AB%98%E6%95%B0+%E5%A4%8D%E4%B9%A0.pdf');
  });

  test('两个编码器对空格输出不同（旧 bug 是统一 %20→+）', () => {
    const sign = real.percentEncodeForSign('oss://bucket/a b.txt');
    const body = real.percentEncodeUrlencoded('oss://bucket/a b.txt');
    // 签名含 %20，表单体含 +，二者必须不同，否则签名与实际 body 不一致。
    assert.notEqual(sign, body);
    assert.ok(sign.includes('%20'));
    assert.ok(body.includes('+'));
  });

  test("特殊字符 ! ' ( ) * 保持按 RFC 3986 转义（两个编码器一致）", () => {
    for (const c of ["!'()*"]) {
      for (const enc of [real.percentEncodeForSign, real.percentEncodeUrlencoded]) {
        const out = enc(c);
        assert.ok(/^%[0-9A-F]{2}/.test(out), `expected ${c} escaped by ${enc.name}, got ${out}`);
      }
    }
    // 逐个字符核验 utf8 字节大写十六进制
    const map = { '!': '%21', "'": '%27', '(': '%28', ')': '%29', '*': '%2A' };
    for (const [ch, hex] of Object.entries(map)) {
      assert.equal(real.percentEncodeForSign(ch), hex);
      assert.equal(real.percentEncodeUrlencoded(ch), hex);
    }
  });

  test('RFC 3986 保留字符（- _ . ~）保留，/ 与 : 按规范编码', () => {
    // 未保留字符（- _ . ~) 原样保留
    assert.equal(real.percentEncodeForSign('a-b_c.d~e'), 'a-b_c.d~e');
    // / 与 : 按 encodeURIComponent 编码为 %2F / %3A（阿里云 RPC 规范同样如此）
    assert.equal(real.percentEncodeForSign('a/b/c:d'), 'a%2Fb%2Fc%3Ad');
  });
});

describe('BUG-13: IMM 请求超时错误包装', () => {
  test('Timezone/timeout 中止错误被包装成友好超时错误', () => {
    const timeoutErr = real.toImmTimeoutError('GenerateWebofficeToken', { name: 'TimeoutError', code: 23 });
    assert.ok(timeoutErr, '应返回包装后的错误');
    assert.ok(timeoutErr.message.includes('超时'));
    assert.ok(timeoutErr.message.includes('GenerateWebofficeToken'));
    assert.equal(timeoutErr.code, 'IMM_TIMEOUT');
  });

  test('AbortError 同样被包装', () => {
    const abortErr = real.toImmTimeoutError('GenerateWebofficeToken', { name: 'AbortError', code: 'ABORT_ERR' });
    assert.ok(abortErr);
    assert.equal(abortErr.code, 'IMM_TIMEOUT');
  });

  test('非超时错误原样返回 null（不包装）', () => {
    assert.equal(real.toImmTimeoutError('GenerateWebofficeToken', { name: 'TypeError', message: 'boom' }), null);
  });
});
