import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientLlmConfig } from '../src/llm.js';

const VALID = { apiKey: 'k', model: 'm' };

describe('BUG-20: resolveClientLlmConfig SSRF hardening', () => {
  test('rejects non-https protocols', async () => {
    const http = await resolveClientLlmConfig({ ...VALID, baseUrl: 'http://llm.test/v1' });
    assert.equal(http, null);
    const ftp = await resolveClientLlmConfig({ ...VALID, baseUrl: 'ftp://llm.test' });
    assert.equal(ftp, null);
  });

  test('rejects loopback literal IPv4/IPv6', async () => {
    const v4 = await resolveClientLlmConfig({ ...VALID, baseUrl: 'https://127.0.0.1:8080/v1' });
    assert.equal(v4, null);
    const v6 = await resolveClientLlmConfig({ ...VALID, baseUrl: 'https://[::1]:8080/v1' });
    assert.equal(v6, null);
    const localhost = await resolveClientLlmConfig({ ...VALID, baseUrl: 'https://localhost/v1' });
    assert.equal(localhost, null);
  });

  test('rejects private RFC1918 ranges', async () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1']) {
      const r = await resolveClientLlmConfig({ ...VALID, baseUrl: `https://${ip}/v1` });
      assert.equal(r, null, `${ip} should be rejected`);
    }
  });

  test('rejects link-local and cloud metadata addresses', async () => {
    const linkLocal = await resolveClientLlmConfig({ ...VALID, baseUrl: 'https://169.254.169.254/latest/meta-data' });
    assert.equal(linkLocal, null);
    const cgnat = await resolveClientLlmConfig({ ...VALID, baseUrl: 'https://100.64.0.1/v1' });
    assert.equal(cgnat, null);
  });

  test('rejects 0.0.0.0/8 and IPv4-mapped loopback', async () => {
    const zero = await resolveClientLlmConfig({ ...VALID, baseUrl: 'https://0.0.0.0/v1' });
    assert.equal(zero, null);
    const mapped = await resolveClientLlmConfig({ ...VALID, baseUrl: 'https://[::ffff:127.0.0.1]/v1' });
    assert.equal(mapped, null);
  });

  test('accepts a public https literal IP without DNS lookup', async () => {
    const ok = await resolveClientLlmConfig({ ...VALID, baseUrl: 'https://8.8.8.8/v1/' });
    assert.ok(ok);
    assert.equal(ok.baseUrl, 'https://8.8.8.8/v1');
  });

  // 审计修复：IPv6 分支原先只拦 ::1 / ::ffff:，整个内网地址族（fc00::/7 ULA、
  // fe80::/10 链路本地、ff00::/8 组播）都能绕过。阿里云内网元数据在 IPv6 下就是
  // fd00:0:0:0::1，恰在未拦截段内。
  test('rejects IPv6 private / link-local / multicast / site-local ranges', async () => {
    const cases = [
      'https://[fd00:0:0:0::1]/v1', // ULA（阿里云 IPv6 元数据）
      'https://[fc00::1]/v1', // ULA
      'https://[fe80::1]/v1', // 链路本地
      'https://[fec0::1]/v1', // 站点本地（已废弃）
      'https://[ff02::1]/v1', // 组播
      'https://[::]/v1', // 未指定
    ];
    for (const baseUrl of cases) {
      assert.equal(await resolveClientLlmConfig({ ...VALID, baseUrl }), null, `${baseUrl} 应被拒绝`);
    }
  });

  test('accepts a public global-unicast IPv6 literal', async () => {
    const ok = await resolveClientLlmConfig({ ...VALID, baseUrl: 'https://[2606:4700:4700::1111]/v1' });
    assert.ok(ok, '全局单播 2000::/3 应放行');
  });
});
