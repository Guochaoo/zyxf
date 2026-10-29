/* GPL 原文的排版解析：LICENSE 是按 ~72 字符硬换行排的，直接 pre-wrap 只会在
 * 960px 正文里留下一条窄窄的文字带。这里按空行拆段、把段内硬换行拼回整段，
 * 再把原站的「Preamble / TERMS AND CONDITIONS / 0. Definitions.」这类独立行
 * 标成 h2，正文才能像协议页一样铺满 960px。
 *
 * 只做空白归一化，不改任何字词；测试会校验拼回去的文本与 LICENSE 完全一致。 */

const HEADINGS = new Set([
  'Preamble',
  'TERMS AND CONDITIONS',
  'END OF TERMS AND CONDITIONS',
  'How to Apply These Terms to Your New Programs',
]);

export function parseGpl(raw) {
  const blocks = raw
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const out = [];
  blocks.forEach((text, index) => {
    // 首段是「GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007」，拆成标题 + 版本行
    if (index === 0) {
      const m = text.match(/^(.*?)\s+(Version\s+.*)$/);
      if (m) {
        out.push({ type: 'h2', text: m[1] });
        out.push({ type: 'p', text: m[2] });
        return;
      }
    }
    // 章节标题：0. Definitions. / 1. Source Code. … / 17. Interpretation of Sections 15 and 16.
    if (HEADINGS.has(text) || (/^\d+\.\s/.test(text) && text.length < 90)) {
      out.push({ type: 'h2', text });
    } else {
      out.push({ type: 'p', text });
    }
  });
  return out;
}
