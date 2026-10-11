import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageTitle from '../components/PageTitle.jsx';
import {
  BUDGET_CENTS,
  EXPENSE_BASE,
  LECTURE_BASE,
  PLAN_BASE,
  spentCents,
} from './Disclosure/data.js';

/* ============================================================
 * 公示栏（/disclosure）——纯前端版式样例
 *
 * 排版主张：三种内容（讲座 = 时间序列、编写计划 = 进度、经费 = 账目）
 * 各用各的版式，但共用一套骨架，于是看起来是「一份文件的三节」而不是
 * 「三个小组件」：
 *   1. 区块头统一为「序号 + 标题 + 右侧元信息」（序号在目录里复用，
 *      点目录能对上号）；
 *   2. 行统一为「左对齐信息列 + 右侧状态位」，状态只用**单色**三档
 *      （实心墨 > 灰底 > 纯文字），不引入第四个强调色（DESIGN.md §2）；
 *   3. 数字统一 tabular-nums；金额一律右对齐（账目的可核对性靠对齐）。
 * ============================================================ */

/* 目录与区块头共用同一份定义，序号只写一次。 */
const SECTIONS = [
  { id: 'lectures', index: '01' },
  { id: 'plans', index: '02' },
  { id: 'expenses', index: '03' },
];

/* ---- 语言相关的格式化：日期 / 时间 / 金额全部走 Intl，源码里不出现
   写死的「10月15日」「¥1,280.00」这类字面量。 ---- */
const intlLocale = (lang) => (String(lang || '').startsWith('en') ? 'en-US' : 'zh-CN');

/* 讲座日程用「10月15日」这种可扫读的短日期（下面是星期，两行一起看）；
   账目用完整日期，便于逐笔核对。两者刻意不同：一个为「什么时候去」，
   一个为「哪一笔」。 */
const dayLong = (iso, locale) =>
  new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(new Date(iso));
const dayFull = (iso, locale) =>
  new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso)
  );
/* 窄屏上完整日期会把「事由」列挤成三行，所以 640px 以下只留月日
   （年份在本页恒定，且完整日期在宽屏仍照常显示）。 */
const dayShort = (iso, locale) =>
  new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit' }).format(new Date(iso));
const weekday = (iso, locale) =>
  new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(iso));
const clock = (date, locale) =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
const money = (cents, locale) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'CNY' }).format(cents / 100);

/* 讲座状态由时间推导，样例因此不会「过期」：讲完自动变已结束。 */
const isPast = (item) => new Date(item.start).getTime() + item.minutes * 60000 < Date.now();

/* #75：字典里可缺省的字段不能只写真值判断——i18next 的 returnObjects 会把空串叶子
   换成 defaultValue（[]），是 truthy。 */
const hasText = (v) => typeof v === 'string' && v.length > 0;

/* 状态位：三档**单色**强调，盒子几何完全一致（否则右列会参差不齐）。 */
const CHIP_BASE =
  'shrink-0 rounded-full px-2.5 py-[3px] text-[11px] font-medium leading-[16px]';
