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
// Run: node scripts/build-font.mjs      (wired to prebuild / predev / pretest)

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..');

const SOURCE = join(FRONTEND, 'node_modules/@fontpkg/oppo-sans-4-0/OPPO Sans 4.0.ttf');
const OUT_DIR = join(FRONTEND, 'src/assets/fonts');
const OUT = join(OUT_DIR, 'opposans-subset.woff2');

/** GB2312 symbols + level-1 + level-2 hanzi, decoded through Node's full-ICU. */
function gb2312Chars() {
  const out = new Set();
  for (let hi = 0xa1; hi < 0xf8; hi++) {
    for (let lo = 0xa1; lo < 0xff; lo++) {
      try {
        out.add(new TextDecoder('gb2312', { fatal: true }).decode(Uint8Array.from([hi, lo])));
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

function buildCharset() {
  const chars = gb2312Chars();
  for (let c = 0x20; c < 0x7f; c++) chars.add(String.fromCharCode(c));
  for (const ch of '—–…‘’“”·•°×÷±≈≤≥≠∞→←↑↓■□●○◆★☆✓✔✕✖€£¥©®™′″') chars.add(ch);
  // Union in whatever the source actually uses so no UI string can fall through.
  const fromSource = sourceChars(join(FRONTEND, 'src'));
  for (const ch of fromSource) chars.add(ch);
  return { text: [...chars].join(''), sourceCount: fromSource.size };
}

const REBUILD_IF_NEWER = [SOURCE, fileURLToPath(import.meta.url)];
function upToDate() {
  if (!existsSync(OUT)) return false;
  const outMs = statSync(OUT).mtimeMs;
  return REBUILD_IF_NEWER.every((p) => !existsSync(p) || statSync(p).mtimeMs < outMs);
}

if (upToDate()) {
  const mb = (statSync(OUT).size / 1048576).toFixed(2);
  console.log(`[font] up to date (${mb} MB) — skipping`);
  process.exit(0);
}

if (!existsSync(SOURCE)) {
  console.error(
    `[font] source font missing: ${SOURCE}\n` +
      `[font] run \`npm install\` first (@fontpkg/oppo-sans-4-0 is a devDependency).`
  );
  process.exit(1);
}

const { text, sourceCount } = buildCharset();
const cjk = [...text].filter((c) => c.codePointAt(0) >= 0x4e00 && c.codePointAt(0) <= 0x9fff).length;
console.log(`[font] charset: ${[...text].length} code points (${cjk} CJK, ${sourceCount} from src/)`);

const src = readFileSync(SOURCE);
const subset = await subsetFont(src, text, { targetFormat: 'woff2' });

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, subset);

const pct = ((subset.length / src.length) * 100).toFixed(1);
console.log(
  `[font] ${(src.length / 1048576).toFixed(2)} MB -> ${(subset.length / 1048576).toFixed(2)} MB (${pct}%)  ${OUT}`
);
