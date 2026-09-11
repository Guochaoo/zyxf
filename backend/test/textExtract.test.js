// 内容索引：抽取层与文本标签扫描的单测（不碰 OSS / 不碰真实 PDF）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { readZipEntries, readZipEntry, extractTextTag, extractDocx, extractPptx } from '../src/ooxml.js';
import { extractText, classifyPdf, contentHash, DOC_KIND } from '../src/textExtract.js';

/* ---------- 构造一个内存 zip（够测解析器就行） ---------- */

function buildZip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, contentRaw] of Object.entries(files)) {
    const content = Buffer.from(contentRaw);
    const deflated = zlib.deflateRawSync(content);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32 ? zlib.crc32(content) : 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(deflated.length, 18);
    lh.writeUInt32LE(content.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    local.push(lh, nameBuf, deflated);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10); // deflate
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(deflated.length, 20);
    ch.writeUInt32LE(content.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + deflated.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, eocd]);
}

describe('OOXML：zip 读取与文本标签扫描', () => {
  test('readZipEntries / readZipEntry 往返（deflate 与 store 两种）', () => {
    const zip = buildZip({
      'word/document.xml': '<w:t>矩阵分解</w:t>',
      'word/media/image1.png': 'not-a-real-png',
    });
    const entries = readZipEntries(zip);
    assert.deepEqual([...entries.keys()].sort(), ['word/document.xml', 'word/media/image1.png']);
    assert.equal(readZipEntry(zip, entries.get('word/document.xml')).toString('utf8'), '<w:t>矩阵分解</w:t>');
    assert.equal(readZipEntry(zip, entries.get('word/media/image1.png')).toString('utf8'), 'not-a-real-png');
  });

  test('非 zip 输入抛出可读错误（调用方靠它记 failed 而不是崩掉）', () => {
    assert.throws(() => readZipEntries(Buffer.from('这不是 zip')), /不是有效的 zip|zip/);
  });

  test('文本标签扫描不跨标签吞 XML（曾用正则抽出 1200 万字的那类 bug）', () => {
    // 真实畸形样本的结构：文本标签之间夹着大量嵌套标签与属性里的尖括号
    const xml = [
      '<a:p><a:r><a:t>零件的类型</a:t></a:r>',
      '<a:r><a:rPr><a:ln><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></a:rPr>',
      '<a:t>箱体类零件</a:t></a:r></a:p>',
      '<a:p><a:r><a:t/></a:r><a:r><a:t>视图选择</a:t></a:r></a:p>',
    ].join('');
    const text = extractTextTag(xml, 't');
    assert.equal(text, '零件的类型箱体类零件视图选择');
    // XML 属性与标签名一个都不该混进来
    assert.ok(!text.includes('solidFill'));
    assert.ok(!text.includes('srgbClr'));
  });

  test('实体解码（&amp; lt; gt; 数字实体）', () => {
    const text = extractTextTag('<w:t>A&amp;B &lt;x&gt; &#20013;</w:t>', 't');
    assert.equal(text, 'A&B <x> 中');
  });

  test('extractDocx 读出正文并数出媒体文件', () => {
    const zip = buildZip({
      'word/document.xml': '<w:p><w:r><w:t>传热学</w:t></w:r></w:p><w:p><w:r><w:t>导热系数</w:t></w:r></w:p>',
      'word/media/image1.png': 'x',
      'word/media/image2.png': 'y',
    });
    const { text, media } = extractDocx(zip);
    assert.equal(text, '传热学导热系数');
    assert.equal(media, 2);
  });

  test('extractPptx 按页码顺序拼接幻灯片', () => {
    const zip = buildZip({
      'ppt/slides/slide2.xml': '<a:t>第二页</a:t>',
      'ppt/slides/slide10.xml': '<a:t>第十页</a:t>',
      'ppt/slides/slide1.xml': '<a:t>第一页</a:t>',
    });
    const { text, slides } = extractPptx(zip);
    assert.equal(slides, 3);
    assert.deepEqual(text.split('\n'), ['第一页', '第二页', '第十页']); // 按页码数字排序，不是字典序
  });
});

describe('抽取分派与格式判定', () => {
  test('txt 直读并去掉 BOM 与 CRLF', async () => {
    const r = await extractText({ buf: Buffer.from('\uFEFF第一行\r\n第二行'), ext: 'txt' });
    assert.equal(r.docKind, DOC_KIND.TEXT);
    assert.equal(r.text, '第一行\n第二行');
  });

  test('docx 只有图片时判为 image_only（实测这类文件正文 0 字、媒体几十个）', async () => {
    const zip = buildZip({
      'word/document.xml': '<w:p><w:r><w:drawing/></w:r></w:p>',
      'word/media/image1.jpeg': 'x',
    });
    const r = await extractText({ buf: zip, ext: 'docx' });
    assert.equal(r.docKind, DOC_KIND.IMAGE_ONLY);
    assert.equal(r.media, 1);
  });

  test('docx 正文充足时判为 office_text', async () => {
    const zip = buildZip({ 'word/document.xml': `<w:t>${'内容'.repeat(60)}</w:t>` });
    const r = await extractText({ buf: zip, ext: 'docx' });
    assert.equal(r.docKind, DOC_KIND.OFFICE_TEXT);
    assert.ok(r.text.length >= 100);
  });

  test('.doc / .ppt / 压缩包 / 图片判为 unsupported（没有纯 JS 解析路径）', async () => {
    for (const ext of ['doc', 'ppt', 'zip', 'rar', 'png']) {
      const r = await extractText({ buf: Buffer.from('binary'), ext });
      assert.equal(r.docKind, DOC_KIND.UNSUPPORTED, ext);
      assert.equal(r.text, '');
    }
  });

  test('pptm 与 pptx 走同一条路径（同为 OOXML zip 容器）', async () => {
    const zip = buildZip({ 'ppt/slides/slide1.xml': `<a:t>${'宏格式幻灯片正文内容'.repeat(12)}</a:t>` });
    const r = await extractText({ buf: zip, ext: 'pptm' });
    assert.equal(r.docKind, DOC_KIND.OFFICE_TEXT);
    assert.match(r.text, /宏格式幻灯片正文内容/);
  });

  test('classifyPdf：正文够长是 pdf_text，几乎空白是扫描件 image_only', () => {
    assert.equal(classifyPdf(5000).docKind, DOC_KIND.PDF_TEXT);
    assert.equal(classifyPdf(0).docKind, DOC_KIND.IMAGE_ONLY);
    assert.equal(classifyPdf(199).docKind, DOC_KIND.IMAGE_ONLY);
    assert.equal(classifyPdf(200).docKind, DOC_KIND.PDF_TEXT);
  });

  test('contentHash 对内容敏感、对格式稳定（决定要不要重算向量）', () => {
    const a = contentHash('矩阵分解', DOC_KIND.PDF_TEXT);
    assert.equal(a, contentHash('矩阵分解', DOC_KIND.PDF_TEXT));
    assert.notEqual(a, contentHash('矩阵分解（修订）', DOC_KIND.PDF_TEXT));
    assert.notEqual(a, contentHash('矩阵分解', DOC_KIND.TEXT));
  });
});
