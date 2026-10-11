import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DisclosurePage from '../pages/DisclosurePage.jsx';
import { EXPENSE_BASE, LECTURE_BASE, PLAN_BASE, spentCents } from '../pages/Disclosure/data.js';
import i18n from '../i18n/index.js';

// 公示栏（/disclosure）的版式样例。这里守的是三类**内容契约**，不是像素：
// 讲座状态必须由时间推导、进度条数值必须与数据一致、账目合计必须等于逐行之和
// （合计写死过就会在加减条目时静默错账——公示页最不能错的就是这个）。
const renderPage = () =>
  render(
    <MemoryRouter>
      <DisclosurePage />
    </MemoryRouter>
  );

// 从渲染出来的金额文本反解数字：'¥5,280.00' → 5280。
// 必须match「数字.两位小数」，不能简单剔除所有非数字字符——合计行里还有
// 「共 8 笔」的 8，那样会解出 811430。
const parseMoney = (text) => Number((text.match(/([\d,]+\.\d{2})/) || ['0'])[1].replace(/,/g, ''));

describe('公示栏 · 骨架', () => {
  test('三节与其目录项一一对应', () => {
    renderPage();
    for (const [index, title] of [
      ['01', '讲座计划'],
      ['02', '资料编写计划'],
      ['03', '经费支出'],
    ]) {
      // 目录 + 区块头各一处标题
      expect(screen.getAllByText(title).length).toBe(2);
      expect(screen.getAllByText(index).length).toBe(2);
    }
    expect(screen.getByRole('navigation', { name: '公示内容目录' })).toBeInTheDocument();
  });

  test('页头给出更新日期、学期与责任单位（公示的可信度来源）', () => {
    renderPage();
    expect(screen.getByText('更新于')).toBeInTheDocument();
    expect(screen.getByText('2026 秋季学期')).toBeInTheDocument();
    expect(screen.getByText('仲英书院学业辅导中心')).toBeInTheDocument();
    // 日期不写死，按当天渲染（YYYY/MM/DD）
    const today = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    expect(screen.getByText(today)).toBeInTheDocument();
  });
});

describe('公示栏 · 01 讲座计划', () => {
  test('每条讲座都有标题，状态由时间推导（不写死在数据里）', () => {
    renderPage();
    const texts = i18n.t('disclosure.lectures.items', { returnObjects: true });
    expect(texts).toHaveLength(LECTURE_BASE.length);
    for (const item of texts) expect(screen.getByText(item.title)).toBeInTheDocument();

    const done = LECTURE_BASE.filter(
      (it) => new Date(it.start).getTime() + it.minutes * 60000 < Date.now()
    ).length;
    expect(screen.getAllByText('已结束')).toHaveLength(done);
    expect(screen.getAllByText('报名中')).toHaveLength(LECTURE_BASE.length - done);
    expect(done).toBeGreaterThan(0); // 样例里过去 / 未来两种状态都要有
    expect(done).toBeLessThan(LECTURE_BASE.length);
  });

  test('时间按 90 分钟时长给出起止（不是只印开始时间）', () => {
    renderPage();
    const fmt = (d) =>
      new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    const range = (it) => {
      const s = new Date(it.start);
      return `${fmt(s)}–${fmt(new Date(s.getTime() + it.minutes * 60000))}`;
    };
    // 同一时段的多场讲座会渲染出同样的文本，所以按时段计数而不是 getByText
    const counts = LECTURE_BASE.reduce((acc, it) => {
      const key = range(it);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    for (const [label, n] of Object.entries(counts)) {
      expect(screen.getAllByText(label)).toHaveLength(n);
    }
    // 样例里必须存在一个非 19:00 的时段，否则「时长参与渲染」根本没被验证到
    expect(Object.keys(counts).length).toBeGreaterThan(1);
  });
});

describe('公示栏 · 02 资料编写计划', () => {
  test('每项一条进度条，aria-valuenow 与百分比文本同源', () => {
    renderPage();
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(PLAN_BASE.length);
    PLAN_BASE.forEach((plan, i) => {
      expect(bars[i]).toHaveAttribute('aria-valuenow', String(plan.pct));
      expect(screen.getByText(`${plan.pct}%`)).toBeInTheDocument();
    });
  });

  test('状态码 → 文案映射正确（同码多条时条数也要对）', () => {
    renderPage();
    const labelOf = { published: '已发布', review: '校对中', writing: '编写中', planned: '待启动' };
    for (const [code, label] of Object.entries(labelOf)) {
      expect(screen.getAllByText(label)).toHaveLength(
        PLAN_BASE.filter((p) => p.status === code).length
      );
    }
    // 每种码在样例里都至少出现一次，映射表没有被写成死值
    expect(new Set(PLAN_BASE.map((p) => p.status)).size).toBe(4);
  });

  // 回归：i18next 的 returnObjects 会把空串叶子换成 defaultValue（[]），
  // 只写 `{text.eta ? …}` 的话「预计」后面会跟一个空值（实测踩过）。
  test('已发布项不渲染空的「预计」段', () => {
    const { container } = renderPage();
    const metaOf = (li) => li.querySelector('div > div').lastElementChild;
    const rows = [...container.querySelectorAll('#plans li')];

    expect(metaOf(rows[0]).textContent).toBe('负责人 陈同学');
    expect(metaOf(rows[0]).querySelectorAll('span')).toHaveLength(1);
    expect(metaOf(rows[1]).textContent).toContain('预计 10 月下旬');
  });
});

describe('公示栏 · 03 经费支出', () => {
  test('合计行等于逐行金额之和（改数据不会错账）', () => {
    const { container } = renderPage();
    const rows = [...container.querySelectorAll('#expenses tbody tr')];
    const bodyRows = rows.slice(0, -1); // 末行是合计
    const totalRow = rows[rows.length - 1];

    const sum = bodyRows.reduce(
      (acc, tr) => acc + parseMoney(tr.lastElementChild.textContent),
      0
    );
    expect(sum).toBeCloseTo(spentCents(EXPENSE_BASE) / 100, 2);
    expect(parseMoney(totalRow.textContent)).toBeCloseTo(sum, 2);
  });

  test('概览三个数自洽：预算 − 已支出 = 结余，且已支出等于合计', () => {
    renderPage();
    const amount = (label) =>
      parseMoney(screen.getByText(label).nextElementSibling.textContent);
    const budget = amount('预算总额');
    const spent = amount('已支出');
    const remaining = amount('结余');
    expect(spent).toBeCloseTo(spentCents(EXPENSE_BASE) / 100, 2);
    expect(budget - spent).toBeCloseTo(remaining, 2);
  });
});

describe('公示栏 · 双语', () => {
  test('切到英文后页面上不残留中文文案', async () => {
    await i18n.changeLanguage('en');
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Disclosure');
    expect(document.body.textContent).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
