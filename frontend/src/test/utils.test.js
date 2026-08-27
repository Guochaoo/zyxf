import { describe, test, expect, vi } from 'vitest';
import {
  formatSize,
  formatDate,
  getPreviewKind,
  isLargeFile,
  LARGE_FILE_THRESHOLD,
  errMsg,
  downloadFileById,
} from '../utils.js';

describe('formatSize', () => {
  test('null/undefined show a dash', () => {
    expect(formatSize(null)).toBe('-');
    expect(formatSize(undefined)).toBe('-');
  });

  test('formats bytes, KB, MB, GB', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatSize(1.5 * 1024 * 1024 * 1024)).toBe('1.50 GB');
  });
});

describe('formatDate', () => {
  test('falsy timestamps show a dash', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(0)).toBe('-');
  });

  test('formats a timestamp as YYYY-MM-DD', () => {
    const d = new Date(2026, 0, 5, 9, 7); // local time
    expect(formatDate(d.getTime())).toBe('2026-01-05');
  });

  test('zero-pads month/day', () => {
    const d = new Date(2026, 10, 2, 3, 4);
    expect(formatDate(d.getTime())).toBe('2026-11-02');
  });
});

describe('getPreviewKind', () => {
  test('office extensions', () => {
    for (const ext of ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv', 'wps', 'dps', 'et', '.DOCX']) {
      expect(getPreviewKind(ext)).toBe('office');
    }
  });

  test('archives', () => {
    for (const ext of ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2']) {
      expect(getPreviewKind(ext)).toBe('archive');
    }
  });

  test('everything else is unknown', () => {
    expect(getPreviewKind('exe')).toBe('unknown');
    expect(getPreviewKind('')).toBe('unknown');
    expect(getPreviewKind(null)).toBe('unknown');
  });
});

describe('isLargeFile', () => {
  test('threshold check', () => {
    expect(isLargeFile(LARGE_FILE_THRESHOLD + 1)).toBe(true);
    expect(isLargeFile(LARGE_FILE_THRESHOLD)).toBe(false);
    expect(isLargeFile(null)).toBe(false);
  });
});

describe('errMsg', () => {
  test('prefers the backend error message', () => {
    expect(errMsg({ response: { data: { error: 'backend msg' } } })).toBe('backend msg');
  });

  test('falls back to the error message then the default', () => {
    expect(errMsg(new Error('network down'))).toBe('network down');
    expect(errMsg({})).toBe('操作失败');
    expect(errMsg({}, '自定义')).toBe('自定义');
  });
});

describe('downloadFileById', () => {
  test('fetches the signed url and triggers a download', async () => {
    const getFileUrl = vi.fn().mockResolvedValue({ url: 'https://oss.test/file' });
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) }));

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    await downloadFileById({ id: 7, name: 'a.pdf' }, getFileUrl);

    expect(getFileUrl).toHaveBeenCalledWith(7, { download: true });
    expect(appendSpy).toHaveBeenCalled();
    const anchor = appendSpy.mock.calls[0][0];
    expect(anchor.href).toBe('blob:fake');
    expect(anchor.download).toBe('a.pdf');
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    appendSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  test('throws when the download request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(downloadFileById({ id: 1, name: 'x' }, vi.fn().mockResolvedValue({ url: 'u' }))).rejects.toThrow('下载失败');
    vi.unstubAllGlobals();
  });
});
