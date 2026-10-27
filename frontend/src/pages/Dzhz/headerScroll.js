/*
 * /dzhz 顶部栏的滚动过渡 —— 复刻 deepseek.com/harness 的客户端行为。
 *
 * 原页是 framer-motion 驱动的：scrollY > 80 时 header 从「1280 宽、无背景」收成
 * 「980/1180 宽（视口 ≥1560 时取后者）、左右 16/6 内边距、毛玻璃胶囊」，同时把
 * 语言切换换成 GitHub + 下载分体按钮；英雄区的「预览版」小标签滚出视口后，
 * logo 右侧再补一个同样的标签。
 *
 * 节点与文案都在 page.html 里预置（静态复刻件），这里只负责开关与缓动，
 * 不引入 framer-motion。
 */

const SCROLL_THRESHOLD = 80;
const WIDE_VIEWPORT = 1560;
// 站点自己的菜单按钮固定在右上角（80px 宽），滚动后右侧按钮要让开它。
const MENU_CLEARANCE = 88;

const MAC_DOWNLOAD =
  'https://download.deepseek.com/desktop/dsh-latest-macos-arm64.dmg';

export default function initHeaderScroll(root) {
  const headerBar = root.querySelector('.ds-header-bar');
  if (!headerBar) return () => {};

  const rightCluster = Array.from(headerBar.children).find(
    (el) => el.tagName === 'DIV' && el.className.includes('md:flex')
  );
  const localeWrap = rightCluster ? rightCluster.firstElementChild : null;
  const actions = headerBar.querySelector('.dzhz-header-actions');
  const arrow = actions?.querySelector('.HarnessDownloadMenu_arrow__60_9L');
  const primaryDownload = actions?.querySelector(
    '.HarnessDownloadMenu_action__Qe9nK'
  );
  const badgeHost = headerBar.querySelector('.dzhz-header-badge');

  // 原页按访客平台决定主按钮指向哪个安装包；文案不变，只换 href。
  if (primaryDownload && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)) {
    primaryDownload.href = MAC_DOWNLOAD;
  }

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
    if (localeWrap) localeWrap.style.display = scrolled ? 'none' : '';
    if (rightCluster) rightCluster.style.paddingRight = wide ? '' : `${MENU_CLEARANCE}px`;
  };

  const onScroll = () => apply();
  const onResize = () => apply();
  apply();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });

  // ---- 下载分体按钮的下拉菜单 ----
  const setOpen = (open) => {
    if (!actions || !arrow) return;
    actions.classList.toggle('dzhz-dl-open', open);
    arrow.setAttribute('aria-expanded', String(open));
  };
  const onArrow = (event) => {
    event.stopPropagation();
    setOpen(!actions.classList.contains('dzhz-dl-open'));
  };
  const onDocClick = () => setOpen(false);
  const onKey = (event) => {
    if (event.key === 'Escape') setOpen(false);
  };
  arrow?.addEventListener('click', onArrow);
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);

  // ---- 英雄区标签 → header 徽标 ----
  const heroLabel = root.querySelector('[data-hero-preview-label]');
  let viewObserver;
  if (heroLabel && badgeHost) {
    viewObserver = new IntersectionObserver(
      ([entry]) => {
        const show = !entry.isIntersecting;
        badgeHost.style.opacity = show ? '1' : '0';
        badgeHost.style.visibility = show ? 'visible' : 'hidden';
        badgeHost.style.transform = show ? 'none' : 'translateX(-6px)';
      },
      { threshold: 0 }
    );
    viewObserver.observe(heroLabel);
  }

  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    arrow?.removeEventListener('click', onArrow);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
    viewObserver?.disconnect();
  };
}
