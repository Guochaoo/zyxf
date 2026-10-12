import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DisclosurePage from '../pages/DisclosurePage.jsx';
import {
  BUDGET_CENTS,
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
  // 区块头 = 「序号 + 标题」，四节一一对应。⚠️ 别按「标题出现 2 次」计数——
  // 「书院课程指南共建计划」在 02 资料编写计划里也是一项（那是计划条目，不是区块头）。
  test('四节的区块头序号与标题一一对应', () => {
    const { container } = renderPage();
    for (const [index, id, title] of [
      ['01', 'lectures', '讲座计划'],
      ['02', 'plans', '资料编写计划'],
      ['03', 'courseGuide', '书院课程指南共建计划'],
      ['04', 'expenses', '本网站经费支出'],
    ]) {
      const head = container.querySelector(`#${id} h2`);
      expect(head.textContent).toContain(title);
      expect(head.textContent).toContain(index);
    }
  });

  // 顶部目录（01–04 锚点）与页脚的「关于我们 · 联系方式」链接都已按需求删除；
  // 区块的 id 保留（深链与下面的测试仍在用），改回来会被这两条拦住。
  test('顶部目录与页脚链接已删除', () => {
    const { container } = renderPage();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(container.querySelector('a[href^="#"]')).toBeNull();
    const footer = container.querySelector('footer');
    expect(footer.querySelector('a')).toBeNull();
    expect(footer.textContent).toContain('阿里云月度账单');
  });

  // 宽度按**内容**给：01 / 02 各 6 列（自然高度 482 / 466，差 16px），03 取 7 列
  // （两条清单并排 + 参与方式横跨），04 只取 5 列（四列窄内容的表，给全宽会把「事由」
  // 列撑到 438px）。同一行的卡片等高：矮卡的留白收进卡内，不在两卡之间留洞。
  test('按内容分列（6 / 6 / 7 / 5）且同行卡片等高', () => {
    const { container } = renderPage();
    const row = container.querySelector('#lectures').parentElement;
    expect(row.className).toContain('lg:grid-cols-12');
    expect(row.className).toContain('items-stretch');
    expect(row.className).not.toContain('items-start');

    // 03 内部那三块面板同理（参与方式总比两张清单高）
    const panels = container.querySelector('#courseGuide ul').closest('div').parentElement;
    expect(panels.className).toContain('items-stretch');
    expect(panels.className).not.toContain('items-start');

    const spans = {
      lectures: 'lg:col-span-6',
      plans: 'lg:col-span-6',
      courseGuide: 'lg:col-span-7',
      expenses: 'lg:col-span-5',
    };
    for (const [id, span] of Object.entries(spans)) {
      expect(container.querySelector(`#${id}`).className).toContain(span);
    }
  });

  // 小结与账目是**上下**关系，不是「320px 窄轨 + 表格」两栏：预算未设置时小结只有三行，
  // 右边却有 10 行表格，窄轨下方空出约 380px（1440 实测）。改回两栏就会重现那个洞。
  test('小结横排在卡片顶部，表格在下方占满宽度', () => {
    const { container } = renderPage();
    const card = container.querySelector('#expenses');
    const summary = card.querySelector('dl');
    const wrap = summary.parentElement; // Expenses 的根节点
    expect(wrap.className).toContain('@container');
    expect(wrap.className).not.toContain('lg:flex');

    const tableWrap = card.querySelector('table').parentElement;
    expect(summary.className).toContain('bg-inset');
    expect(summary.className).toContain('@[420px]:grid-cols-3');
    expect(tableWrap.className).not.toContain('lg:flex-1');
    // dl 在表格之前：DOM 顺序 = 视觉顺序（先小结，后逐笔）
    expect(summary.compareDocumentPosition(tableWrap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
  test('10 项计划全渲染，且每项四列都有内容（资料名 / 时间 / 人数 / 工资）', () => {
    const { container } = renderPage();
    const items = i18n.t('disclosure.plans.items', { returnObjects: true });
    expect(items).toHaveLength(10);

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

  // 共建计划有自己的区块（03），时间 / 人数 / 奖励都在那一节里；
  // 表格再留一行就是同一件事写两份（改一处漏一处），所以钉住「不重复出现」。
  test('共建计划不在编写计划表里重复出现', () => {
    const { container } = renderPage();
    const rows = [...container.querySelectorAll('#plans li')];
    expect(rows.some((li) => li.textContent.includes('书院课程指南共建计划'))).toBe(false);
    // 区块头里的「共 N 项」跟着实际条数走
    expect(container.querySelector('#plans').textContent).toContain('共 10 项');
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

  test('写明「邮件请注明」的信息与奖励口径', () => {
    const { container } = renderPage();
    const card = container.querySelector('#courseGuide');
    for (const label of ['班级', '姓名', '学号', '支付宝账号（选择工资）', '志愿汇编号（选择工时）']) {
      expect(card.textContent).toContain(label);
    }
    // 奖励每篇 ¥200（金额只写在这里，编写计划表里已不再重复）
    expect(card.textContent).toContain('每篇指南 ¥200');
    // 经审核通过后才联系作者并发放奖励，不是「投了就有」
    expect(card.textContent).toContain('经审核通过后');
    expect(card.textContent).toContain('发放奖励');
  });

  test('提醒标注年份与来源（考核方式 / 竞赛时间会变）', () => {
    const { container } = renderPage();
    const note = i18n.t('disclosure.courseGuide.note');
    expect(note).toContain('年份');
    expect(container.querySelector('#courseGuide').textContent).toContain(note);
  });
});

describe('公示栏 · 04 本网站经费支出', () => {
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
    // 小结里的「已支出」必须与逐行之和一致（改数据不会错账）
    expect(parseMoney(screen.getByText('已支出').nextElementSibling.textContent)).toBeCloseTo(sum, 2);
  });

  // 账目取自阿里云月度账单概览（2026-03 至 2026-09，口径为应付金额，只列有实际支出的账目）。
  // 数字是从账单里抄的：更新账单时要连这里的总额一起改——这正是这条断言存在的意义，
  // 公示页上的金额不能因为改数据而被悄悄改动。
  test('账目与账单一致：10 笔、合计 ¥70.96', () => {
    renderPage();
    expect(EXPENSE_BASE).toHaveLength(10);
    expect(spentCents(EXPENSE_BASE)).toBe(7096);
    expect(parseMoney(screen.getByText('已支出').nextElementSibling.textContent)).toBeCloseTo(70.96, 2);
    expect(
      parseMoney(screen.getByText('合计 · 共 10 笔').nextElementSibling.textContent)
    ).toBeCloseTo(70.96, 2);
  });

  test('逐条：账期（年）+ 事由 + 类别都对上字典，且不出现「日」', () => {
    const { container } = renderPage();
    const items = i18n.t('disclosure.expenses.items', { returnObjects: true });
    expect(items).toHaveLength(EXPENSE_BASE.length);

    const rows = [...container.querySelectorAll('#expenses tbody tr')].slice(0, -1);
    expect(rows).toHaveLength(EXPENSE_BASE.length);
    EXPENSE_BASE.forEach((r, i) => {
      const text = rows[i].textContent;
      expect(text).toContain(items[i].item);
      expect(text).toContain(items[i].category);
      expect(text).toContain(r.month.slice(0, 4)); // 账期年份
    });
    const card = container.querySelector('#expenses');
    // 月账单没有「日」：账期列不许编出具体日期
    expect(card.textContent).not.toMatch(/\d+月\d+日/);
    // 账期由 Intl 渲染（zh → 2026年9月），源码里没有写死的月份字面量
    expect(card.textContent).toContain('2026年9月');
  });

  test('列头是「账期」，且没有「经办 / 服务商」列（服务主体恒定，不占宽度）', () => {
    renderPage();
    expect(screen.getByText('账期')).toBeInTheDocument();
    expect(screen.queryByText('日期')).toBeNull();
    expect(screen.queryByText('经办')).toBeNull();
  });

  // 预算还没定（data.js 的 BUDGET_CENTS === null）：显示「-」，结余同样算不出来也是「-」，
  // 支出率细条与百分比整块不画——分母不存在，别为了这张卡好看编一个百分比。
  test('预算未设置时显示「-」，且不画支出率 / 百分比', () => {
    const { container } = renderPage();
    const value = (label) => screen.getByText(label).nextElementSibling.textContent.trim();
    expect(value('预算总额')).toBe('-');
    expect(value('结余')).toBe('-');

    const card = container.querySelector('#expenses');
    expect(card.textContent).toContain('预算尚未设置');
    expect(card.textContent).not.toContain('已使用');
    expect(card.querySelector('[role="progressbar"]')).toBeNull();
    // 细条本身（bg-field 的 h-1 槽）也不该留一条空槽
    expect(card.querySelector('.h-1')).toBeNull();
  });

  // 定预算那天改的应当只有 data.js 一处：把 BUDGET_CENTS 填成分，这段就会回到「预算 − 已支出 = 结余 + 百分比」。
  test('BUDGET_CENTS 仍是「未设置」（null），不是 0 或编出来的数字', () => {
    expect(BUDGET_CENTS).toBeNull();
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
