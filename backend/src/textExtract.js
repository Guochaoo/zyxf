/**
 * 抽取层：OSS 对象 → 纯文本。
 *
 * 设计取舍（都由真实库测量决定，见 docs/ISSUES.md 的条目）：
 *   - 只做「文本层」抽取，不接 OCR。实测 40 个 PDF 等距抽样里 80% 有文本层、20% 是扫描件，
 *     扫描件与老二进制 .doc/.ppt 统一标成 image_only / unsupported —— 它们仍参与名称层语义，
 *     只是不进内容视图。doc_kind 里预留了 pdf_ocr，下一轮接 Tesseract 时不用改表。
 *   - 只依赖 node:zlib（zip）与 pdfjs-dist（PDF），不引其他解析库。
 */

import { extractDocx, extractPptx } from './ooxml.js';

// 单文件正文上限：超大教材（实测最大 402 页 / 31 万字）留足余量，同时防止异常文件撑爆 DB
export const MAX_CONTENT_CHARS = 400_000;
// 判定「这一页几乎没有文字」的密度阈值：页面积 / 3000 个字以内视为图片页
const PAGE_AREA_PER_CHAR = 3000;

export const DOC_KIND = {
  TEXT: 'text', // 纯文本
  PDF_TEXT: 'pdf_text', // PDF 文本层
  OFFICE_TEXT: 'office_text', // docx / pptx / pptm 的 XML 文本
  IMAGE_ONLY: 'image_only', // 能打开但没有文本，内容全是图片（需要 OCR）
  UNSUPPORTED: 'unsupported', // 格式无纯 JS 解析路径（.doc / .ppt / 压缩包 / 图片）
  TOO_LARGE: 'too_large', // 超过 INDEX_MAX_FILE_MB：主动不解析，保护内存（见 indexPipeline）
  PDF_OCR: 'pdf_ocr', // 预留：OCR 产出（下一轮接本地 Tesseract）
};

/**
 * 按扩展名抽取正文。
 * @returns {Promise<{ text, docKind, pages?, media?, thinPages? }>}
 * @throws 解析失败时抛出（调用方记为 failed，不重试）
 */
export async function extractText({ buf, ext }) {
  const e = String(ext || '').toLowerCase();
  if (e === 'txt') {
    const text = buf.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
    return { text, docKind: DOC_KIND.TEXT };
  }
  if (e === 'pdf') return extractPdf(buf);
  if (e === 'docx') {
    const { text, media } = extractDocx(buf);
    return { text, media, docKind: text.length >= 100 ? DOC_KIND.OFFICE_TEXT : DOC_KIND.IMAGE_ONLY };
  }
  if (e === 'pptx' || e === 'pptm') {
    const { text, media, slides } = extractPptx(buf);
    return { text, media, pages: slides, docKind: text.length >= 100 ? DOC_KIND.OFFICE_TEXT : DOC_KIND.IMAGE_ONLY };
  }
  // .doc / .ppt 是老二进制复合文档，没有纯 JS 解析器；图片与压缩包本来就没有可嵌文本。
  return { text: '', docKind: DOC_KIND.UNSUPPORTED };
}

/** PDF：逐页取文本层，并统计「空页」以识别扫描件。 */
async function extractPdf(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false, // 不执行 PDF 内嵌脚本
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0, // 静音字体缺失（"undefined function"）之类警告
  });
  let doc;
  try {
    doc = await task.promise;
    const pages = [];
    let thinPages = 0;
    let chars = 0;
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const text = content.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      const viewport = page.getViewport({ scale: 1 });
      if (text.length < (viewport.width * viewport.height) / PAGE_AREA_PER_CHAR) thinPages += 1;
      pages.push(text);
      chars += text.length;
      page.cleanup();
      if (chars > MAX_CONTENT_CHARS) break;
    }
    const numPages = doc.numPages;
    const body = pages.join('\n').trim();
    return { text: body, pages: numPages, thinPages, ...classifyPdf(body.length) };
  } finally {
    await task.destroy().catch(() => {});
  }
}

/**
 * PDF 归类：正文太短就判为扫描件（进不了内容视图，只留在名称层）。
 * 抽成纯函数是为了能直接单测这个判据：它决定一个文件有没有内容语义，而用真实 PDF 测太脆
 * （构造一个扫描件样本要几十 MB 图片），实测的分布是 526 个 PDF 里约 20% 落在这一档。
 */
export function classifyPdf(chars) {
  return { docKind: chars >= 200 ? DOC_KIND.PDF_TEXT : DOC_KIND.IMAGE_ONLY };
}

/** 内容指纹：用于判断文件是否被换成同 key 的新上传（决定要不要重算向量）。 */
export function contentHash(text, docKind) {
  let h = 2166136261;
  const s = `${docKind}\u0000${text}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
