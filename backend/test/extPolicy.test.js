import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_EXTS,
  BLOCKED_EXTS,
  normalizeExt,
  isExtAllowed,
  shouldForceDownload,
  PREVIEWABLE_EXTS,
} from '../src/extPolicy.js';

describe('extPolicy', () => {
  test('normalizeExt strips leading dot and lowercases', () => {
    assert.equal(normalizeExt('.PDF'), 'pdf');
    assert.equal(normalizeExt('Docx'), 'docx');
    assert.equal(normalizeExt(undefined), '');
    assert.equal(normalizeExt(null), '');
    assert.equal(normalizeExt(''), '');
  });

  test('allowed office/pdf/text/archive extensions pass', () => {
    for (const ext of ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'pdf', 'txt', 'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'wps', 'dps', 'et']) {
      assert.ok(isExtAllowed(ext), `expected ${ext} to be allowed`);
    }
  });

  test('blocked extensions are rejected even though some look innocuous', () => {
    for (const ext of BLOCKED_EXTS) {
      assert.ok(!isExtAllowed(ext), `expected blocked ${ext} to be rejected`);
    }
  });

  test('unknown / empty / weird extensions are rejected', () => {
    assert.ok(!isExtAllowed('exe'));
    assert.ok(!isExtAllowed('html'));
    assert.ok(!isExtAllowed('js'));
    assert.ok(!isExtAllowed('dll'));
    assert.ok(!isExtAllowed('unknown'));
    assert.ok(!isExtAllowed(''));
    assert.ok(!isExtAllowed('.'));
    assert.ok(!isExtAllowed('a b'));
  });

  test('uppercase or dotted input is normalized before checking', () => {
    assert.ok(isExtAllowed('.DOCX'));
    assert.ok(isExtAllowed('PDF'));
    assert.ok(!isExtAllowed('.EXE'));
  });

  test('shouldForceDownload: archives and anything blocked/empty are download-only', () => {
    for (const ext of ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2']) {
      assert.ok(shouldForceDownload(ext), `expected ${ext} to force download`);
    }
    assert.ok(shouldForceDownload('exe'));
    assert.ok(shouldForceDownload('html'));
    assert.ok(shouldForceDownload(''));
  });

  test('shouldForceDownload: previewable types are inline', () => {
    for (const ext of ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv']) {
      assert.ok(!shouldForceDownload(ext), `expected ${ext} to be inline`);
    }
  });

  test('PREVIEWABLE_EXTS = allowed minus archives', () => {
    for (const ext of PREVIEWABLE_EXTS) {
      assert.ok(ALLOWED_EXTS.has(ext), `${ext} must be allowed`);
      assert.ok(!shouldForceDownload(ext), `${ext} must not force download`);
    }
    for (const ext of ['zip', 'rar', '7z']) {
      assert.ok(!PREVIEWABLE_EXTS.has(ext));
    }
  });
});
