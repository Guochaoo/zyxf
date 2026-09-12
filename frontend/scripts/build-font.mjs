// Generate the web font that ships with the app.
//
// Why this exists (BUG-99): the site used to serve `public/fonts/OPPO Sans 4.0.ttf`
// verbatim — 21.7 MB, the single largest thing on the first paint. Subsetting is the
// normal way to use the licence's "embed, bundle ... with any software" grant for a
// CJK face, so the pristine source is kept in node_modules (npm-managed, never
// committed) and this derived web build is emitted instead. Same font, same weight
// axis, 8x smaller payload. The notice obligations are met by keeping the licence
// text at public/licenses/ and linking it from the site footer; see IMPROVE-46.
//
// The charset is GB2312 (6,763 hanzi) + ASCII + common typography, which covers
// essentially all UI text and the overwhelming majority of resource filenames.
// A character outside it falls through to the next family in the CSS stack
// (PingFang SC / Microsoft YaHei), so it still renders — just in the system face.
//
// IMPROVE-54：单一 woff2（2.7 MB）拆成两层，按 unicode-range 渐进加载——
//  - opposans-subset.woff2「常用层」：ASCII + GB2312 符号 + 一级汉字（3,755 字）
//    + 源码实际出现的字符。UI 文案永远命中它，生僻字也提前收编（源码扫描）。
//  - opposans-ext.woff2「生僻层」：二级汉字（3,008 字）中不在常用层的部分，
//    仅当页面真的渲染到这些字（用户上传的文件名）时浏览器才下载。
// 两层来自同一字体源，度量一致；@font-face 生成到 opposans.css，index.css 引入。
//
// Run: node scripts/build-font.mjs      (wired to prebuild / predev / pretest)

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..');

const SOURCE = join(FRONTEND, 'node_modules/@fontpkg/oppo-sans-4-0/OPPO Sans 4.0.ttf');
const OUT_DIR = join(FRONTEND, 'src/assets/fonts');
const OUT_BASE = join(OUT_DIR, 'opposans-subset.woff2');
const OUT_EXT = join(OUT_DIR, 'opposans-ext.woff2');
const OUT_CSS = join(OUT_DIR, 'opposans.css');

/** GB2312 decoded through Node's full-ICU, split by 区位：
 *  0xA1-0xA9 符号区 / 0xB0-0xD7 一级汉字 / 0xD8-0xF7 二级汉字。 */
function gb2312Chars() {
  const out = { symbols: new Set(), level1: new Set(), level2: new Set() };
  for (let hi = 0xa1; hi < 0xf8; hi++) {
    const bucket = hi < 0xb0 ? 'symbols' : hi < 0xd8 ? 'level1' : 'level2';
    for (let lo = 0xa1; lo < 0xff; lo++) {
      try {
        out[bucket].add(new TextDecoder('gb2312', { fatal: true }).decode(Uint8Array.from([hi, lo])));
      } catch {
        // not a valid GB2312 code point — skip
      }
    }
  }
  return out;
}

/** Every CJK character that actually appears in the front-end source. */
function sourceChars(dir) {
  const out = new Set();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === 'assets') continue;
      for (const c of sourceChars(full)) out.add(c);
      continue;
    }
    if (!['.js', '.jsx', '.css', '.json'].includes(extname(entry.name))) continue;
    for (const ch of readFileSync(full, 'utf8')) {
      if (ch.codePointAt(0) > 0x2000) out.add(ch);
    }
  }
  return out;
}

function buildCharsets() {
  const gb = gb2312Chars();
  // 常用层 = 符号区 + ASCII + 常用排版符号 + 一级汉字 + 源码实际用字。
  const symbols = new Set(gb.symbols);
  for (const ch of gb.level1) symbols.add(ch);
  for (let c = 0x20; c < 0x7f; c++) symbols.add(String.fromCharCode(c));
  for (const ch of '—–…‘’“”·•°×÷±≈≤≥≠∞→←↑↓■□●○◆★☆✓✔✕✖€£¥©®™′″') symbols.add(ch);
  // Union in whatever the source actually uses so no UI string can fall through.
  const fromSource = sourceChars(join(FRONTEND, 'src'));
  for (const ch of fromSource) symbols.add(ch);
  // 生僻层只收常用层没有的二级汉字，避免两份子集重复携带同一字形。
  const ext = new Set([...gb.level2].filter((ch) => !symbols.has(ch)));
  return {
    base: symbols,
    ext,
    sourceCount: fromSource.size,
  };
}

