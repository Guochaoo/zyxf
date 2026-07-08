import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Route, Routes, Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import BrowsePage from './pages/BrowsePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AboutPage from './pages/AboutPage.jsx';
import StaggeredMenu from './components/StaggeredMenu.jsx';
import Grainient from './components/Grainient.jsx';
import SearchBar from './components/SearchBar.jsx';

export default function App() {
  const { user, logout, ready } = useAuth();
  const location = useLocation();
  const desktopNavRef = useRef(null);
  const desktopNavItemRefs = useRef({});
  const [desktopNavIndicator, setDesktopNavIndicator] = useState({ left: 0, width: 0, ready: false });

  const menuItems = [
    { label: '资料库', ariaLabel: '浏览资料库', link: '/' },
    { label: '统计', ariaLabel: '查看统计仪表盘', link: '/dashboard' },
    { label: '关于我们', ariaLabel: '了解仲英书院学业辅导中心', link: '/about' },
    ...(user
      ? [{ label: '退出登录', ariaLabel: '退出登录', action: logout }]
      : [{ label: '管理员登录', ariaLabel: '管理员登录', link: '/login' }]),
  ];

  const isActiveMenuItem = (item) => {
    if (!item.link) return false;
    if (item.link === '/') {
      return location.pathname === '/' || location.pathname.startsWith('/folder/');
    }
    return location.pathname === item.link;
  };

  const activeDesktopMenuItem = menuItems.find(isActiveMenuItem);

  // ---- Document title ----
  useEffect(() => {
    document.title = '仲英学辅';
  }, []);

  useLayoutEffect(() => {
    if (!ready) {
      setDesktopNavIndicator((prev) => ({ ...prev, ready: false }));
      return undefined;
    }

    const activeLink = activeDesktopMenuItem?.link;
    const activeElement = activeLink ? desktopNavItemRefs.current[activeLink] : null;
    const nav = desktopNavRef.current;
    if (!activeElement || !nav) {
      setDesktopNavIndicator((prev) => ({ ...prev, ready: false }));
      return undefined;
    }

    const updateIndicator = () => {
      setDesktopNavIndicator({
        left: activeElement.offsetLeft,
        width: activeElement.offsetWidth,
        ready: true,
      });
    };

    updateIndicator();
    const resizeObserver = new ResizeObserver(updateIndicator);
    resizeObserver.observe(nav);
    resizeObserver.observe(activeElement);

    return () => resizeObserver.disconnect();
  }, [activeDesktopMenuItem?.link, ready, user]);

  if (!ready) {
    return <div className="h-full flex items-center justify-center text-slate-400">加载中...</div>;
  }

  return (
    <div className="reactbits-grainient-theme min-h-full flex flex-col relative bg-white">
      <div className="fixed inset-0 z-0 bg-white">
        <Grainient
          color1="#c2b6b2"
          color2="#276DA9"
          color3="#184872"
          timeSpeed={0.25}
          colorBalance={0.7}
          warpStrength={1.0}
          warpFrequency={5.0}
          warpSpeed={2.0}
          warpAmplitude={50.0}
          blendAngle={0.0}
          blendSoftness={0.23}
          rotationAmount={500.0}
          noiseScale={2.0}
          grainAmount={0.1}
          grainScale={2.0}
          grainAnimated={false}
          contrast={1.5}
          gamma={1.0}
          saturation={1.0}
          centerX={0.0}
          centerY={0.0}
          zoom={0.9}
        />
      </div>

      <header className="relative z-50 pt-5">
        <div className="rb-topbar mx-auto flex h-12 items-center justify-center px-[14px] sm:justify-between sm:pr-2">
          <Link to="/" className="flex items-center justify-center sm:justify-start gap-2 text-white hover:text-brand-400 shrink-0">
            <img
              src="/brand-logo-transparent.png"
              alt=""
              aria-hidden="true"
              className="h-7 w-7 object-contain"
            />
            <span className="rb-brand-title whitespace-nowrap">仲英学辅资料库</span>
          </Link>
          <div className="rb-topbar-search">
            <SearchBar />
          </div>
          <nav ref={desktopNavRef} className="rb-desktop-nav" aria-label="桌面导航">
            <span
              className="rb-desktop-nav-indicator"
              style={{
                width: desktopNavIndicator.width,
                transform: `translateX(${desktopNavIndicator.left}px)`,
                opacity: desktopNavIndicator.ready ? 1 : 0,
              }}
            />
            {menuItems.map((item) => {
              if (item.action) {
                return (
                  <button
                    key={item.label}
                    type="button"
                    className="rb-desktop-nav-link rb-desktop-nav-action"
                    aria-label={item.ariaLabel}
                    onClick={item.action}
                  >
                    {item.label}
                  </button>
                );
              }

              const active = isActiveMenuItem(item);
              return (
                <Link
                  ref={(node) => {
                    if (node) desktopNavItemRefs.current[item.link] = node;
                  }}
                  key={item.label}
                  to={item.link}
                  className={`rb-desktop-nav-link ${active ? 'is-active' : ''}`}
                  aria-label={item.ariaLabel}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="mx-auto mt-3 flex w-[92%] justify-center md:hidden">
          <SearchBar />
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-4 py-4 sm:py-6 relative z-10">
        <Routes>
          <Route path="/" element={<BrowsePage />} />
          <Route path="/folder/:id" element={<BrowsePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <StaggeredMenu
        className="mobile-staggered-menu"
        position="right"
        items={menuItems}
        socialItems={[
          { label: 'Bilibili', link: 'https://space.bilibili.com/549612395' },
          { label: 'Email', link: 'mailto:xjtuzyxf@163.com' },
          { label: 'Wechat', link: 'https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=MzU4NTQ4NTg0Mg==&scene=110#wechat_redirect' },
        ]}
        displaySocials
        displayItemNumbering={false}
        menuButtonColor="rgba(255, 255, 255, 0.4)"
        openMenuButtonColor="#2b2118"
        changeMenuColorOnOpen
        accentColor="#c96442"
        isFixed
      />

      <footer className="text-center text-xs text-slate-500 py-4 relative z-10">
        仲英书院学业辅导中心 · 陕ICP备2026017448号
      </footer>
    </div>
  );
}
