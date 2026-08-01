// Test bootstrap — loaded via --import before any test file, so the OSS mock
// registration happens before routes import oss.js (mock.module only applies
// to imports that happen after registration in this process).
import './env.js';
import { mock } from 'node:test';
import * as realOss from '../src/oss.js';

// Stub the network calls to Aliyun OSS while keeping the pure signature
// helpers (buildPostPolicy, signedGetUrl, immPreviewUrl) intact.
mock.module('../src/oss.js', {
  exports: {
    ...realOss,
    copyOssObject: async () => {},
    putEmptyOssObject: async () => {},
    deleteOssObjectIfExists: async () => {},
  },
});
