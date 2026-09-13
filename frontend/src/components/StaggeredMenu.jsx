import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CircleUserRound, LogIn, LogOut, Settings } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside.js';
import GithubStarButton from './GithubStarButton.jsx';
import './StaggeredMenu.css';

// IMPROVE-23：gsap 改为动态 import，避免常驻首屏预加载整个动画库；等待期间面板由 CSS
// 预置为不可见（opacity:0），所以是「还没出现」而不是闪烁。
let gsapPromise = null;
function loadGsap() {
  if (window.gsap) return Promise.resolve(window.gsap);
  if (!gsapPromise) {
    gsapPromise = import('gsap')
      .then((m) => {
        window.gsap = m.gsap;
        window.onGdReady?.();
        return m.gsap;
      })
      .catch((e) => {
        gsapPromise = null; // 失败不缓存，下次交互可重试
        throw e;
      });
  }
  return gsapPromise;
}

// Query the animated panel content and reset it to its pre-open state
// (labels pushed down/rotated, numbers and socials hidden). Returns the
// elements so the open timeline can tween them back in; also used after the
// close tween finishes to leave the panel ready for the next open.
// `g` 是惰性取回的 gsap 实例（模块级不再静态 import，见 loadGsap）。
function resetPanelContent(g, panel) {
  const itemEls = Array.from(panel.querySelectorAll('.sm-panel-itemLabel'));
  if (itemEls.length) {
    g.set(itemEls, { yPercent: 140, rotate: 10 });
  }
  const numberEls = Array.from(panel.querySelectorAll('.sm-panel-list[data-numbering] .sm-panel-item'));
  if (numberEls.length) {
    g.set(numberEls, { '--sm-num-opacity': 0 });
  }
  const socialTitle = panel.querySelector('.sm-socials-title');
  if (socialTitle) g.set(socialTitle, { opacity: 0 });
  const socialLinks = Array.from(panel.querySelectorAll('.sm-socials-link'));
  if (socialLinks.length) g.set(socialLinks, { y: 25, opacity: 0 });
  const accountCard = panel.querySelector('.sm-account-card');
  if (accountCard) g.set(accountCard, { y: 25, opacity: 0 });
  return { itemEls, numberEls, socialTitle, socialLinks, accountCard };
}

// Pre-layer band colors: up to 4 accent colors (fallback pair); with 3+ the
// middle one is dropped so the stack reads as two flanking bands.
function prelayerColors(colors) {
  const raw = colors && colors.length ? colors.slice(0, 4) : ['#1e1e22', '#35353c'];
  if (raw.length >= 3) raw.splice(Math.floor(raw.length / 2), 1);
  return raw;
}

