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

  // 宽屏不再是一条居中窄列：按内容把 12 栅格分成 7 / 5 / 12，且 items-start 让每张卡
  // 按自身内容取高（不被同行最高的那张拉伸）。这两条一起构成「大小不一的错落」，
  // 改回去不易被察觉，所以钉住。
  test('宽屏按内容分列（7 / 5 / 12）且卡片不被拉伸', () => {
    const { container } = renderPage();
    const row = container.querySelector('#lectures').parentElement;
    expect(row.className).toContain('lg:grid-cols-12');
    expect(row.className).toContain('items-start');

    const spans = { lectures: 'lg:col-span-7', plans: 'lg:col-span-5', expenses: 'lg:col-span-12' };
    for (const [id, span] of Object.entries(spans)) {
      expect(container.querySelector(`#${id}`).className).toContain(span);
    }
  });

  // 经费是唯一吃宽度的一节：宽屏下小结与表格并排（小结窄轨 + 表格占满其余），
  // 不分栏的话「事由」列会被拉到一大片空白。
  test('经费卡内部在宽屏分为「小结轨 + 表格」两栏', () => {
    const { container } = renderPage();
    const card = container.querySelector('#expenses');
    const summary = card.querySelector('dl').parentElement;
    const tableWrap = card.querySelector('table').parentElement;

    expect(summary.className).toContain('bg-inset');
    expect(tableWrap.className).toContain('lg:flex-1');
    expect(summary.parentElement.className).toContain('lg:flex');
  });

  test('页头是「logo + 页面名」（与统计面板同一个 PageTitle），正文不再有说明条', () => {
    renderPage();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('公示栏');
    expect(h1.querySelector('img')).toBeTruthy();
    // 说明句与「更新于 / 学期 / 责任单位」那一行已按需求删除
    expect(screen.queryByText(/按学期更新/)).toBeNull();
    expect(screen.queryByText('更新于')).toBeNull();
    expect(screen.queryByText('责任单位')).toBeNull();
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