/** 码点集合 → CSS unicode-range 值（连续码点合并为区间，如 U+4E00-9FA5）。 */
function unicodeRange(chars) {
  const pts = [...chars].map((c) => c.codePointAt(0)).sort((a, b) => a - b);
  const ranges = [];
  let start = pts[0];
  let prev = pts[0];
  for (const p of pts.slice(1)) {
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    ranges.push(start === prev ? `U+${start.toString(16).toUpperCase()}` : `U+${start.toString(16).toUpperCase()}-${prev.toString(16).toUpperCase()}`);
    start = prev = p;
  }
  if (pts.length) {
    ranges.push(start === prev ? `U+${start.toString(16).toUpperCase()}` : `U+${start.toString(16).toUpperCase()}-${prev.toString(16).toUpperCase()}`);
  }
  return ranges.join(', ');
}

const REBUILD_IF_NEWER = [SOURCE, fileURLToPath(import.meta.url)];
const OUTPUTS = [OUT_BASE, OUT_EXT, OUT_CSS];
function upToDate() {
  return OUTPUTS.every((out) => {
    if (!existsSync(out)) return false;
    const outMs = statSync(out).mtimeMs;
    return REBUILD_IF_NEWER.every((p) => !existsSync(p) || statSync(p).mtimeMs < outMs);
  });
}

if (upToDate()) {
  const mb = (f) => (statSync(f).size / 1048576).toFixed(2);
  console.log(`[font] up to date (${mb(OUT_BASE)} MB + ${mb(OUT_EXT)} MB) — skipping`);
  process.exit(0);
}

if (!existsSync(SOURCE)) {
  console.error(
    `[font] source font missing: ${SOURCE}\n` +
      `[font] run \`npm install\` first (@fontpkg/oppo-sans-4-0 is a devDependency).`
  );
  process.exit(1);
}

const { base, ext, sourceCount } = buildCharsets();
const countCjk = (set) => [...set].filter((c) => c.codePointAt(0) >= 0x4e00 && c.codePointAt(0) <= 0x9fff).length;
console.log(
  `[font] base: ${base.size} code points (${countCjk(base)} CJK, ${sourceCount} from src/), ext: ${ext.size} code points (${countCjk(ext)} CJK)`
);

const src = readFileSync(SOURCE);
const subset = await subsetFont(src, [...base].join(''), { targetFormat: 'woff2' });
const subsetExt = await subsetFont(src, [...ext].join(''), { targetFormat: 'woff2' });

// 两层同族同权重轴，靠 unicode-range 让浏览器按页面实际用字决定下载哪份。
// liveline 硬编码的 'SF Mono' 别名（canvas 图表文字）同样双层声明。
const face = (family, file, range) => `@font-face {
  font-family: '${family}';
  src: url('./${file}') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
  unicode-range: ${range};
}`;

const css = `/* Generated by scripts/build-font.mjs — do not edit.
   两层拆分见脚本头注（IMPROVE-54）：常用层随首屏加载，二级汉字层仅按需下载。
   字体授权与署名义务见 public/licenses/（BUG-99 / IMPROVE-46）。 */
${face('OPPOSans', 'opposans-subset.woff2', unicodeRange(base))}
${face('OPPOSans', 'opposans-ext.woff2', unicodeRange(ext))}
${face('SF Mono', 'opposans-subset.woff2', unicodeRange(base))}
${face('SF Mono', 'opposans-ext.woff2', unicodeRange(ext))}
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_BASE, subset);
writeFileSync(OUT_EXT, subsetExt);
writeFileSync(OUT_CSS, css);

const pct = (n) => ((n / src.length) * 100).toFixed(1);
console.log(
  `[font] ${(src.length / 1048576).toFixed(2)} MB -> ${(subset.length / 1048576).toFixed(2)} MB (+${(subsetExt.length / 1048576).toFixed(2)} MB ext) (${pct(subset.length + subsetExt.length)}%)  ${OUT_BASE}`
);
