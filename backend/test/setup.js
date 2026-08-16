// Test bootstrap — loaded via --import before any test file, so the OSS mock
// registration happens before routes import oss.js (mock.module only applies
// to imports that happen after registration in this process).
import './env.js';
import { mock } from 'node:test';
import * as realOss from '../src/oss.js';

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
