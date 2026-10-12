import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DisclosurePage from '../pages/DisclosurePage.jsx';
import {
  COURSE_GUIDE_EMAIL,
  EXPENSE_BASE,
  LECTURE_BASE,
  spentCents,
} from '../pages/Disclosure/data.js';
import i18n from '../i18n/index.js';

// 公示栏（/disclosure）的版式样例。这里守的是三类**内容契约**，不是像素：
// 讲座状态必须由时间推导、进度条数值必须与数据一致、账目合计必须等于逐行之和
// （合计写死过就会在加减条目时静默错账——公示页最不能错的就是这个）。
// 共建计划一节守的是「投稿邮箱可点、两条线清单逐条在页面上」。
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
  // 目录项与区块头一对一：序号 + 标题两处都要对上（anchors 也一起核对）。
  // ⚠️ 别按「标题出现 2 次」计数——「书院课程指南共建计划」在 02 资料编写计划里
  // 也是一项（那是计划条目，不是区块头），数出来是 3 个。
  test('四节与其目录项一一对应', () => {
    const { container } = renderPage();
    const nav = screen.getByRole('navigation', { name: '公示内容目录' });
    for (const [index, id, title] of [
      ['01', 'lectures', '讲座计划'],
      ['02', 'plans', '资料编写计划'],
      ['03', 'courseGuide', '书院课程指南共建计划'],
      ['04', 'expenses', '经费支出'],
    ]) {
      const link = nav.querySelector(`a[href="#${id}"]`);
      expect(link, `目录缺 ${id}`).toBeTruthy();
      expect(link.textContent).toContain(title);
      expect(link.textContent).toContain(index);

      const head = container.querySelector(`#${id} h2`);
      expect(head.textContent).toContain(title);
      expect(head.textContent).toContain(index);
    }
  });

  // 宽屏按内容分列（5 / 7 / 12 / 12），且 items-start 让每张卡按自身内容取高
  // （不被同行最高的那张拉伸）。改回去不易被察觉，所以钉住。
  test('宽屏按内容分列（5 / 7 / 12 / 12）且卡片不被拉伸', () => {
    const { container } = renderPage();
    const row = container.querySelector('#lectures').parentElement;
    expect(row.className).toContain('lg:grid-cols-12');
    expect(row.className).toContain('items-start');

    const spans = {
      lectures: 'lg:col-span-5',
      plans: 'lg:col-span-7',
      courseGuide: 'lg:col-span-12',
      expenses: 'lg:col-span-12',
    };
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
  test('12 项计划全渲染，且每项四列都有内容（资料名 / 时间 / 人数 / 工资）', () => {
    const { container } = renderPage();
    const items = i18n.t('disclosure.plans.items', { returnObjects: true });
    expect(items).toHaveLength(12);

    const rows = [...container.querySelectorAll('#plans li')];
    expect(rows).toHaveLength(items.length);
    items.forEach((it, i) => {
      const text = rows[i].textContent;
      expect(text).toContain(it.title);
      expect(text).toContain(it.time);
      expect(text).toContain(it.people);
      expect(text).toContain(it.pay);
    });
  });

  test('表头四列来自字典，与文档要求的四项一致', () => {
    renderPage();
    for (const label of ['资料名称', '预计完成时间', '志愿者人数', '工资']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  test('计划没有百分比：不渲染进度条（别为好看编一个进度）', () => {
    const { container } = renderPage();
    expect(container.querySelector('#plans [role="progressbar"]')).toBeNull();
  });

  test('未定项如实标注「暂定」，不编数字', () => {
    const { container } = renderPage();
    const row = [...container.querySelectorAll('#plans li')].find((li) =>
      li.textContent.includes('工图小助手')
    );
    expect(row.textContent).toContain('12 月末之前');
    expect(row.textContent).toContain('暂定');
    // 「习题集整理」的工资是「按标准计算」，也不该被填成一个具体数字
    expect(screen.getByText('按标准计算')).toBeInTheDocument();
  });
});

describe('公示栏 · 03 书院课程指南共建计划', () => {
  test('课程 / 竞赛两条线各有一份清单，条目与字典逐条对齐（不是概括性的一句话）', () => {
    const { container } = renderPage();
    const card = container.querySelector('#courseGuide');
    for (const key of ['guide', 'contest']) {
      const block = i18n.t(`disclosure.courseGuide.${key}`, { returnObjects: true });
      expect(block.items.length).toBeGreaterThanOrEqual(5);
      expect(card.textContent).toContain(block.title);
      expect(card.textContent).toContain(block.intro);
      for (const it of block.items) expect(card.textContent).toContain(it);
    }
  });

  test('投稿邮箱是 mailto 链接（地址来自 data.js，不写进字典）', () => {
    const { container } = renderPage();
    const link = container.querySelector('#courseGuide a[href^="mailto:"]');
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe(`mailto:${COURSE_GUIDE_EMAIL}`);
    expect(link.textContent).toBe(COURSE_GUIDE_EMAIL);
  });

  test('写明「邮件请注明」的信息与两种奖励口径', () => {
    const { container } = renderPage();
    const card = container.querySelector('#courseGuide');
    for (const label of ['班级', '姓名', '学号', '支付宝账号（选择工资）', '志愿汇编号（选择工时）']) {
      expect(card.textContent).toContain(label);
    }
    // 经审核通过后才联系作者并发放奖励，不是「投了就有」
    expect(card.textContent).toContain('经审核通过后');
    expect(card.textContent).toContain('发放相应奖励');
  });

  test('提醒标注年份与来源（考核方式 / 竞赛时间会变）', () => {
    const { container } = renderPage();
    const note = i18n.t('disclosure.courseGuide.note');
    expect(note).toContain('年份');
    expect(container.querySelector('#courseGuide').textContent).toContain(note);
  });
});

describe('公示栏 · 04 经费支出', () => {
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
