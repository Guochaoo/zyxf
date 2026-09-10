import { describe, test, expect } from 'vitest';
// IMPROVE-19：前端只做展示分类，权威表在后端。这里直接引入后端策略做交叉校验，
// 防止日后「后端白名单加了类型、前端仍判 unknown → 预览退化成只能下载」的静默漂移。
import {
  ALLOWED_EXTS,
  ARCHIVE_EXTS,
  BLOCKED_EXTS,
  PREVIEWABLE_EXTS,
  isExtAllowed,
  shouldForceDownload,
} from '@backend/extPolicy.js';
import { getPreviewKind } from '../utils.js';

describe('前端扩展名分类与后端白名单同源', () => {
  test('白名单里的每个类型前端都能分类（不会退化成 unknown）', () => {
    for (const ext of ALLOWED_EXTS) {
      const kind = getPreviewKind(ext);
      expect(kind, `${ext} 未分类`).not.toBe('unknown');
      expect(kind).toBe(ARCHIVE_EXTS.has(ext) ? 'archive' : 'office');
    }
  });

  test('压缩包只下载不预览：前端判 archive，后端强制下载', () => {
    for (const ext of ARCHIVE_EXTS) {
      expect(getPreviewKind(ext)).toBe('archive');
      expect(shouldForceDownload(ext)).toBe(true);
    }
  });

  test('可预览类型前后端一致', () => {
    for (const ext of PREVIEWABLE_EXTS) {
      expect(getPreviewKind(ext)).toBe('office');
      expect(shouldForceDownload(ext)).toBe(false);
    }
  });

  test('被拦类型前端也不当作可预览', () => {
    for (const ext of BLOCKED_EXTS) {
      expect(isExtAllowed(ext)).toBe(false);
      expect(getPreviewKind(ext)).toBe('unknown');
    }
  });
});