function StatusChip({ tone = 'plain', children }) {
  if (tone === 'strong') return <span className={`${CHIP_BASE} bg-ink text-page`}>{children}</span>;
  if (tone === 'soft') return <span className={`${CHIP_BASE} bg-field text-ink-2`}>{children}</span>;
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

/* ---- 02 编写计划：名称 + 负责人/预计 + 右侧进度条（进度 = 本页主指标） ---- */
const PLAN_TONE = { published: 'strong', review: 'soft', writing: 'soft', planned: 'plain' };

function Plans({ items, texts }) {
  const { t } = useTranslation();
  return (
    <ul>
      {items.map((it, i) => {
        const text = texts[i] ?? {};
        return (
          <li key={it.id}>
            <div
              className={`${ROW} grid grid-cols-1 items-center gap-x-4 gap-y-2 @[520px]:grid-cols-[1fr_auto]`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[14px] font-medium text-ink">{text.title}</span>
                  <StatusChip tone={PLAN_TONE[it.status] ?? 'plain'}>
                    {t(`disclosure.status.${it.status}`)}
                  </StatusChip>
                </div>
                <div className={`mt-1 ${META}`}>
                  <span>{t('disclosure.plans.ownerLabel', { name: text.owner })}</span>
                  {/* 已发布项没有「预计」时间（字典里不给 eta 键），状态已由徽章表达 */}
                  {hasText(text.eta) ? (
                    <>
                      <Dot />
                      <span>{t('disclosure.plans.etaLabel', { eta: text.eta })}</span>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2.5 @[520px]:w-[168px]">
                <div
                  className="h-1 flex-1 overflow-hidden rounded-full bg-field"
                  role="progressbar"
                  aria-valuenow={it.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={text.title}
                >
                  <div className="h-full rounded-full bg-ink" style={{ width: `${it.pct}%` }} />
                </div>
                <span className="w-9 shrink-0 text-right text-[12px] tabular-nums text-ink-2">
                  {it.pct}%
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---- 03 经费支出：先给三个数（预算 / 已支出 / 结余），再逐笔列账 ---- */
function Expenses({ rows, texts, locale }) {
  const { t } = useTranslation();
  const spent = spentCents(rows);
  const pct = Math.round((spent / BUDGET_CENTS) * 100);

  return (
    // 宽屏（lg）下「小结」单独成一列窄轨、表格占满其余宽度：经费是唯一吃宽度的
    // 一节，让表格自己摊到全宽会把「事由」列拉成一大片空白。
    <div className="lg:flex lg:items-start lg:gap-6">
      {/* @container + @[420px]：窄轨里三个数竖排（标签左 / 金额右），
          全宽时才并成三列——用视口断点（sm:）在这里是错的，320px 的轨在
          1440 视口下照样会排成三列，而「¥20,000.00」自己就要 90px。 */}
      <div className="@container rounded-control bg-inset px-4 py-3.5 lg:w-[320px] lg:shrink-0">
        <dl className="grid grid-cols-1 gap-y-1.5 @[420px]:grid-cols-3 @[420px]:gap-x-4 @[420px]:gap-y-0">
          {[
            { key: 'budget', value: BUDGET_CENTS },
            { key: 'spent', value: spent },
            { key: 'remaining', value: BUDGET_CENTS - spent },
          ].map((m) => (
            <div key={m.key} className="flex items-baseline justify-between gap-3 @[420px]:block">
              <dt className="text-[12px] text-ink-3">{t(`disclosure.expenses.${m.key}`)}</dt>
              <dd className="whitespace-nowrap text-[17px] font-semibold tabular-nums text-ink @[420px]:mt-1">
                {money(m.value, locale)}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-3.5 h-1 overflow-hidden rounded-full bg-field">
          <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-[12px] tabular-nums text-ink-3">
          {t('disclosure.expenses.usage', { pct })}
        </p>
      </div>

      <div className="mt-4 overflow-hidden rounded-control lg:mt-0 lg:min-w-0 lg:flex-1">
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
              <th scope="col" className="hidden px-2 py-2 font-medium md:table-cell md:px-3">
                {t('disclosure.expenses.columns.handler')}
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
                  <td className="whitespace-nowrap px-2 py-2.5 text-[12px] tabular-nums text-ink-3 sm:px-3">
                    <span className="sm:hidden">{dayShort(r.date, locale)}</span>
                    <span className="hidden sm:inline">{dayFull(r.date, locale)}</span>
                  </td>
                  <td className="px-2 py-2.5 text-[13px] text-ink sm:px-3">{text.item}</td>
                  <td className="hidden px-2 py-2.5 sm:table-cell sm:px-3">
                    <span className="whitespace-nowrap rounded-md bg-field px-2 py-0.5 text-[11px] text-ink-2">
                      {text.category}
                    </span>
                  </td>
                  <td className="hidden px-2 py-2.5 text-[13px] text-ink-2 md:table-cell md:px-3">
                    {text.handler}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right text-[13px] font-medium tabular-nums text-ink sm:px-3">
                    {money(r.cents, locale)}
                  </td>
                </tr>
              );
            })}
            {/* 合计行：colSpan 写满，内部再用 flex 两端对齐——窄屏会隐藏中间列，
                逐列对位的写法在断点处一定会错位。 */}
            <tr className="bg-field">
              <td colSpan={5} className="px-2 py-2.5 sm:px-3">
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

  const lectureTexts = t('disclosure.lectures.items', { returnObjects: true, defaultValue: [] });
  const planTexts = t('disclosure.plans.items', { returnObjects: true, defaultValue: [] });
  const expenseTexts = t('disclosure.expenses.items', { returnObjects: true, defaultValue: [] });

  /* 目录跳转：尊重系统「减少动态效果」偏好；没有对应节点时退回浏览器原生锚点行为。 */
  const goTo = useCallback((event, id) => {
    const el = document.getElementById(id);
    if (!el) return;
    event.preventDefault();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const activePlans = PLAN_BASE.filter((p) => p.status === 'writing' || p.status === 'review').length;

  return (
    <>
      {/* 页头与统计面板同处同款：logo + 页面名（components/PageTitle），
          页面左上角的位置由 App.jsx 的 main 内边距（px-4 pt-[11px]）给出。 */}
      <PageTitle title={t('disclosure.title')} />

      {/* 四边边距全部由 App.jsx 的 main 给出（`px-4 pt-[11px] pb-6`），与统计面板同源：
          页面铺满可用宽度、**不自设 max-width**——否则宽屏上左右会凭空多出一圈留白
          （1920 视口实测 `max-w-[1600px]` 左右各多 137px，而统计面板是 16px）。
          卡片按内容分列（7 / 5 / 12），每张卡按自身内容取高（items-start），
          于是三块的大小、高低都不一样。 */}
      <section className="w-full">
        {/* 目录：与区块头的序号一一对应（长页面的第一需求是「先知道有几节」）。 */}
        <nav
          aria-label={t('disclosure.navAria')}
          className="flex flex-wrap items-center gap-x-6 gap-y-2"
        >
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={(e) => goTo(e, s.id)}
              className="group flex items-center gap-2 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
            >
              <span className="text-[11px] tabular-nums text-ink-3">{s.index}</span>
              {t(`disclosure.sections.${s.id}.title`)}
            </a>
          ))}
        </nav>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <Section
            id="lectures"
            index="01"
            className="lg:col-span-7"
            title={t('disclosure.sections.lectures.title')}
            meta={t('disclosure.sections.lectures.meta', {
              term: t('disclosure.term'),
              n: LECTURE_BASE.length,
            })}
          >
            <Lectures items={LECTURE_BASE} texts={lectureTexts} locale={locale} />
          </Section>

          {/* @container：进度条是否与文字同排，按**卡片自己的宽度**决定，不看视口——
              lg 刚生效时这张卡只有约 436px（1100 视口 / 12 栅格的第 5 列），用 sm:
              视口断点会让标题被挤成两行、状态徽章掉行。 */}
          <Section
            id="plans"
            index="02"
            className="@container lg:col-span-5"
            title={t('disclosure.sections.plans.title')}
            meta={t('disclosure.sections.plans.meta', { n: PLAN_BASE.length, active: activePlans })}
          >
            <Plans items={PLAN_BASE} texts={planTexts} />
          </Section>

          <Section
            id="expenses"
            index="03"
            className="lg:col-span-12"
            title={t('disclosure.sections.expenses.title')}
            meta={t('disclosure.sections.expenses.meta', { n: EXPENSE_BASE.length })}
          >
            <Expenses rows={EXPENSE_BASE} texts={expenseTexts} locale={locale} />
          </Section>
        </div>

        {/* 页脚：把「这是样例」与「去哪核对」并排放，示例数据不伪装成真账。 */}
        <footer className="mt-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-[12px] text-ink-3">
          <p>{t('disclosure.footer.sample')}</p>
          <Link to="/about" className="text-ink-2 transition-colors hover:text-ink">
            {t('disclosure.footer.contact')}
          </Link>
        </footer>
      </section>
    </>
  );
}
