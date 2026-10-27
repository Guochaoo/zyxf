import { useTranslation } from 'react-i18next';
import PageTitle from '../components/PageTitle.jsx';
import {
  BUDGET_CENTS,
  COURSE_GUIDE_EMAIL,
  EXPENSE_BASE,
  LECTURE_BASE,
  UPDATED_AT,
  spentCents,
} from './Disclosure/data.js';

/* ============================================================
 * 公示栏（/disclosure）
 *
 * 排版主张：四种内容（讲座 = 时间序列、编写计划 = 四列表、共建计划 = 清单 + 参与
 * 方式、经费 = 账目）各用各的版式，但共用一套骨架，于是看起来是「一份文件的四节」
 * 而不是「四个小组件」：
 *   1. 区块头统一为「序号 + 标题 + 右侧元信息」——序号只在区块头出现
 *      （顶部目录已按需求删除）；
 *   2. 行统一为「左对齐信息列 + 右侧数值 / 状态位」，状态只用**单色**三档
 *      （实心墨 > 灰底 > 纯文字），不引入第四个强调色（DESIGN.md §2）；
 *   3. 数字统一 tabular-nums；金额一律右对齐（账目的可核对性靠对齐）。
 *
 * 四节都是真实内容：讲座是实际排期（2026-09-27 / 10-23 / 10-25），编写计划与共建计划
 * 来自编写组，经费取自阿里云月度账单；结构性数据与更新时间见 data.js。
 * ============================================================ */

/* ---- 语言相关的格式化：日期 / 时间 / 金额全部走 Intl，源码里不出现
   写死的「10月15日」「¥1,280.00」这类字面量。 ---- */
const intlLocale = (lang) => (String(lang || '').startsWith('en') ? 'en-US' : 'zh-CN');

/* 讲座日程用「10月15日」这种可扫读的短日期（下面是星期，两行一起看）；
   账目只有**账期（月）**——阿里云月账单没有「日」，所以这里不编一个日出来，
   宽屏印「2026年9月」、窄屏只留「9月」（事由列会被长账期挤成三行）。
   两者刻意不同：一个为「什么时候去」，一个为「哪一笔」。 */
const dayLong = (iso, locale) =>
  new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(new Date(iso));
/* 'YYYY-MM' 按**本地时间**构造，不用 new Date('2026-09')——后者按 UTC 解析，
   UTC+8 下会滑成 9 月 1 日 08:00，跨月风险留给读代码的人是不必要的。 */
const monthDate = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1);
const monthLong = (ym, locale) =>
  new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(monthDate(ym));
const monthShort = (ym, locale) =>
  new Intl.DateTimeFormat(locale, { month: 'short' }).format(monthDate(ym));
const weekday = (iso, locale) =>
  new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(iso));
const clock = (date, locale) =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
const money = (cents, locale) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'CNY' }).format(cents / 100);
/* 区块头右上角只印「更新于 2026年10月28日 00:27」这种可核对的时间：
   年月日 + 时刻都走 Intl（zh 月为「10月」、en 为「October」），源码里不写死日期字面量。 */
const updatedAt = (iso, locale) =>
  new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

/* 讲座状态由时间推导，样例因此不会「过期」：讲完自动变已结束。 */
const isPast = (item) => new Date(item.start).getTime() + item.minutes * 60000 < Date.now();

/* 状态位：两档**单色**强调，盒子几何完全一致（否则右列会参差不齐）。 */
const CHIP_BASE =
  'shrink-0 rounded-full px-2.5 py-[3px] text-[11px] font-medium leading-[16px]';
function StatusChip({ tone = 'plain', children }) {
  if (tone === 'strong') return <span className={`${CHIP_BASE} bg-ink text-page`}>{children}</span>;
  return <span className={`${CHIP_BASE} text-ink-3`}>{children}</span>;
}

/* 区块外壳：无阴影无描边的白卡（与统计面板 / 浏览页卡片同一套语汇）。
   className 用来给宽屏栅格挂跨列（lg:col-span-*）。 */
