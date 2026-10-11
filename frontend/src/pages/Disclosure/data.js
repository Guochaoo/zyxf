// 公示页的样例数据（纯前端，尚未接入后台）。
//
// 这里只放**结构性字段**——时间、金额（分）、百分比、状态码；所有展示文案
// （讲座题目 / 事由 / 经办人 …）都住在 i18n 字典的 disclosure 段，按数组下标对齐。
// 与 about 页的 CASE_BASE + about.caseStudies 是同一套做法：
// 源码里不得硬编码中文（test/i18n.test.js 强制），而日期 / 金额属于数据不属文案。
//
// 「今天」相关的日期一律**相对今天**生成（不是写死的 ISO 串）：样例页放一个月后
// 仍然有「已结束 / 报名中」两种状态可看，不会退化成一张全过期的表。

// 相对今天偏移 N 天的本地 wall-clock 时间（用 setDate 而非加减毫秒：跨夏令时时
// 后者会把 19:00 挪成 18:00 或 20:00）。
function at(offsetDays, hour, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
}

/** 讲座：时间 + 时长；title / place / speaker 在字典里按下标对齐。 */
export const LECTURE_MINUTES = 90;
export const LECTURE_BASE = [
  { id: 'l1', start: at(-18, 19), minutes: LECTURE_MINUTES },
  { id: 'l2', start: at(-4, 19), minutes: LECTURE_MINUTES },
  { id: 'l3', start: at(3, 19), minutes: LECTURE_MINUTES },
  { id: 'l4', start: at(10, 14, 30), minutes: LECTURE_MINUTES },
  { id: 'l5', start: at(17, 19), minutes: LECTURE_MINUTES },
  { id: 'l6', start: at(24, 19), minutes: LECTURE_MINUTES },
];

/** 编写计划：进度 + 状态码（published / review / writing / planned）。 */
export const PLAN_BASE = [
  { id: 'p1', pct: 100, status: 'published' },
  { id: 'p2', pct: 88, status: 'review' },
  { id: 'p3', pct: 72, status: 'writing' },
  { id: 'p4', pct: 45, status: 'writing' },
  { id: 'p5', pct: 12, status: 'planned' },
];

/** 经费：金额一律以**分**为单位存整数，求和不会有浮点误差。 */
export const BUDGET_CENTS = 2000000; // ¥20,000.00
export const EXPENSE_BASE = [
  { id: 'e1', date: at(-52, 10), cents: 528000 },
  { id: 'e2', date: at(-45, 10), cents: 145000 },
  { id: 'e3', date: at(-38, 10), cents: 86000 },
  { id: 'e4', date: at(-30, 10), cents: 112000 },
  { id: 'e5', date: at(-22, 10), cents: 60000 },
  { id: 'e6', date: at(-15, 10), cents: 140000 },
  { id: 'e7', date: at(-9, 10), cents: 48000 },
  { id: 'e8', date: at(-3, 10), cents: 24000 },
];

export const spentCents = (rows = EXPENSE_BASE) => rows.reduce((sum, r) => sum + r.cents, 0);