const StaggeredMenu = forwardRef(function StaggeredMenu(
  {
    position = 'right',
    colors = ['#B497CF', '#5227FF'],
    items = [],
    socialItems = [],
    displaySocials = true,
    displayItemNumbering = true,
    account,
    className,
    menuButtonColor = '#fff',
    openMenuButtonColor = '#fff',
    accentColor = '#5227FF',
    changeMenuColorOnOpen = true,
    isFixed = false,
    closeOnClickAway = true,
    hideToggleButton = false,
    onMenuOpen,
    onMenuClose,
    onOpenSettings
  },
  ref
) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const panelRef = useRef(null);
  const preLayersRef = useRef(null);
  const preLayerElsRef = useRef([]);
  const plusHRef = useRef(null);
  const plusVRef = useRef(null);
  const iconRef = useRef(null);
  const textInnerRef = useRef(null);
  const [textLines, setTextLines] = useState([t('menu.toggleOpen'), t('menu.toggleClose')]);
  // 动画库按需就位：未就位时视觉上什么都不会出现（CSS 已把面板/预层预置为 opacity:0），
  // 交互本身不依赖它（点击仍会开合 data-open 与 aria 状态）。
  const [gInit, setGInit] = useState(null);
  const gRef = useRef(null);

  // gsap 就位后把面板/预层挪到屏幕外（再交给时间线推进）。原先这步在 useLayoutEffect 里
  // 同步执行；惰性加载后推迟到 gsap 到位时，等待期间由 CSS 的 opacity:0 保证不可见。
  // IMPROVE-52：抽成普通函数供「首次交互预取」在 React 提交前同步调用——playOpen 的
  // 微任务可能跑在 layout effect 之前，首次打开必须保证预置已就位。幂等，可重复调用。
  // Star 按钮的「收进开关按钮下方」位移量：平移 Δ 后按钮右缘与开关右缘重合，
  // 两颗黑胶囊叠在一起、开关在上层把它盖住。星标当前可能带着 gsap x 位移，
  // 用 rect 加回该位移得到无变换的布局右缘，两值同为视口坐标可直接相减。
  const ghStarDelta = (g) => {
    const star = ghStarRef.current;
    const btn = toggleBtnRef.current;
    if (!star || !btn) return 0;
    const cur = g ? Number(g.getProperty(star, 'x')) || 0 : 0;
    const starRight = star.getBoundingClientRect().right - cur;
    return btn.getBoundingClientRect().right - starRight;
  };

  const preparePanel = (g) => {
    // BUG-106：菜单开着时绝不重跑预置——开关按钮的 hover/focus 都会触发 ensureGsap，
    // 重跑会把面板打回屏外并复位图标/文字，而 React 开合态不变（遮罩留存、面板消失）。
    if (openRef.current) return;
    const panel = panelRef.current;
    const preContainer = preLayersRef.current;
    const plusH = plusHRef.current;
    const plusV = plusVRef.current;
    const icon = iconRef.current;
    const textInner = textInnerRef.current;
    if (!panel || !plusH || !plusV || !icon || !textInner) return;

    let preLayers = [];
    if (preContainer) {
      preLayers = Array.from(preContainer.querySelectorAll('.sm-prelayer'));
    }
    preLayerElsRef.current = preLayers;

    const offscreen = position === 'left' ? -100 : 100;
    g.set([panel, ...preLayers], { xPercent: offscreen, opacity: 1 });
    if (preContainer) {
      g.set(preContainer, { xPercent: 0, opacity: 1 });
    }
    g.set(plusH, { transformOrigin: '50% 50%', rotate: 0 });
    g.set(plusV, { transformOrigin: '50% 50%', rotate: 90 });
    g.set(icon, { rotate: 0, transformOrigin: '50% 50%' });
    // textInner 的 yPercent 不在这里归位（BUG-110）：开合一轮后 textLines[0] 是
    // 「关闭」，归零会让关闭态悬停时按钮显示成「关闭」——文字由 animateText /
    // 语言切换 effect 独占管理。
    const star = ghStarRef.current;
    if (star) g.set(star, { x: ghStarDelta(g), opacity: 0 });
    if (toggleBtnRef.current) g.set(toggleBtnRef.current, { color: menuButtonColor });
  };

  // IMPROVE-52：gsap 不再「挂载即预取」——本组件常驻所有页面，原先每次进站都会下载
  // gsap chunk。现在只在用户首次与菜单按钮交互（悬停/按下/聚焦）时取回；取回后先同步
  // 预置面板再通知 React（useLayoutEffect 只负责 menuButtonColor/position 变化的重放）。
  const ensureGsap = useCallback(() => {
    loadGsap()
      .then((g) => {
        gRef.current = g;
        preparePanel(g);
        setGInit((prev) => prev || g);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, menuButtonColor]);

  // 语言切换后按钮文字要立刻跟上：textLines 的初值只在首次渲染取自 t()，之后仅由
  // 开合动画重建，所以切语言时可见文字会停留在旧语言（同一按钮的 aria-label 是
  // 响应式的，只有可见文字不动），要等点一下或刷新才更新。这里在 t 变化时把序列
  // 收敛为一行当前文案并复位位移。
  // 依赖里刻意不含 open：改用 openRef 读取当前开合态，否则开合时会把动画序列重置掉。
  useEffect(() => {
    const openLabel = t('menu.toggleOpen');
    const closeLabel = t('menu.toggleClose');
    setTextLines([openRef.current ? closeLabel : openLabel]);
    if (textInnerRef.current) gInit?.set(textInnerRef.current, { yPercent: 0 });
  }, [t, gInit]);

  const openTlRef = useRef(null);
  const closeTweenRef = useRef(null);
  const spinTweenRef = useRef(null);
  const textCycleAnimRef = useRef(null);
  const colorTweenRef = useRef(null);
  const toggleBtnRef = useRef(null);
  // GitHub Star 按钮在 header 之外、面板之外（面板打开时它在面板顶层区域的左侧），
  // 必须参与 click-outside 豁免——否则 mousedown 先收起菜单会抢在链接点击前把
  // 按钮动画撤走。
  const ghStarRef = useRef(null);
  const busyRef = useRef(false);
  // 打开动画的开合轮次：await gsap 期间用户可能已经点了关闭（甚至又点开），
  // 回来的时间线只有在「仍是同一轮且仍是打开态」时才允许播放。
  const openGenRef = useRef(0);

  // menuButtonColor / position 变化时重放预置（首次就位由 ensureGsap 同步处理）。
  useLayoutEffect(() => {
    if (!gInit) return undefined;
    const ctx = gInit.context(() => preparePanel(gInit));
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gInit, menuButtonColor, position]);

  // 拿到 gsap 实例后才构造时间线；返回 null 表示本环境没有动画（交互仍然可用）。
  const buildOpenTimeline = useCallback((g) => {
    const panel = panelRef.current;
    // 预层元素就地取回（IMPROVE-52）：不依赖 React 是否已提交预置效果——
    // 首次打开时 playOpen 的微任务可能跑在 layout effect 之前。
    const layers = preLayerElsRef.current.length
      ? preLayerElsRef.current
      : Array.from(preLayersRef.current?.querySelectorAll('.sm-prelayer') || []);
    if (!g || !panel) return null;

    openTlRef.current?.kill();
    if (closeTweenRef.current) {
      closeTweenRef.current.kill();
      closeTweenRef.current = null;
    }

    const { itemEls, numberEls, socialTitle, socialLinks, accountCard } = resetPanelContent(g, panel);

    const offscreen = position === 'left' ? -100 : 100;
    const layerStates = layers.map(el => ({ el, start: offscreen }));
    const panelStart = offscreen;

    // BUG-106：面板/预层的可见性由打开时间线自己接管——preparePanel 在菜单开着时会被
    // 守卫跳过（否则悬停开关会把面板复位），首次打开时 gsap 迟到也不能依赖它先跑过。
    if (preLayersRef.current) g.set(preLayersRef.current, { opacity: 1 });

    const tl = g.timeline({ paused: true });

    // Star 按钮从开关按钮下方流出：起点与开关右缘重合（藏在开关后面），
    // 淡入并左滑到面板条目左缘对齐的终位；随面板后半程进场。
    const star = ghStarRef.current;
    if (star) {
      tl.fromTo(
        star,
        { x: ghStarDelta(g), opacity: 0 },
        { x: 0, opacity: 1, duration: 0.55, ease: 'power3.out' },
        0.32
      );
    }

    layerStates.forEach((ls, i) => {
      tl.fromTo(ls.el, { xPercent: ls.start, opacity: 1 }, { xPercent: 0, opacity: 1, duration: 0.5, ease: 'power4.out' }, i * 0.07);
    });
    const lastTime = layerStates.length ? (layerStates.length - 1) * 0.07 : 0;
    const panelInsertTime = lastTime + (layerStates.length ? 0.08 : 0);
    const panelDuration = 0.65;
    tl.fromTo(
      panel,
      { xPercent: panelStart, opacity: 1 },
      { xPercent: 0, opacity: 1, duration: panelDuration, ease: 'power4.out' },
      panelInsertTime
    );

    if (itemEls.length) {
      const itemsStartRatio = 0.15;
      const itemsStart = panelInsertTime + panelDuration * itemsStartRatio;
      tl.to(
        itemEls,
        {
          yPercent: 0,
          rotate: 0,
          duration: 1,
          ease: 'power4.out',
          stagger: { each: 0.1, from: 'start' }
        },
        itemsStart
      );
      if (numberEls.length) {
        tl.to(
          numberEls,
          {
            duration: 0.6,
            ease: 'power2.out',
            '--sm-num-opacity': 1,
            stagger: { each: 0.08, from: 'start' }
          },
          itemsStart + 0.1
        );
      }
    }

    const socialsStart = panelInsertTime + panelDuration * 0.4;
    if (socialTitle) {
      tl.to(
        socialTitle,
        {
          opacity: 1,
          duration: 0.5,
          ease: 'power2.out'
        },
        socialsStart
      );
    }
    if (socialLinks.length) {
      tl.to(
        socialLinks,
        {
          y: 0,
          opacity: 1,
          duration: 0.55,
          ease: 'power3.out',
          stagger: { each: 0.08, from: 'start' },
          onComplete: () => {
            g.set(socialLinks, { clearProps: 'opacity' });
          }
        },
        socialsStart + 0.04
      );
    }
    if (accountCard) {
      tl.to(
        accountCard,
        {
          y: 0,
          opacity: 1,
          duration: 0.55,
          ease: 'power3.out',
          onComplete: () => {
            g.set(accountCard, { clearProps: 'all' });
          }
        },
        socialsStart + 0.12
      );
    }

    openTlRef.current = tl;
    return tl;
  }, []);

  const playOpen = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    const gen = (openGenRef.current += 1);
    // 动画库可能还没就位（首次点击通常已预取完成）：等到位再放时间线。
    // 期间用户若已关闭或再次开合，本轮结果直接丢弃，绝不在关闭态上播放打开动画。
    Promise.resolve()
      .then(() => gRef.current || loadGsap())
      .catch(() => null)
      .then((g) => {
        if (gen !== openGenRef.current || !openRef.current) return;
        const tl = buildOpenTimeline(g);
        if (tl) {
          tl.eventCallback('onComplete', () => {
            busyRef.current = false;
          });
          tl.play(0);
        } else {
          busyRef.current = false;
        }
      });
  }, [buildOpenTimeline]);

  const playClose = useCallback(() => {
    // 作废在途的打开动画（可能是等待 gsap 的那一轮）
    openGenRef.current += 1;
    openTlRef.current?.kill();
    openTlRef.current = null;
    // BUG-59：被 kill 的打开时间线不会触发 onComplete，这里必须自己解锁 busyRef。
    busyRef.current = false;

    const panel = panelRef.current;
    const layers = preLayerElsRef.current;
    if (!panel) return;

    const all = [...layers, panel];
    closeTweenRef.current?.kill();
    const g = gRef.current;
    if (!g) return; // 无动画库时面板本来就没被移出屏幕，无需回位
    const offscreen = position === 'left' ? -100 : 100;
    closeTweenRef.current = g.to(all, {
      xPercent: offscreen,
      duration: 0.32,
      ease: 'power3.in',
      overwrite: 'auto',
      onComplete: () => {
        resetPanelContent(g, panel);
        busyRef.current = false;
      }
    });
    // Star 按钮同步流回开关按钮下方并隐去。
    const star = ghStarRef.current;
    if (star) {
      g.to(star, { x: ghStarDelta(g), opacity: 0, duration: 0.3, ease: 'power2.in', overwrite: 'auto' });
    }
  }, [position]);

  const animateIcon = useCallback(opening => {
    const icon = iconRef.current;
    const g = gRef.current;
    if (!icon || !g) return;
    spinTweenRef.current?.kill();
    if (opening) {
      spinTweenRef.current = g.to(icon, { rotate: 225, duration: 0.8, ease: 'power4.out', overwrite: 'auto' });
    } else {
      spinTweenRef.current = g.to(icon, { rotate: 0, duration: 0.35, ease: 'power3.inOut', overwrite: 'auto' });
    }
  }, []);

  const animateColor = useCallback(
    opening => {
      const btn = toggleBtnRef.current;
      const g = gRef.current;
      if (!btn || !g) return;
      colorTweenRef.current?.kill();
      if (changeMenuColorOnOpen) {
        const targetColor = opening ? openMenuButtonColor : menuButtonColor;
        colorTweenRef.current = g.to(btn, {
          color: targetColor,
          delay: 0.18,
          duration: 0.3,
          ease: 'power2.out'
        });
      } else {
        g.set(btn, { color: menuButtonColor });
      }
    },
    [openMenuButtonColor, menuButtonColor, changeMenuColorOnOpen]
  );

  useEffect(() => {
    const g = gRef.current;
    if (toggleBtnRef.current && g) {
      if (changeMenuColorOnOpen) {
        const targetColor = openRef.current ? openMenuButtonColor : menuButtonColor;
        g.set(toggleBtnRef.current, { color: targetColor });
      } else {
        g.set(toggleBtnRef.current, { color: menuButtonColor });
      }
    }
  }, [changeMenuColorOnOpen, menuButtonColor, openMenuButtonColor, gInit]);

  const animateText = useCallback(opening => {
    const inner = textInnerRef.current;
    const g = gRef.current;
    if (!inner || !g) return;
    textCycleAnimRef.current?.kill();

    const openLabel = t('menu.toggleOpen');
    const closeLabel = t('menu.toggleClose');
    const currentLabel = opening ? openLabel : closeLabel;
    const targetLabel = opening ? closeLabel : openLabel;
    const cycles = 3;
    const seq = [currentLabel];
    let last = currentLabel;
    for (let i = 0; i < cycles; i++) {
      last = last === openLabel ? closeLabel : openLabel;
      seq.push(last);
    }
    seq.push(targetLabel);
    setTextLines(seq);

    g.set(inner, { yPercent: 0 });
    const lineCount = seq.length;
    const finalShift = ((lineCount - 1) / lineCount) * 100;
    textCycleAnimRef.current = g.to(inner, {
      yPercent: -finalShift,
      duration: 0.5 + lineCount * 0.07,
      ease: 'power4.out'
    });
  }, [t]);

  // 主菜单开/关共用的动画编排：面板滑动 + 图标/配色/文字三联动。
  const animateTo = useCallback(
    (target) => {
      if (target) {
        playOpen();
      } else {
        playClose();
      }
      animateIcon(target);
      animateColor(target);
      animateText(target);
    },
    [playOpen, playClose, animateIcon, animateColor, animateText]
  );

  const toggleMenu = useCallback(() => {
    const target = !openRef.current;
    openRef.current = target;
    setOpen(target);
    if (target) {
      onMenuOpen?.();
    } else {
      onMenuClose?.();
    }
    animateTo(target);
  }, [animateTo, onMenuOpen, onMenuClose]);
  const closeMenu = useCallback(() => {
    if (openRef.current) {
      openRef.current = false;
      setOpen(false);
      onMenuClose?.();
      animateTo(false);
    }
  }, [animateTo, onMenuClose]);

  // 账户动作（登录/退出）触发后关闭主菜单。
  const handleAccountAction = (action) => {
    action?.();
    closeMenu();
  };

  useClickOutside(closeOnClickAway && open, closeMenu, panelRef, toggleBtnRef, ghStarRef);

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (!openRef.current) toggleMenu();
      },
      close: closeMenu,
      toggle: toggleMenu,
    }),
    [toggleMenu, closeMenu]
  );

  return (
    <div
      className={(className ? className + ' ' : '') + 'staggered-menu-wrapper' + (isFixed ? ' fixed-wrapper' : '')}
      style={accentColor ? { ['--sm-accent']: accentColor } : undefined}
      data-position={position}
      data-open={open || undefined}
    >
      <div className="sm-backdrop rb-frost-backdrop" aria-hidden="true" onClick={closeMenu} />
      <div ref={preLayersRef} className="sm-prelayers" aria-hidden="true">
        {prelayerColors(colors).map((c, i) => (
          <div key={i} className="sm-prelayer" style={{ background: c }} />
        ))}
      </div>
      {/* GitHub Star 按钮：锚在面板条目左缘的延长位（top 与开关持平），不随面板滑动。
          开合由下方时间线驱动——打开时从开关按钮下方「流出」，关闭时流回。 */}
      {!hideToggleButton && <GithubStarButton ref={ghStarRef} active={open} />}
      <header className="staggered-menu-header" aria-label="Main navigation header">
        {!hideToggleButton && (
          <button
            ref={toggleBtnRef}
            className="sm-toggle"
            aria-label={open ? t('menu.closeAria') : t('menu.openAria')}
            aria-expanded={open}
            aria-controls="staggered-menu-panel"
            onClick={toggleMenu}
            onPointerEnter={ensureGsap}
            onPointerDown={ensureGsap}
            onFocus={ensureGsap}
            type="button"
          >
            <span className="sm-toggle-textWrap" aria-hidden="true">
              <span ref={textInnerRef} className="sm-toggle-textInner">
                {textLines.map((l, i) => (
                  <span className="sm-toggle-line" key={i}>
                    {l}
                  </span>
                ))}
              </span>
            </span>
            <span ref={iconRef} className="sm-icon" aria-hidden="true">
              <span ref={plusHRef} className="sm-icon-line" />
              <span ref={plusVRef} className="sm-icon-line sm-icon-line-v" />
            </span>
          </button>
        )}
      </header>

      <aside
        id="staggered-menu-panel"
        ref={panelRef}
        className="staggered-menu-panel"
        aria-hidden={!open}
        // 关闭态的面板仍然常驻渲染（只是 opacity:0 + 平移出屏），子项因此还在 Tab 顺序里：
        // 键盘用户会聚焦到完全看不见的「资料库 / 登录」并回车触发。关闭时把整块设为 inert，
        // 使可聚焦性与 aria-hidden 一致。（React 19 起 inert 是布尔属性，字符串写法失效）
        inert={!open}
      >
        <div className="sm-panel-inner">
          <ul className="sm-panel-list" role="list" data-numbering={displayItemNumbering || undefined}>
            {items && items.length ? (
              items.map((it, idx) => (
                <li className="sm-panel-itemWrap" key={it.label + idx}>
                  {it.action ? (
                    <button className="sm-panel-item" aria-label={it.ariaLabel} data-index={idx + 1} onClick={() => { it.action(); closeMenu(); }}>
                      <span className="sm-panel-itemLabel">{it.label}</span>
                    </button>
                  ) : it.external ? (
                    <a className="sm-panel-item" href={it.link} aria-label={it.ariaLabel} data-index={idx + 1} target="_blank" rel="noopener noreferrer">
                      <span className="sm-panel-itemLabel">{it.label}</span>
                    </a>
                  ) : (
                    <Link className="sm-panel-item" to={it.link} aria-label={it.ariaLabel} data-index={idx + 1} onClick={closeMenu}>
                      <span className="sm-panel-itemLabel">{it.label}</span>
                    </Link>
                  )}
                </li>
              ))
            ) : (
              <li className="sm-panel-itemWrap" aria-hidden="true">
                <span className="sm-panel-item">
                  <span className="sm-panel-itemLabel">{t('menu.noItems')}</span>
                </span>
              </li>
            )}
          </ul>
          <div className="sm-panel-bottom">
            {displaySocials && socialItems && socialItems.length > 0 && (
              <div className="sm-socials" aria-label={t('menu.officialChannels')}>
                <h3 className="sm-socials-title">{t('menu.officialChannels')}</h3>
                <ul className="sm-socials-list" role="list">
                  {socialItems.map((s, i) => (
                    <li key={s.label + i} className="sm-socials-item">
                      <a href={s.link} target="_blank" rel="noopener noreferrer" className="sm-socials-link">
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {account && (
              <div className="sm-account-card" aria-label={t('menu.currentAccount')}>
                {account.guest ? (
                  <button
                    type="button"
                    className="sm-account-go"
                    aria-label={t('menu.login')}
                    title={t('menu.login')}
                    onClick={() => handleAccountAction(account.onLogin)}
                  >
                    <span className="sm-account-avatar sm-account-avatar--guest" aria-hidden="true">
                      <CircleUserRound className="h-5 w-5" strokeWidth={1.6} />
                    </span>
                    <span className="sm-account-meta">
                      <span className="sm-account-name">{account.name}</span>
                      {account.subtitle && (
                        <span className="sm-account-sub">{account.subtitle}</span>
                      )}
                    </span>
                  </button>
                ) : (
                  <>
                    <span className="sm-account-avatar" aria-hidden="true">
                      {account.avatarText}
                    </span>
                    <span className="sm-account-meta">
                      <span className="sm-account-name">{account.name}</span>
                      {account.subtitle && (
                        <span className="sm-account-sub">{account.subtitle}</span>
                      )}
                    </span>
                  </>
                )}
                <span className="sm-account-actions">
                  {/* 设置：打开全局设置弹窗 */}
                  <button
                    type="button"
                    className="sm-account-action"
                    aria-label={t('menu.settings')}
                    title={t('menu.settings')}
                    onClick={() => {
                      onOpenSettings?.();
                      closeMenu();
                    }}
                  >
                    <Settings size={18} strokeWidth={1.6} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={`sm-account-action ${account.guest ? 'sm-account-action--login' : 'sm-account-action--logout'}`}
                    aria-label={account.guest ? t('menu.login') : t('menu.logout')}
                    title={account.guest ? t('menu.login') : t('menu.logout')}
                    onClick={() => handleAccountAction(account.guest ? account.onLogin : account.onLogout)}
                  >
                    {account.guest ? (
                      <LogIn size={18} strokeWidth={1.6} aria-hidden="true" />
                    ) : (
                      <LogOut size={18} strokeWidth={1.6} aria-hidden="true" />
                    )}
                  </button>
                </span>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
});

export default StaggeredMenu;
