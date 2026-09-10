import { describe, test, expect } from 'vitest';
import en from '../i18n/en.js';
import zh from '../i18n/zh.js';

// en.js 头部声明「mirrors zh.js key-for-key」，此前无任何测试保障——
// 新增/删改键时容易只改一侧，运行时表现为某语言下文案缺失。
function flattenKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}

const collectStrings = (obj) =>
  Object.values(obj).flatMap((v) =>
    v && typeof v === 'object' ? collectStrings(v) : typeof v === 'string' ? [v] : []
  );

describe('i18n 字典一致性', () => {
  test('en 与 zh 的键集合完全一致', () => {
    const a = flattenKeys(en).sort();
    const b = flattenKeys(zh).sort();
    expect(a.filter((k) => !b.includes(k))).toEqual([]); // 仅 en 有
    expect(b.filter((k) => !a.includes(k))).toEqual([]); // 仅 zh 有
  });

  test('英语文案不含旧缩写 GZYX（应为 ZYXF）', () => {
    const stale = collectStrings(en).filter((s) => s.includes('GZYX'));
    expect(stale).toEqual([]);
  });

  test('英语品牌名用 ZYXF 且资料库只用一个词', () => {
    expect(en.app.brand).toBe('ZYXF Library');
    // 机构名保留英文词，缩写为 ZYXF
    expect(en.app.title).toBe('ZYXF Study Center');
  });
});
