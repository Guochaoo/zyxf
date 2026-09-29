import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import ActivityHeatmap from '../pages/Dashboard/ActivityHeatmap.jsx';
import i18n from '../i18n/index.js';

// BUG-93 回归：网格由 buildWeeks 按**周一开头**构建，而 dashboard.weekdays 字典是
// **周日开头**，标签必须按 (i + 1) % 7 取，否则每一行都比真实星期早一天。
// 2026-01-05 是周一，用整周（7 天）数据让首列正好落在周一。
const MONDAY = new Date(2026, 0, 5).getTime();
const DAY = 86400000;
const rows = Array.from({ length: 7 }, (_, i) => ({
  ts: MONDAY + i * DAY,
  downloads: i,
  uploads: 0,
}));

// 星期标签列 = 网格左侧那列（mr-1 flex flex-col）；隔行显示时奇数列是空串。
const weekdayLabels = (container) =>
  [...container.querySelectorAll('div.mr-1.flex.flex-col > span')].map((el) => el.textContent);

describe('ActivityHeatmap 星期标签与网格对齐（BUG-93）', () => {
  test('zh：第一行（周一）是「一」，最后一行（周日）是「日」', () => {
    const { container } = render(<ActivityHeatmap rows={rows} />);
    const labels = weekdayLabels(container);

    expect(labels).toHaveLength(7);
    expect(labels[0]).toBe('一'); // 修复前是「日」——整体早一天
    expect(labels[2]).toBe('三');
    expect(labels[4]).toBe('五');
    expect(labels[6]).toBe('日');
    // 隔行显示策略（i % 2 === 0）保持不变
    expect(labels[1]).toBe('');
    expect(labels[3]).toBe('');
    expect(labels[5]).toBe('');
  });

  test('en：英文标签同样对齐（首行 M、末行 S）', async () => {
    await i18n.changeLanguage('en');
    const { container } = render(<ActivityHeatmap rows={rows} />);
    const labels = weekdayLabels(container);

    expect(labels[0]).toBe('M');
    expect(labels[2]).toBe('W');
    expect(labels[4]).toBe('F');
    expect(labels[6]).toBe('S');
  });
});
