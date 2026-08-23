import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { matchScore, SCORES } from '../src/searchMatch.js';

describe('matchScore', () => {
  test('prefix outranks substring', () => {
    assert.equal(matchScore('高数', '高数讲义.pdf'), SCORES.PREFIX);
    assert.equal(matchScore('高数', '复习高数.pdf'), SCORES.SUBSTRING);
    assert.equal(matchScore('数学', '高等数学.pdf'), SCORES.SUBSTRING);
  });

  test('hanzi abbreviation matches out-of-order-free subsequence', () => {
    // 高数 → 高等数学：查询字符按顺序出现即可，不要求连续
    assert.equal(matchScore('高数', '高等数学.pdf'), SCORES.SUBSEQUENCE);
    assert.equal(matchScore('高数', '高等数学第1章.pptx'), SCORES.SUBSEQUENCE);
    // 顺序颠倒不算匹配
    assert.equal(matchScore('数高', '高等数学.pdf'), null);
    // 至少两个汉字才启用子序列，单字只走子串
    assert.equal(matchScore('微', '高等数学.pdf'), null);
    assert.equal(matchScore('数', '高等数学.pdf'), SCORES.SUBSTRING);
  });

  test('subsequence tolerates spaces in the query', () => {
    assert.equal(matchScore('高 数', '高等数学.pdf'), SCORES.SUBSEQUENCE);
  });

  test('pinyin full, initials and mixed queries match hanzi names', () => {
    assert.equal(matchScore('gaoshu', '高等数学.pdf'), SCORES.PINYIN);
    assert.equal(matchScore('gao shu', '高等数学.pdf'), SCORES.PINYIN);
    assert.equal(matchScore('gdsx', '高等数学.pdf'), SCORES.PINYIN);
    assert.equal(matchScore('gaodengshuxue', '高等数学.pdf'), SCORES.PINYIN);
    assert.equal(matchScore('gaoshu', '线性代数.pdf'), null);
    assert.equal(matchScore('wuli', '高等数学.pdf'), null);
  });

  test('substring wins over pinyin for latin queries', () => {
    assert.equal(matchScore('ate', 'LaTex.pdf'), SCORES.SUBSTRING);
    assert.equal(matchScore('abc', 'xx ABC.pdf'), SCORES.SUBSTRING);
  });

  test('empty query never matches', () => {
    assert.equal(matchScore('', '任意'), null);
    assert.equal(matchScore('  ', '任意'), null);
  });

  test('scattered matches across long names are rejected as noise', () => {
    // 真实案例：gdsx 在长名称里串搭分散的 过/导/思/修 首字母
    assert.equal(matchScore('gdsx', '2021考研政治基础过关班辅导讲义-思修（张怀兵）.pdf'), null);
    // 汉字子序列同理：首尾散搭不算缩写
    assert.equal(matchScore('高卷', '高等数学复习全书与测试卷'), null);
    // 对照：紧凑的跨位匹配仍然命中
    assert.equal(matchScore('高数', '高等数学复习全书与测试卷'), SCORES.SUBSEQUENCE);
  });
});
