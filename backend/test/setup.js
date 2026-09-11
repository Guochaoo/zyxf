// Test bootstrap — loaded via --import before any test file, so the OSS mock
// registration happens before routes import oss.js (mock.module only applies
// to imports that happen after registration in this process).
//
// mock.module is experimental on Node 24 and requires the
// --experimental-test-module-mocks flag in package.json's `test` script.
// Do not drop that flag (tests fail without it); re-verify when bumping Node.
import './env.js';
import { mock } from 'node:test';
import { db } from '../src/db.js';
import * as realOss from '../src/oss.js';
import * as realLlm from '../src/llm.js';

// 认证加固后 attachUser 会按 payload.id 回查用户行（BUG-51/52：使改密/降权/删号立即生效），
// 所以任何「以某个身份发请求」的用例都必须先让该 id 真实存在，否则 token 会被判为无效。
// id 显式指定，便于用例直接把它写进 signToken 的 payload。
export function ensureTestUser({ id, username = `u${id}`, role = 'user' } = {}) {
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, 'x', ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, role = excluded.role`
  ).run(id, username, role, Date.now());
  return { id, username, role };
}

// Controllable fake OSS object store — tests write ossObjectStore.keys to
// simulate what the bucket contains (sync endpoint reads this) and
// ossObjectStore.objects to provide downloadable bodies（内容索引流水线会 get 对象）。
export const ossObjectStore = { keys: [], objects: new Map() };

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
    ossClient: () => ({
      get: async (key) => {
        if (!ossObjectStore.objects.has(key)) {
          const err = new Error('NoSuchKey');
          err.code = 'NoSuchKey';
          throw err;
        }
        return { content: ossObjectStore.objects.get(key) };
      },
    }),
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
