import { match as matchPinyin } from 'pinyin-pro';

// 分层打分：分数越高排名越靠前。
// 前缀 > 子串（原 LIKE 行为）> 汉字缩写（高数 → 高等数学）> 拼音全拼/首字母（gaoshu / gdsx）。
export const SCORES = {
  PREFIX: 100,
  SUBSTRING: 80,
  SUBSEQUENCE: 60,
  PINYIN: 45,
};

// 拼音层的查询长度上限：pinyin-pro 的 match() 是 DP 匹配，开销随 query 长度线性增长
// （实测 2000 字 ≈ 0.5 s、8000 字 ≈ 2.3 s 跑完整库）。而任何真实文件名的拼音串都不会
// 超过这个长度，超长查询必然不命中，直接跳过即可——否则一条匿名 GET 就能占满事件循环。
export const MAX_PINYIN_QUERY_LEN = 32;

const HANZI = /[\u4e00-\u9fff]/g;

const countHanzi = (s) => (s.match(HANZI) || []).length;

// needle 的每个字符按顺序出现在 haystack 中（不要求连续），返回命中的下标数组。
function subsequenceIndices(needle, haystack) {
  if (!needle) return null;
  const hits = [];
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j += 1) {
    if (haystack[j] === needle[i]) {
      hits.push(j);
      i += 1;
    }
  }
  return i === needle.length ? hits : null;
}

// 模糊匹配的密度过滤：命中跨度不超过命中数的两倍。
// 「高数」→ 高等数学（跨度 3、命中 2）是真缩写；
// 长名称里分散出现的「过…导…思…修」式串搭（跨度大、密度低）是噪音。
function isCompact(positions) {
  const span = positions[positions.length - 1] - positions[0] + 1;
  return span <= positions.length * 2;
}

/**
 * 计算查询与名称的匹配分数，不匹配返回 null。
 * query 需为小写；名称内部自行转小写，保证 ASCII 大小写不敏感（对齐 SQLite LIKE 行为）。
 */
export function matchScore(query, name) {
  const q = query.toLowerCase();
  const lower = name.toLowerCase();
  if (!q) return null;

  if (lower.startsWith(q)) return SCORES.PREFIX;
  if (lower.includes(q)) return SCORES.SUBSTRING;

  // 汉字缩写：至少两个汉字才启用子序列，避免单字误报。
  // 空格全部去掉，允许「高 数」这样的输入。
  if (countHanzi(q) >= 2) {
    const hits = subsequenceIndices(q.replace(/\s+/g, ''), lower);
    if (hits && isCompact(hits)) return SCORES.SUBSEQUENCE;
  }

  // 拼音层只对含拉丁字母的查询有意义；空格去掉，允许「gao shu」。
  if (q.length <= MAX_PINYIN_QUERY_LEN && /[a-z]/.test(q)) {
    const hits = matchPinyin(name, q.replace(/\s+/g, ''));
    if (hits && isCompact(hits)) return SCORES.PINYIN;
  }

  return null;
}
