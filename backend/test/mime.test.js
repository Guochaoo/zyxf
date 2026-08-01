import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mimeOf } from '../src/mime.js';

describe('mime', () => {
  test('known extensions map to their mime types', () => {
    assert.equal(mimeOf('pdf'), 'application/pdf');
    assert.equal(mimeOf('docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(mimeOf('xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(mimeOf('pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    assert.equal(mimeOf('txt'), 'text/plain; charset=utf-8');
    assert.equal(mimeOf('zip'), 'application/zip');
  });

  test('extension matching is case-insensitive and dot-tolerant', () => {
    assert.equal(mimeOf('.PDF'), 'application/pdf');
    assert.equal(mimeOf('JPG'), 'image/jpeg');
  });

  test('unknown or empty extension returns null', () => {
    assert.equal(mimeOf('nope'), null);
    assert.equal(mimeOf(''), null);
    assert.equal(mimeOf(null), null);
  });
});
