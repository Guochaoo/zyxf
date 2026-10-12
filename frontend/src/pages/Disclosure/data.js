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

// 课程指南共建计划的投稿邮箱。它是**数据**而不是文案：i18n 字典里的「中文不含
// 未翻译英文」校验会把这种纯 ASCII 串判成漏翻译（见 test/i18n.test.js），而且它
// 与日期 / 金额同类——改版式时不该顺手改掉；只有换投稿地址才动这一行。
export const COURSE_GUIDE_EMAIL = 'hxhanxuan@stu.xjtu.edu.cn';

/** 经费：金额一律以**分**为单位存整数，求和不会有浮点误差。
 *  预算目前**还没有** → 用 `null` 表示（小结里显示「-」、不画支出率细条），别填 0：
 *  0 会被读成「预算为零」，`null` 才是「还没定」。定了预算就把分写成整数。 */
export const BUDGET_CENTS = null;
/** 本网站经费：取自阿里云控制台导出的**月度账单概览** CSV（账期 2026-03 至 2026-09）里的
 *  「应付金额」，以分为单位存整数（求和不会有浮点误差，页面上的合计由逐行相加得出）。
 *  只收「应付 > 0」的账目：账单 21 行里有 11 行是 ¥0.00（免费额度 / 全额券抵扣 / 该月无
 *  用量），列出来只是噪声——口径与来源写在页脚（「标年份与来源」是本页自己的要求）。
 *  账号 ID / 账号名那几列属于隐私，不进仓库。
 *  账期只有「月」没有「日」：这里存 'YYYY-MM'，由组件用 Intl 渲染成「2026年9月」。
 *  与 i18n 的 disclosure.expenses.items **按下标对齐**，增删条目时两边一起改。 */
export const EXPENSE_BASE = [
  { id: 'b1', month: '2026-04', cents: 4 }, // 对象存储 OSS
  { id: 'b2', month: '2026-05', cents: 2600 }, // .top 域名
  { id: 'b3', month: '2026-07', cents: 2235 }, // 轻量应用服务器
  { id: 'b4', month: '2026-07', cents: 800 }, // .ASIA 域名
  { id: 'b5', month: '2026-07', cents: 19 }, // 智能媒体管理
  { id: 'b6', month: '2026-07', cents: 1 }, // 对象存储 OSS
  { id: 'b7', month: '2026-08', cents: 139 }, // 智能媒体管理
  { id: 'b8', month: '2026-08', cents: 54 }, // 对象存储 OSS
  { id: 'b9', month: '2026-09', cents: 629 }, // 智能媒体管理
  { id: 'b10', month: '2026-09', cents: 615 }, // 对象存储 OSS
];

export const spentCents = (rows = EXPENSE_BASE) => rows.reduce((sum, r) => sum + r.cents, 0);
