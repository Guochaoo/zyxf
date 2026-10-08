// Test bootstrap — loaded via --import before any test file, so the OSS mock
// registration happens before routes import oss.js (mock.module only applies
// to imports that happen after registration in this process).
//
// mock.module is experimental on Node 24 and requires the
// --experimental-test-module-mocks flag in package.json's `test` script.
// Do not drop that flag (tests fail without it); re-verify when bumping Node.
//
// ⚠️ 下面用的是 `mock.module(spec, { exports })` 这个**单一对象**选项，它从 Node 24.15.0
// 才有（24.13 / 24.14 会静默忽略该选项 → mock 出来的模块零命名导出 → 所有 import 它的
// 测试文件在 import 阶段 SyntaxError，表现为「16/30 个文件崩、pass 117/fail 16」）。
// 所以 backend/package.json 的 engines 是 ">=24.15"，CI 也 pin 在 24.15 上跑。
// 别为了兼容更旧的 24.x 把 exports 换回 namedExports：后者已 deprecated、Node 25 会移除
// （engines 的 <25 上界就是留给这次迁移的）。
import './env.js';
import { mock } from 'node:test';
import * as realOss from '../src/oss.js';
import * as realLlm from '../src/llm.js';

// ensureTestUser 现在住在 seed.js（纯 DB helper）：helpers.js 的 userToken() 也要用它，而
// helpers.js 不该依赖这个「注册模块 mock」的文件。这里继续 re-export，既有 import 保持不变。
export { ensureTestUser } from './seed.js';

// Controllable fake OSS object store — tests write ossObjectStore.keys to
// simulate what the bucket contains (sync endpoint reads this).
export const ossObjectStore = { keys: [] };

// Stub the network calls to Aliyun OSS while keeping the pure signature
// helpers (buildPostPolicy, signedGetUrl) intact.
mock.module('../src/oss.js', {
  exports: {
    ...realOss,
    listOssObjects: async () =>
      ossObjectStore.keys.map((key) => ({ key, size: key.endsWith('/') ? 0 : 1024 })),
    copyOssObject: async () => {},
    putEmptyOssObject: async () => {},
    deleteOssObjectIfExists: async () => {},
  },
});

// IMM WebOffice token generation hits the live IMM API — stub it.
mock.module('../src/imm.js', {
  exports: {
    generateWebofficeToken: async (file) => ({
      url: `https://imm.test/office/f/${encodeURIComponent(file.oss_key)}`,
      token: 'test-access-token',
      refresh_token: 'test-refresh-token',
    }),
    refreshWebofficeToken: async ({ accessToken }) => ({
      token: `refreshed-${accessToken}`,
      refresh_token: 'test-refresh-token-2',
    }),
  },
});

// LLM client — scriptable fake. Tests set llmState.enabled and load
// llmState.script with one array of yielded events per upstream call.
// 纯函数（resolveClientLlmConfig 等）保留真实实现，仅 stub 网络相关导出。
export const llmState = { enabled: false, script: [], calls: [] };

mock.module('../src/llm.js', {
  exports: {
    ...realLlm,
    isLlmEnabled: () => llmState.enabled,
    chatStream: async function* fakeChatStream(opts) {
      llmState.calls.push(opts);
      const events = llmState.script.shift() ?? [];
      if (events && events.__throw) throw new Error(events.__throw);
      for (const ev of events) yield ev;
    },
  },
});

// DirectMail 邮件客户端 — 不真正发信。sendVerificationCode 收到的验证码
// 记录在 mailState.lastCode，注册流程测试据此取回明文验证码。
export const mailState = { enabled: true, calls: [], lastCode: null, failNext: false };

mock.module('../src/mail.js', {
  exports: {
    isMailEnabled: () => mailState.enabled,
    sendVerificationCode: async (email, code) => {
      mailState.calls.push({ email, code });
      // 测试钩子：模拟发信失败（用于验证「失败不消耗冷却/额度、不覆写旧验证码」）。
      if (mailState.failNext) {
        mailState.failNext = false;
        throw new Error('mail service down');
      }
      mailState.lastCode = code;
    },
  },
});
