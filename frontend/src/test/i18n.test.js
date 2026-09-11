import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import en from '../i18n/en.js';
import zh from '../i18n/zh.js';

// 扫出「同一个对象字面量里重复定义的键」。JS 里后写者生效，靠前那份完全无效——
// 表现为「改了没反应」，而键集合/取值测试都发现不了（zh.js 的 actionFailed/today 就中过招）。
// 逐字符扫描并跳过注释与字符串（字典里有 `{{count}}` 这类含花括号的字符串，
// 用朴素的花括号计数会误判）；项目未安装 @babel/parser，故自己实现。
function findDuplicateKeys(source) {
  const dups = [];
  const stack = [{ keys: new Map() }];
  const isIdent = (s) => /^[A-Za-z_$][\w$]*$/.test(s);
  let i = 0;
  let line = 1;
  let buf = '';
  let pendingLine = null;

  while (i < source.length) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (c === '/' && c2 === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        if (source[i] === '\n') line += 1;
        i += 1;
      }
      i += 1;
      buf = '';
      pendingLine = null;
      continue;
    }
    if (c === '{') {
      stack.push({ keys: new Map() });
      buf = '';
      pendingLine = null;
      i += 1;
      continue;
    }
    if (c === '}') {
      if (stack.length > 1) stack.pop();
      buf = '';
      pendingLine = null;
      i += 1;
      continue;
    }
    if (c === ',' || c === ';') {
      buf = '';
      pendingLine = null;
      i += 1;
      continue;
    }
    if (c === ':') {
      const name = buf.trim();
      const frame = stack[stack.length - 1];
      if (isIdent(name)) {
        const at = pendingLine ?? line;
        if (frame.keys.has(name)) {
          dups.push(`${name}（line ${at}，首次 line ${frame.keys.get(name)}）`);
        } else {
          frame.keys.set(name, at);
        }
      }
      buf = '';
      pendingLine = null;
      i += 1;
      continue;
    }
    if (/\s/.test(c)) {
      buf = '';
    } else {
      buf += c;
      if (isIdent(buf)) pendingLine = line;
    }
    i += 1;
  }
  return dups;
}

// en.js 头部声明「mirrors zh.js key-for-key」，此前无任何测试保障——
// 新增/删改键时容易只改一侧，运行时表现为某语言下文案缺失。
// 注意：英文用 i18next 复数后缀（_one/_other），键名会多出后缀；比较时归一化，
// 避免把合法的复数形式误判为「仅 en 有」。
const PLURAL = /_(one|other|two|few|many|zero)$/;

function flattenKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}

const normalize = (keys) => [...new Set(keys.map((k) => k.replace(PLURAL, '')))].sort();

const collectStrings = (obj) =>
  Object.values(obj).flatMap((v) =>
    v && typeof v === 'object' ? collectStrings(v) : typeof v === 'string' ? [v] : []
  );

describe('i18n 字典一致性', () => {
  // 自检：检测器必须真的能抓到重复键，否则下面的断言是空转的。
  test('重复键检测器本身有效', () => {
    expect(findDuplicateKeys('const a = { x: 1, x: 2 };')).toHaveLength(1);
    expect(findDuplicateKeys('const a = { x: 1, y: 2 };')).toHaveLength(0);
    // 字符串里的花括号不得干扰层级判断
    expect(findDuplicateKeys("const a = { x: '{{count}} 次', y: { z: 1, z: 2 } };")).toHaveLength(1);
  });

  test('zh/en 字典内不存在同一对象里的重复键', () => {
    for (const file of ['../i18n/zh.js', '../i18n/en.js']) {
      const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(findDuplicateKeys(src), `${file} 有重复键`).toEqual([]);
    }
  });

  test('en 与 zh 的键集合完全一致（英文复数后缀已归一化）', () => {
    const a = normalize(flattenKeys(en));
    const b = normalize(flattenKeys(zh));
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

  // 中文文案里不应出现英文句子（数组内的 icon 名、语言自称、协议专有名词等白名单除外）。
  test('中文文案不含未翻译的英文句子', () => {
    const allow = new Set([
      'settings.langOptions.en',
      'settings.ai.apiKey',
      // 协议名是官方专有名词（与下拉 option 的 id 一一对应），不做本地化
      'settings.ai.protocolOpenaiCompletions',
      'settings.ai.protocolOpenaiResponses',
      'settings.ai.protocolAnthropicMessages',
    ]);
    const offenders = [];
    const walk = (obj, prefix = '') => {
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'string') {
          if (!allow.has(path) && !/[\u4e00-\u9fff]/.test(v) && /[A-Za-z]{2,}/.test(v)) {
            offenders.push(`${path}: ${JSON.stringify(v)}`);
          }
        } else if (v && typeof v === 'object') {
          walk(v, path);
        }
      }
    };
    // icon 字段是标识符而非文案，跳过
    const stripIcons = (obj) =>
      Array.isArray(obj)
        ? obj.map(stripIcons)
        : obj && typeof obj === 'object'
          ? Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'icon').map(([k, v]) => [k, stripIcons(v)]))
          : obj;
    walk(stripIcons(zh));
    expect(offenders).toEqual([]);
  });

  test('英文提交按钮加载态不再是「前两字 + ing…」拼出的坏词', () => {
    expect(en.auth.loginLoading).toBe('Signing in…');
    expect(en.auth.registerLoading).toBe('Registering…');
    // 旧实现会产出 Siing… / Reing…
    expect(en.auth.loginLoading).not.toMatch(/Siing/);
    expect(en.auth.registerLoading).not.toMatch(/Reing/);
  });

  // 英文界面不该出现中文：源码里的中文只能来自字典或注释。
  // 曾有多处文案硬编码在组件里（错误提示、拖拽提示、'今日' 等），英文下会露中文。
  test('源码中不存在硬编码的中文文案（注释与 ICP 备案号除外）', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const CJK = /[\u4e00-\u9fff]/;
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!/node_modules|test|i18n/.test(p)) walk(p);
        } else if (/\.jsx?$/.test(e.name)) files.push(p);
      }
    };
    walk('src');
    const offenders = [];
    for (const f of files) {
      // 先整体剥离注释（含多行块注释），再按行找中文；行内 // 需在去 CR 之后匹配。
      const stripped = fs
        .readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/\r$/, '').replace(/\/\/.*$/, ''));
      stripped.forEach((code, i) => {
        if (!CJK.test(code)) return;
        if (code.includes('陕ICP备')) return; // 备案号按法规原样展示，不翻译
        offenders.push(`${f}:${i + 1} ${code.trim().slice(0, 80)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