function Section({ id, index, title, meta, className = '', children }) {
  return (
    <section id={id} className={`scroll-mt-6 rounded-card bg-surface p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="flex items-baseline gap-2.5 text-[17px] font-semibold text-ink">
          <span className="text-[12px] font-normal tabular-nums text-ink-3">{index}</span>
          {title}
        </h2>
        {meta && <p className="text-[12px] tabular-nums text-ink-3">{meta}</p>}
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

/* 行容器：hover 底色块 + 留白分隔（无界：不画分隔线）。 */
const ROW = 'rounded-lg px-3 py-3 transition-colors hover:bg-hover';
const META = 'flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-ink-3';
const Dot = () => (
  <span aria-hidden="true" className="text-ink-3/60">
    ·
  </span>
);

/* ---- 01 讲座计划：日期列 + 内容列（时间轴读法，但不用时间轴装饰） ---- */
function Lectures({ items, texts, locale }) {
  const { t } = useTranslation();
  return (
    <ul>
      {items.map((it, i) => {
        const past = isPast(it);
        const text = texts[i] ?? {};
        const end = new Date(new Date(it.start).getTime() + it.minutes * 60000);
        return (
          <li key={it.id}>
            <div
              className={`${ROW} grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-1.5 sm:grid-cols-[104px_1fr_auto] sm:gap-y-0`}
            >
              <div className="whitespace-nowrap sm:pt-[1px]">
                <div className={`text-[13px] font-semibold tabular-nums ${past ? 'text-ink-3' : 'text-ink'}`}>
                  {dayLong(it.start, locale)}
                </div>
                <div className="text-[12px] text-ink-3">{weekday(it.start, locale)}</div>
              </div>

              <div className="col-start-2 min-w-0">
                <div className={`text-[14px] font-medium ${past ? 'text-ink-2' : 'text-ink'}`}>
                  {text.title}
                </div>
                <div className={`mt-1 ${META}`}>
                  <span className="tabular-nums">
                    {clock(new Date(it.start), locale)}–{clock(end, locale)}
                  </span>
                  <Dot />
                  <span>{text.place}</span>
                  <Dot />
                  <span>{t('disclosure.lectures.speakerLabel', { name: text.speaker })}</span>
                </div>
              </div>

              <div className="col-start-2 sm:col-start-3 sm:self-start">
                <StatusChip tone={past ? 'plain' : 'strong'}>
                  {past ? t('disclosure.status.done') : t('disclosure.status.open')}
                </StatusChip>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---- 02 资料编写计划：四列 = 资料名 / 预计完成时间 / 志愿者人数 / 工资 ----
   四列就是文档要求的四项，宽容器直接排成表（bg-field 表头，与经费表同一套语汇）；
   窄容器（手机）四列塞不下，改成「名称 + 工资」一行、「时间 · 人数」一行的两行式。
   切换看**卡片自身宽度**（@container @[540px]），不看视口——lg 刚生效时这张卡
   只有约 616px，用视口断点会把四列压成一团。 */
function Plans({ items }) {
  const { t } = useTranslation();
  return (
    <div className="@container">
      {/* 表头只在宽容器出现，两行式的窄卡片不需要 */}
      <div className="hidden rounded-control bg-field px-3 py-2 text-[12px] font-medium text-ink @[540px]:grid @[540px]:grid-cols-[1fr_7rem_5rem_7rem] @[540px]:gap-x-3">
        <span>{t('disclosure.plans.columns.item')}</span>
        <span>{t('disclosure.plans.columns.time')}</span>
        <span className="text-right">{t('disclosure.plans.columns.people')}</span>
        <span className="text-right">{t('disclosure.plans.columns.pay')}</span>
      </div>
      <ul className="mt-1.5">
        {items.map((it) => (
          <li
            key={it.title}
            className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5 rounded-lg px-3 py-2 transition-colors hover:bg-hover @[540px]:grid-cols-[1fr_7rem_5rem_7rem] @[540px]:gap-y-0 @[540px]:py-1.5"
          >
            <span className="min-w-0 text-[13px] text-ink">{it.title}</span>
            {/* 窄容器：时间落到第二行；宽容器：回到第 2 列同一行 */}
            <span className="col-start-1 row-start-2 text-[12px] tabular-nums text-ink-3 @[540px]:col-start-2 @[540px]:row-start-1 @[540px]:text-[13px]">
              {it.time}
            </span>
            <span className="col-start-2 row-start-2 text-right text-[12px] tabular-nums text-ink-3 @[540px]:col-start-3 @[540px]:row-start-1 @[540px]:text-[13px]">
              {it.people}
            </span>
            <span className="col-start-2 row-start-1 text-right text-[13px] font-medium tabular-nums text-ink @[540px]:col-start-4">
              {it.pay}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---- 03 书院课程指南共建计划：两条线各一份「整理什么」的清单 + 参与方式 ----
   读法上分三段，段与段之间靠留白与表面色深浅分开（不画线）：
     1. 导语；
     2. 三块 `bg-inset` 内嵌面板：课程指南 / 竞赛指南 / 参与方式 —— 宽容器里并排
        （`@[720px]` 两块一行、参与方式横跨两列，`@[1080px]` 起三块各占一列）；
     3. 注意：要求标注年份与来源，是给贡献者的约束，不做成清单项。
   清单里的圆点是自绘的 4px 静音标记（`bg-ink-3`），不用 `list-disc`：盘符圆点的
   大小随字体变，且会带上默认缩进（DESIGN.md §2 的单色语汇里不需要第五种符号）。 */
function GuideList({ heading, intro, items }) {
  return (
    <div className="rounded-control bg-inset px-4 py-3.5">
      <h3 className="text-[13px] font-semibold text-ink">{heading}</h3>
      <p className="mt-1 text-[12px] text-ink-3">{intro}</p>
      <ul className="mt-2.5 space-y-1.5">
        {items.map((it) => (
          <li key={it} className="flex gap-2.5 text-[13px] leading-[20px] text-ink-2">
            <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" />
            <span className="min-w-0">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CourseGuide() {
  const { t } = useTranslation();
  const guide = t('disclosure.courseGuide.guide', { returnObjects: true, defaultValue: {} });
  const contest = t('disclosure.courseGuide.contest', { returnObjects: true, defaultValue: {} });
  const join = t('disclosure.courseGuide.join', { returnObjects: true, defaultValue: {} });

  return (
    <>
      <p className="max-w-[70ch] text-[13px] leading-[22px] text-ink-2">
        {t('disclosure.courseGuide.lead')}
      </p>

      {/* 三块面板同样等高（`items-stretch`）：参与方式的文字量总比两张清单多，
          同排拉伸后两张清单卡下方不会留洞，多出来的 36–80px 变成卡内底部留白。
          两栏档取 `@[660px]`（不是 720）：03 这一节在 12 栅格里只占 7 列，1280 视口下
          卡片 713px、容器 673px——卡在 720 上会掉回单栏（三块竖排，高 816px），
          与右边 636px 的经费卡差出 180px 的空白；660 让它在 1280 起就是两栏（573px）。 */}
      <div className="mt-3.5 grid grid-cols-1 items-stretch gap-3 @[660px]:grid-cols-2 @[1080px]:grid-cols-3">
        <GuideList heading={guide.title} intro={guide.intro} items={guide.items ?? []} />
        <GuideList heading={contest.title} intro={contest.intro} items={contest.items ?? []} />

        {/* 参与方式：横跨两列时是「标题在左、说明在右」的横条，到了三栏模式
            （`@[1080px]` 起，面板只剩一列宽）落回上下两行。
            ⚠️ 这里必须用**外层**（Section）的容器宽度分档：`@container` 只对
            后代生效，给面板自己挂 `@container` 再写 `@[560px]:` 判的是外面那张卡
            的宽度——面板只有 443px 也会走进两栏，正文被压成 271px 一列。 */}
        <div className="rounded-control bg-inset px-4 py-3.5 @[660px]:col-span-2 @[1080px]:col-span-1 @[660px]:grid @[660px]:grid-cols-[7.5rem_1fr] @[660px]:gap-x-5 @[1080px]:block">
          <h3 className="text-[13px] font-semibold text-ink">{join.title}</h3>
          <div className="mt-2 space-y-1.5 text-[13px] leading-[22px] text-ink-2 @[660px]:mt-0 @[1080px]:mt-2">
            <p>{join.open}</p>
            <p>
              {join.submit}{' '}
              {/* 邮箱不是链接蓝色的锚文本：本页除页脚导航外没有蓝色，用墨色 + 下划线
                  表达「可点」，暗色下也随之反转 */}
              <a
                href={`mailto:${COURSE_GUIDE_EMAIL}`}
                className="font-medium text-ink underline decoration-ink-3 underline-offset-2 transition-colors hover:decoration-ink"
              >
                {COURSE_GUIDE_EMAIL}
              </a>
            </p>
            {/* 「邮件请注明」一行：标签用三级色、内容用次级色。每一项自己 nowrap，
                分隔符（zh 顿号 / en 逗号）跟着前一项——窄面板里只会整项换行，
                不会把「志愿汇编号（选择工时）」断成两行（1280 下出现过孤立的两字行） */}
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[12px] text-ink-3">{join.attachLabel}</span>
              {(join.attach ?? []).map((it, i, list) => (
                <span key={it} className="whitespace-nowrap text-[12px] text-ink-2">
                  {i < list.length - 1 ? `${it}${join.attachSep}` : it}
                </span>
              ))}
            </div>
            {/* 奖励：本节的「数字」。与资料编写计划「工资」列同一档处理——
                13px / 500 / tabular-nums / --ink，比四周的说明文字重一档 */}
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[12px] text-ink-3">{join.rewardLabel}</span>
              <span className="text-[13px] font-medium tabular-nums text-ink">{join.reward}</span>
            </div>
            <p>{join.review}</p>
            <p>{join.welcome}</p>
          </div>
        </div>
      </div>

      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[12px] text-ink-3">
        <span className="font-medium text-ink-2">{t('disclosure.courseGuide.noteLabel')}</span>
        <span>{t('disclosure.courseGuide.note')}</span>
      </p>
    </>
  );
}

/* ---- 04 本网站经费支出：先给三个数（预算 / 已支出 / 结余），再逐笔列账 ----
   账目取自阿里云月度账单概览：**账期只有月**（没有日），只列有实际支出的账目，
   金额是账单的「应付金额」。全部服务主体都是阿里云，所以没有「经办 / 服务商」列。
   预算**还没定**（`BUDGET_CENTS === null`）：那就显示「-」，结余同样算不出来也是「-」，
   支出率细条与百分比整块不画——「已使用 57%」这种数是拿预算当分母算的，
   没有预算就没有百分比，别为了这张卡好看编一个（与 02 计划卡不编进度条同一条原则）。 */
function Expenses({ rows, texts, locale }) {
  const { t } = useTranslation();
  const spent = spentCents(rows);
  const hasBudget = Number.isFinite(BUDGET_CENTS) && BUDGET_CENTS > 0;
  const pct = hasBudget ? Math.round((spent / BUDGET_CENTS) * 100) : null;

  return (
    // 小结**横排在卡片顶部**，表格在下面占满宽度。
    // 早先是「320px 窄轨 + 表格」两栏，预算没定之后小结只剩三个数，
    // 右边却有 10 行账目 —— 窄轨下方空出约 380px（1440 实测），一眼就是个洞。
    // 三个数横排后这节和 03 一样是「一条带 + 一块内容」，也不再需要给表格让宽度。
    <div className="@container">
      {/* 三个数：宽容器里并排三格（每格「标签 + 数值」一行，两端对齐＝三列对齐的读数条）；
          窄容器里竖排三行。用容器查询而不是 sm:：卡片的宽度不跟着视口走。
          刻意**不**把标签压到数值上方：那样这条带子会从 50px 涨到 110px，
          而它右边（改版前）的表格只有 570 上下，行内又会多出一截空白。 */}
      <dl className="grid grid-cols-1 gap-y-1.5 rounded-control bg-inset px-4 py-3 @[420px]:grid-cols-3 @[420px]:gap-x-6 @[420px]:gap-y-0">
        {[
          { key: 'budget', value: hasBudget ? BUDGET_CENTS : null },
          { key: 'spent', value: spent },
          { key: 'remaining', value: hasBudget ? BUDGET_CENTS - spent : null },
        ].map((m) => (
          <div key={m.key} className="flex items-baseline justify-between gap-3">
            <dt className="text-[12px] text-ink-3">{t(`disclosure.expenses.${m.key}`)}</dt>
            {/* 没数的那两格用三级色占位：位置和字号不变，一眼能看出「这格还没有数」 */}
            <dd
              className={`whitespace-nowrap text-[15px] font-semibold tabular-nums ${
                m.value === null ? 'text-ink-3' : 'text-ink'
              }`}
            >
              {m.value === null ? '-' : money(m.value, locale)}
            </dd>
          </div>
        ))}
      </dl>
      {hasBudget ? (
        <>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-field">
            <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-[12px] tabular-nums text-ink-3">
            {t('disclosure.expenses.usage', { pct })}
          </p>
        </>
      ) : (
        <p className="mt-2 text-[12px] text-ink-3">{t('disclosure.expenses.noBudget')}</p>
      )}

      <div className="mt-3.5 overflow-hidden rounded-control">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="rb-table-heading bg-field text-[12px] font-medium">
              <th scope="col" className="px-2 py-2 font-medium sm:px-3">
                {t('disclosure.expenses.columns.date')}
              </th>
              <th scope="col" className="px-2 py-2 font-medium sm:px-3">
                {t('disclosure.expenses.columns.item')}
              </th>
              <th scope="col" className="hidden px-2 py-2 font-medium sm:table-cell sm:px-3">
                {t('disclosure.expenses.columns.category')}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3">
                {t('disclosure.expenses.columns.amount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const text = texts[i] ?? {};
              return (
                <tr key={r.id} className="transition-colors hover:bg-hover">
                  <td className="whitespace-nowrap px-2 py-2 text-[12px] tabular-nums text-ink-3 sm:px-3">
                    <span className="sm:hidden">{monthShort(r.month, locale)}</span>
                    <span className="hidden sm:inline">{monthLong(r.month, locale)}</span>
                  </td>
                  <td className="px-2 py-2 text-[13px] text-ink sm:px-3">{text.item}</td>
                  <td className="hidden px-2 py-2 sm:table-cell sm:px-3">
                    <span className="whitespace-nowrap rounded-md bg-field px-2 py-0.5 text-[11px] text-ink-2">
                      {text.category}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right text-[13px] font-medium tabular-nums text-ink sm:px-3">
                    {money(r.cents, locale)}
                  </td>
                </tr>
              );
            })}
            {/* 合计行：colSpan 写满，内部再用 flex 两端对齐——窄屏会隐藏中间列，
                逐列对位的写法在断点处一定会错位。 */}
            <tr className="bg-field">
              <td colSpan={4} className="px-2 py-2 sm:px-3">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[12px] font-medium text-ink">
                    {t('disclosure.expenses.total', { n: rows.length })}
                  </span>
                  <span className="text-[13px] font-semibold tabular-nums text-ink">
                    {money(spent, locale)}
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DisclosurePage() {
  const { t, i18n } = useTranslation();
  const locale = intlLocale(i18n.language);

  // #75：这几个数组里的字段都别写空串——i18next 的 returnObjects 会把空串叶子
  // 换成 defaultValue（[]），是 truthy，`{v ? …}` 这种判断会被静默误触发。
  const lectureTexts = t('disclosure.lectures.items', { returnObjects: true, defaultValue: [] });
  const planTexts = t('disclosure.plans.items', { returnObjects: true, defaultValue: [] });
  const expenseTexts = t('disclosure.expenses.items', { returnObjects: true, defaultValue: [] });

  return (
    <>
      {/* 页头与统计面板同处同款：logo + 页面名（components/PageTitle），
          页面左上角的位置由 App.jsx 的 main 内边距（px-4 pt-[11px]）给出。 */}
      <PageTitle title={t('disclosure.title')} />

      {/* 四边边距全部由 App.jsx 的 main 给出（`px-4 pt-[11px] pb-6`），与统计面板同源：
          页面铺满可用宽度、**不自设 max-width**——否则宽屏上左右会凭空多出一圈留白
          （1920 视口实测 `max-w-[1600px]` 左右各多 137px，而统计面板是 16px）。
          卡片按**内容需要的宽度**分列（6 / 6 / 7 / 5），见下面栅格那段注释。
          正文直接开始：**顶部那行 01–04 锚点目录已按需求删除**（页面现在只有 ~1300px 高，
          序号在区块头里还看得见）；区块的 `id` 保留，深链与测试仍在用。 */}
      <section className="w-full">
        {/* 分列栅格：宽度按**内容**给，不是按"排满一行"给——四节各占多少列是量出来的：
              06 / 06 ｜ 07 / 05
            · 01 讲座 + 02 编写计划 各 6 列：两张卡在这档的自然高度是 482 / 466（差 16px）。
              用 5 / 7 时 01 的「时间 · 地点 · 主讲」在 1280 视口下折行、长到 602px，
              02 只有 466px，行内会空出 136px。
            · 03 共建 7 列：@[720px] 档（卡片 ≥760）里两条清单并排、参与方式横跨两列，
              自然高度约 573；再宽也只是把两栏拉长，不会多出信息。
            · 04 经费 5 列：这张表只有四列窄内容（账期 / 事由 / 类别 / 金额），给 12 列时
              「事由」列会被撑到 438px，一眼一大片空白；5 列（1440 下 571px）里事由列约 172px。
            `items-stretch`（默认值，这里显式写出来）：同一行的卡片**等高**，矮卡的下方
            留白收进卡片内部，而不是在两张卡之间留一个洞。 */}
        <div className="mt-4 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
          <Section
            id="lectures"
            index="01"
            className="lg:col-span-6"
            title={t('disclosure.sections.lectures.title')}
            meta={t('disclosure.updated', { time: updatedAt(UPDATED_AT.lectures, locale) })}
          >
            <Lectures items={LECTURE_BASE} texts={lectureTexts} locale={locale} />
          </Section>

          <Section
            id="plans"
            index="02"
            className="@container lg:col-span-6"
            title={t('disclosure.sections.plans.title')}
            meta={t('disclosure.updated', { time: updatedAt(UPDATED_AT.plans, locale) })}
          >
            <Plans items={planTexts} />
          </Section>

          <Section
            id="courseGuide"
            index="03"
            className="@container lg:col-span-7"
            title={t('disclosure.sections.courseGuide.title')}
            meta={t('disclosure.updated', { time: updatedAt(UPDATED_AT.courseGuide, locale) })}
          >
            <CourseGuide />
          </Section>

          <Section
            id="expenses"
            index="04"
            className="lg:col-span-5"
            title={t('disclosure.sections.expenses.title')}
            meta={t('disclosure.updated', { time: updatedAt(UPDATED_AT.expenses, locale) })}
          >
            <Expenses rows={EXPENSE_BASE} texts={expenseTexts} locale={locale} />
          </Section>
        </div>
      </section>
    </>
  );
}
