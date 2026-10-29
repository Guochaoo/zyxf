/*
 * /dzhz 顶部栏的滚动过渡 —— 复刻 deepseek.com/harness 的客户端行为。
 *
 * 原页是 framer-motion 驱动的：scrollY > 80 时 header 从「1280 宽、无背景」收成
 * 「980/1180 宽（视口 ≥1560 时取后者）、左右 16/6 内边距、毛玻璃胶囊」，同时把
 * 语言切换换成 GitHub + 下载分体按钮；英雄区的「预览版」小标签滚出视口后，
 * logo 右侧再补一个同样的标签。
 *
 * 节点与文案都在 content.html 里预置（静态复刻件），这里只负责开关与缓动，
 * 不引入 framer-motion。
 */

const SCROLL_THRESHOLD = 80;
const WIDE_VIEWPORT = 1560;

export default function initHeaderScroll(root) {
  const headerBar = root.querySelector('.ds-header-bar');
  if (!headerBar) return () => {};

  const actions = headerBar.querySelector('.dzhz-header-actions');

  headerBar.style.transition =
    'max-width .5s cubic-bezier(.22,1,.36,1), padding-left .5s cubic-bezier(.22,1,.36,1), padding-right .5s cubic-bezier(.22,1,.36,1), background-color .3s ease, border-color .3s ease, backdrop-filter .3s ease';

  const apply = () => {
    const scrolled = window.scrollY > SCROLL_THRESHOLD;
    const wide = window.innerWidth >= WIDE_VIEWPORT;

    headerBar.classList.toggle('is-scrolled', scrolled);
    headerBar.style.maxWidth = scrolled ? (wide ? '1180px' : '980px') : '1280px';
    headerBar.style.paddingLeft = scrolled ? '16px' : '0px';
    headerBar.style.paddingRight = scrolled ? '6px' : '0px';

    if (actions) actions.style.display = scrolled ? 'flex' : 'none';
  };

  const onScroll = () => apply();
  const onResize = () => apply();
  apply();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });

  // ---- 下载分体按钮的下拉菜单 ----
  // 顶栏一份、Hero 一份。菜单挂在分体按钮外层的定位容器上（按钮自身 overflow 会裁掉它），
  // 所以这里按「菜单 → 父元素」反查容器，而不是写死 .dzhz-header-actions。
  const dropdowns = Array.from(root.querySelectorAll('.dzhz-dl-menu')).map(
    (menu) => ({
      holder: menu.parentElement,
      arrow: menu.parentElement?.querySelector('[aria-haspopup="menu"]'),
    })
  );

  const closeAll = () =>
    dropdowns.forEach(({ holder, arrow }) => {
      holder?.classList.remove('dzhz-dl-open');
      arrow?.setAttribute('aria-expanded', 'false');
    });

  const onArrow = (event) => {
    event.stopPropagation();
    const holder = event.currentTarget.closest('.dzhz-header-actions, .dz-hero-dl');
    if (!holder) return;
    const open = !holder.classList.contains('dzhz-dl-open');
    closeAll();
    holder.classList.toggle('dzhz-dl-open', open);
    event.currentTarget.setAttribute('aria-expanded', String(open));
  };

  dropdowns.forEach(({ arrow }) => arrow?.addEventListener('click', onArrow));

  const onDocClick = () => closeAll();
  const onKey = (event) => {
    if (event.key === 'Escape') closeAll();
  };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);

  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    dropdowns.forEach(({ arrow }) => arrow?.removeEventListener('click', onArrow));
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
  };
}
