// Test bootstrap — loaded via --import before any test file, so the OSS mock
// registration happens before routes import oss.js (mock.module only applies
// to imports that happen after registration in this process).
//
// mock.module is experimental on Node 24 and requires the
// --experimental-test-module-mocks flag in package.json's `test` script.
// Do not drop that flag (tests fail without it); re-verify when bumping Node.
import './env.js';
import { mock } from 'node:test';
import * as realOss from '../src/oss.js';
import * as realLlm from '../src/llm.js';

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
