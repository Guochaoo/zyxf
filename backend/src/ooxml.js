/**
 * OOXML（docx / pptx / pptm）正文抽取的公共部分。
 *
 * 只用 node:zlib 解 zip（OOXML 就是一堆 zip 里的 XML），不引第三方解压库。
 * ⚠️ 抽取文本必须走「标签流单遍扫描」：曾用 `<a:t[^>]*>([\s\S]*?)</a:t>` 这类正则，
 * 遇到属性里含 `<`/`>` 的（`<a:ln><a:solidFill>`）会跨标签吞掉整段 XML —— 同一个
 * 20 MB 的 pptm 抽出 1226 万字（真实值 2093 字），向量与图谱都会因此失真。
 */

import zlib from 'node:zlib';

/** 找到 zip 中央目录结束记录（EOCD）。注释最多 64KB，从尾部往前找。 */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/**
 * 解析 zip 中央目录，返回 name → { method, compSize, localOff }。
 * 只读中央目录，条目内容按需解压（大文件里 99% 的部件是图片，不该碰）。
 */
export function readZipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('不是有效的 zip（未找到中央目录）');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    entries.set(buf.toString('utf8', off + 46, off + 46 + nameLen), {
      method: buf.readUInt16LE(off + 10),
      compSize: buf.readUInt32LE(off + 20),
      localOff: buf.readUInt32LE(off + 42),
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  if (!entries.size) throw new Error('zip 中央目录为空');
  return entries;
}

/** 解压单个条目。本地头长度可能与中央目录不同，必须按本地头重新取偏移。 */
export function readZipEntry(buf, entry) {
  const nameLen = buf.readUInt16LE(entry.localOff + 26);
  const extraLen = buf.readUInt16LE(entry.localOff + 28);
  const start = entry.localOff + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  // 9=deflate64、12=bzip2、14=lzma：Node 的 zlib 不支持，这类条目跳过而不是让整个文件失败
  throw new Error(`不支持的 zip 压缩方式 ${entry.method}`);
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 取 XML 里某个文本标签（Word 的 w:t / PowerPoint 的 a:t）之间的内容。
 * 单遍扫描：标签之间的字符照收，遇到任何标签就截断当前片段——不跨标签、不吞 XML。
 */
export function extractTextTag(xml, tag = 't') {
  const re = new RegExp(`<\\/?([A-Za-z0-9_]+:)?${tag}(?:\\s[^>]*)?\\/?>`, 'g');
  const marks = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    marks.push({ at: m.index, end: m.index + m[0].length, take: m[0][1] !== '/' && !m[0].endsWith('/>') });
  }
  const parts = [];
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i];
    const next = marks[i + 1];
    if (!mark.take || !next) continue;
    // 片段内可能还嵌着别的标签（换行、制表），先剥掉再收字
    const piece = xml.slice(mark.end, next.at).replace(/<[^>]*>/g, '');
    if (piece) parts.push(piece);
  }
  return decodeEntities(parts.join(''));
}

/** docx：正文 + 页眉页脚 */
export function extractDocx(buf) {
  const entries = readZipEntries(buf);
  const parts = [...entries.keys()].filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  if (!parts.length) throw new Error('docx 缺少正文部件');
  const texts = [];
  for (const p of parts) {
    try {
      texts.push(extractTextTag(readZipEntry(buf, entries.get(p)).toString('utf8'), 't'));
    } catch {
      /* 单个部件坏了不影响整体 */
    }
  }
  // 媒体文件数：区分「图片版文档」与「真空白文档」
  const media = [...entries.keys()].filter((n) => /\.(png|jpe?g|gif|emf|wmf|bmp|tiff?)$/i.test(n)).length;
  return { text: texts.join('\n').replace(/[ \t]+/g, ' ').trim(), media };
}

/** pptx / pptm：按页码顺序取幻灯片 + 备注页 */
export function extractPptx(buf) {
  const entries = readZipEntries(buf);
  const num = (name) => Number((name.match(/(\d+)\.xml$/) || [])[1] || 0);
  const slides = [...entries.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => num(a) - num(b));
  const notes = [...entries.keys()]
    .filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))
    .sort((a, b) => num(a) - num(b));
  if (!slides.length) throw new Error('pptx 缺少幻灯片部件');
  const texts = [];
  for (const p of [...slides, ...notes]) {
    try {
      texts.push(extractTextTag(readZipEntry(buf, entries.get(p)).toString('utf8'), 't'));
    } catch {
      /* 跳过坏部件 */
    }
  }
  const media = [...entries.keys()].filter((n) => /\.(png|jpe?g|gif|emf|wmf|bmp|tiff?)$/i.test(n)).length;
  return { text: texts.join('\n').replace(/[ \t]+/g, ' ').trim(), media, slides: slides.length };
}
