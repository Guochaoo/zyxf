import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Link } from 'react-router-dom';
import { CircleUserRound, ChevronsUpDown, LogIn, LogOut, Settings } from 'lucide-react';
import { EASE_COLLAPSE } from './ui.js';
import { useClickOutside } from '../hooks/useClickOutside.js';
import './StaggeredMenu.css';

// Query the animated panel content and reset it to its pre-open state
// (labels pushed down/rotated, numbers and socials hidden). Returns the
// elements so the open timeline can tween them back in; also used after the
// close tween finishes to leave the panel ready for the next open.
function resetPanelContent(panel) {
  const itemEls = Array.from(panel.querySelectorAll('.sm-panel-itemLabel'));
  if (itemEls.length) {
    gsap.set(itemEls, { yPercent: 140, rotate: 10 });
  }
  const numberEls = Array.from(panel.querySelectorAll('.sm-panel-list[data-numbering] .sm-panel-item'));
  if (numberEls.length) {
    gsap.set(numberEls, { '--sm-num-opacity': 0 });
  }
  const socialTitle = panel.querySelector('.sm-socials-title');
  if (socialTitle) gsap.set(socialTitle, { opacity: 0 });
  const socialLinks = Array.from(panel.querySelectorAll('.sm-socials-link'));
  if (socialLinks.length) gsap.set(socialLinks, { y: 25, opacity: 0 });
  const accountCard = panel.querySelector('.sm-account-card');
  if (accountCard) gsap.set(accountCard, { y: 25, opacity: 0 });
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
    onMenuClose
  },
  ref
) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const panelRef = useRef(null);
  const preLayersRef = useRef(null);
  const preLayerElsRef = useRef([]);
  const plusHRef = useRef(null);
  const plusVRef = useRef(null);
  const iconRef = useRef(null);
  const textInnerRef = useRef(null);
  const [textLines, setTextLines] = useState(['菜单', '关闭']);
  // 账号卡片的用户菜单（登录/退出/设置）展开状态；点击卡片外空白处收起。
  const [acctOpen, setAcctOpen] = useState(false);
  const acctRef = useRef(null);

  const openTlRef = useRef(null);
  const closeTweenRef = useRef(null);
  const spinTweenRef = useRef(null);
  const textCycleAnimRef = useRef(null);
  const colorTweenRef = useRef(null);
  const toggleBtnRef = useRef(null);
  const busyRef = useRef(false);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
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
      gsap.set([panel, ...preLayers], { xPercent: offscreen, opacity: 1 });
      if (preContainer) {
        gsap.set(preContainer, { xPercent: 0, opacity: 1 });
      }
      gsap.set(plusH, { transformOrigin: '50% 50%', rotate: 0 });
      gsap.set(plusV, { transformOrigin: '50% 50%', rotate: 90 });
      gsap.set(icon, { rotate: 0, transformOrigin: '50% 50%' });
      gsap.set(textInner, { yPercent: 0 });
      if (toggleBtnRef.current) gsap.set(toggleBtnRef.current, { color: menuButtonColor });
    });
    return () => ctx.revert();
  }, [menuButtonColor, position]);

  const buildOpenTimeline = useCallback(() => {
    const panel = panelRef.current;
    const layers = preLayerElsRef.current;
    if (!panel) return null;

    openTlRef.current?.kill();
    if (closeTweenRef.current) {
      closeTweenRef.current.kill();
      closeTweenRef.current = null;
    }

    const { itemEls, numberEls, socialTitle, socialLinks, accountCard } = resetPanelContent(panel);

    const offscreen = position === 'left' ? -100 : 100;
    const layerStates = layers.map(el => ({ el, start: offscreen }));
    const panelStart = offscreen;

    const tl = gsap.timeline({ paused: true });

    layerStates.forEach((ls, i) => {
      tl.fromTo(ls.el, { xPercent: ls.start }, { xPercent: 0, duration: 0.5, ease: 'power4.out' }, i * 0.07);
    });
    const lastTime = layerStates.length ? (layerStates.length - 1) * 0.07 : 0;
    const panelInsertTime = lastTime + (layerStates.length ? 0.08 : 0);
    const panelDuration = 0.65;
    tl.fromTo(
      panel,
      { xPercent: panelStart },
      { xPercent: 0, duration: panelDuration, ease: 'power4.out' },
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
            gsap.set(socialLinks, { clearProps: 'opacity' });
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
            gsap.set(accountCard, { clearProps: 'all' });
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
    const tl = buildOpenTimeline();
    if (tl) {
      tl.eventCallback('onComplete', () => {
        busyRef.current = false;
      });
      tl.play(0);
    } else {
      busyRef.current = false;
    }
  }, [buildOpenTimeline]);

  const playClose = useCallback(() => {
    openTlRef.current?.kill();
    openTlRef.current = null;

    const panel = panelRef.current;
    const layers = preLayerElsRef.current;
    if (!panel) return;

    const all = [...layers, panel];
    closeTweenRef.current?.kill();
    const offscreen = position === 'left' ? -100 : 100;
    closeTweenRef.current = gsap.to(all, {
      xPercent: offscreen,
      duration: 0.32,
      ease: 'power3.in',
      overwrite: 'auto',
      onComplete: () => {
        resetPanelContent(panel);
        busyRef.current = false;
      }
    });
  }, [position]);

  const animateIcon = useCallback(opening => {
    const icon = iconRef.current;
    if (!icon) return;
    spinTweenRef.current?.kill();
    if (opening) {
      spinTweenRef.current = gsap.to(icon, { rotate: 225, duration: 0.8, ease: 'power4.out', overwrite: 'auto' });
    } else {
      spinTweenRef.current = gsap.to(icon, { rotate: 0, duration: 0.35, ease: 'power3.inOut', overwrite: 'auto' });
    }
  }, []);

  const animateColor = useCallback(
    opening => {
      const btn = toggleBtnRef.current;
      if (!btn) return;
      colorTweenRef.current?.kill();
      if (changeMenuColorOnOpen) {
        const targetColor = opening ? openMenuButtonColor : menuButtonColor;
        colorTweenRef.current = gsap.to(btn, {
          color: targetColor,
          delay: 0.18,
          duration: 0.3,
          ease: 'power2.out'
        });
      } else {
        gsap.set(btn, { color: menuButtonColor });
      }
    },
    [openMenuButtonColor, menuButtonColor, changeMenuColorOnOpen]
  );

  useEffect(() => {
    if (toggleBtnRef.current) {
      if (changeMenuColorOnOpen) {
        const targetColor = openRef.current ? openMenuButtonColor : menuButtonColor;
        gsap.set(toggleBtnRef.current, { color: targetColor });
      } else {
        gsap.set(toggleBtnRef.current, { color: menuButtonColor });
      }
    }
  }, [changeMenuColorOnOpen, menuButtonColor, openMenuButtonColor]);

  const animateText = useCallback(opening => {
    const inner = textInnerRef.current;
    if (!inner) return;
    textCycleAnimRef.current?.kill();

    const currentLabel = opening ? '菜单' : '关闭';
    const targetLabel = opening ? '关闭' : '菜单';
    const cycles = 3;
    const seq = [currentLabel];
    let last = currentLabel;
    for (let i = 0; i < cycles; i++) {
      last = last === '菜单' ? '关闭' : '菜单';
      seq.push(last);
    }
    seq.push(targetLabel);
    setTextLines(seq);

    gsap.set(inner, { yPercent: 0 });
    const lineCount = seq.length;
    const finalShift = ((lineCount - 1) / lineCount) * 100;
    textCycleAnimRef.current = gsap.to(inner, {
      yPercent: -finalShift,
      duration: 0.5 + lineCount * 0.07,
      ease: 'power4.out'
    });
  }, []);

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

  // 账号菜单项点击的统一编排：先收起弹出层，再执行动作，最后关主菜单。
  const handleAccountAction = (action) => {
    setAcctOpen(false);
    action?.();
    closeMenu();
  };

  useClickOutside(acctOpen, () => setAcctOpen(false), acctRef);

  useClickOutside(closeOnClickAway && open, closeMenu, panelRef, toggleBtnRef);

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
      <header className="staggered-menu-header" aria-label="Main navigation header">
        {!hideToggleButton && (
          <button
            ref={toggleBtnRef}
            className="sm-toggle"
            aria-label={open ? '关闭菜单' : '打开菜单'}
            aria-expanded={open}
            aria-controls="staggered-menu-panel"
            onClick={toggleMenu}
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

      <aside id="staggered-menu-panel" ref={panelRef} className="staggered-menu-panel" aria-hidden={!open}>
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
                  <span className="sm-panel-itemLabel">No items</span>
                </span>
              </li>
            )}
          </ul>
          <div className="sm-panel-bottom">
            {displaySocials && socialItems && socialItems.length > 0 && (
              <div className="sm-socials" aria-label="Official Channels">
                <h3 className="sm-socials-title">Official Channels</h3>
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
              <div className="sm-account-card" aria-label="当前账户">
                <span
                  className={`sm-account-avatar ${account.guest ? 'sm-account-avatar--guest' : ''}`}
                  aria-hidden="true"
                >
                  {account.guest ? (
                    <CircleUserRound className="h-5 w-5" strokeWidth={1.6} />
                  ) : (
                    account.avatarText
                  )}
                </span>
                <span className="sm-account-meta">
                  <span className="sm-account-name">{account.name}</span>
                  {account.subtitle && (
                    <span className="sm-account-sub">{account.subtitle}</span>
                  )}
                </span>
                <span className="sm-account-menu" ref={acctRef}>
                  {acctOpen && (
                    <div className="sm-account-pop" role="menu" aria-label="账户操作">
                      <div className="sm-account-pop-list">
                        {account.guest ? (
                          <button
                            type="button"
                            role="menuitem"
                            className="sm-account-pop-item"
                            onClick={() => handleAccountAction(account.onLogin)}
                          >
                            <LogIn size={17} strokeWidth={1.8} aria-hidden="true" />
                            <span>登录</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            role="menuitem"
                            className="sm-account-pop-item sm-account-pop-item--danger"
                            onClick={() => handleAccountAction(account.onLogout)}
                          >
                            <LogOut size={17} strokeWidth={1.8} aria-hidden="true" />
                            <span>退出登录</span>
                          </button>
                        )}
                      </div>
                      <div className="sm-account-pop-sep" />
                      <div className="sm-account-pop-list">
                        {/* 预留：设置入口，后续接入设置面板 */}
                        <button
                          type="button"
                          role="menuitem"
                          className="sm-account-pop-item"
                          onClick={() => setAcctOpen(false)}
                        >
                          <Settings size={17} strokeWidth={1.8} aria-hidden="true" />
                          <span>设置</span>
                        </button>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    className="sm-account-gear"
                    aria-label={acctOpen ? '收起账户菜单' : '展开账户菜单'}
                    aria-expanded={acctOpen}
                    onClick={() => setAcctOpen((v) => !v)}
                  >
                    <ChevronsUpDown
                      size={18}
                      strokeWidth={1.6}
                      aria-hidden="true"
                      style={{
                        transform: acctOpen ? 'rotate(180deg)' : 'none',
                        transition: `transform 240ms ${EASE_COLLAPSE}`,
                      }}
                    />
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
