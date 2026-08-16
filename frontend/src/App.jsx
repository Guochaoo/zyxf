import { useEffect, useState } from 'react';
import { Route, Routes, Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import BrowsePage from './pages/BrowsePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AboutPage from './pages/AboutPage.jsx';
import StaggeredMenu from './components/StaggeredMenu.jsx';
import SearchBar from './components/SearchBar.jsx';
import FolderTree from './components/FolderTree.jsx';
import KnowledgeGraph from './components/KnowledgeGraph.jsx';
import ChatComposer from './components/ChatComposer.jsx';
import useMediaQuery from './hooks/useMediaQuery.js';

export default function App() {
  const { user, logout, ready } = useAuth();
  const location = useLocation();
  const isLg = useMediaQuery('(min-width: 1024px)');
  // Hide the floating menu button while the knowledge-graph dialog is open.
  const [graphFull, setGraphFull] = useState(false);

  // Docs layout: brand + search + folder tree live in the left rail, which
  // appears on browse routes only. Other pages are standalone.
  const isBrowse = location.pathname === '/' || location.pathname.startsWith('/folder/');
  const folderId = Number(location.pathname.match(/^\/folder\/(\d+)/)?.[1]) || 0;

  const menuItems = [
    { label: '资料库', ariaLabel: '浏览资料库', link: '/' },
    { label: '统计', ariaLabel: '查看统计仪表盘', link: '/dashboard' },
    { label: '关于我们', ariaLabel: '了解仲英书院学业辅导中心', link: '/about' },
    ...(user
      ? [{ label: '退出登录', ariaLabel: '退出登录', action: logout }]
      : [{ label: '管理员登录', ariaLabel: '管理员登录', link: '/login' }]),
  ];

  const brand = (
    <Link to="/" className="flex items-center gap-2 shrink-0 hover:text-brand-500">
      <img
        src="/favicon.png"
        alt=""
        aria-hidden="true"
        className="w-7 h-7 rounded-full object-cover"
      />
      <span className="rb-brand-title whitespace-nowrap">仲英学辅资料库</span>
    </Link>
  );

  // Middle-column layout: browse routes flank the fixed rails; dashboard &
  // about fill the viewport width; everything else is a centered column.
  let mainLayout;
  if (isBrowse) {
    mainLayout = 'w-full lg:pl-[calc(250px+1rem)] lg:pr-[calc(300px+1rem)]';
  } else if (location.pathname === '/dashboard' || location.pathname === '/about') {
    mainLayout = 'mx-auto w-full';
  } else {
    mainLayout = 'mx-auto w-full max-w-7xl';
  }

  // ---- Document title ----
  useEffect(() => {
    document.title = '仲英学辅';
  }, []);

  if (!ready) {
    return <div className="h-full flex items-center justify-center text-slate-400">加载中...</div>;
  }

  return (
    <div className="app-theme min-h-full flex flex-col relative bg-page">
      {/* Mobile-only brand row on browse pages (no topbar on any layout) */}
      {isBrowse && (
        <div className="flex h-14 items-center px-4 lg:hidden">
          {brand}
        </div>
      )}
      {isBrowse && (
        <div className="mx-auto mt-3 flex w-[92%] justify-center lg:hidden">
          <SearchBar />
        </div>
      )}

      {/* Docs layout: three columns on wide screens.
          Left rail = folder tree, right column = knowledge graph. Both are
          position:fixed to the viewport edges so they never move while the
          page scrolls (sticky rails drift at scroll extremes). */}
      {isBrowse && (
        <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-10 lg:flex lg:w-[250px] lg:flex-col lg:gap-4 lg:overflow-hidden lg:border-r lg:border-line lg:bg-[#ECECEE] lg:px-4 lg:pt-[11px]">
          {/* 34px-high row keeps the brand aligned with the middle toolbar (41px center). */}
          <div className="flex h-[34px] items-center">
            {brand}
          </div>
          <SearchBar />
          <FolderTree currentId={folderId} />
          <footer className="shrink-0 -mt-2 pb-2 text-center text-[11px] leading-relaxed text-slate-400">
            陕ICP备2026017448号
          </footer>
        </div>
      )}
      <main
        className={`min-w-0 overflow-x-hidden px-3 py-4 sm:px-4 sm:pt-[10.5px] sm:pb-6 ${mainLayout}`}
      >
        <Routes>
          <Route path="/" element={<BrowsePage />} />
          <Route path="/folder/:id" element={<BrowsePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {/* Right column — the original StaggeredMenu toggle button stays
          fixed at the top-right; the knowledge graph sits below it.
          pt matches the file list card top in the middle column:
          main sm:py-6 (24px) + toolbar (35px) + space-y-4 gap (16px),
          so the graph's top border lines up with the list card. */}
      {isBrowse && isLg && (
        <div className="fixed inset-y-0 right-0 z-10 hidden flex-col gap-4 overflow-hidden pr-2 pt-[61.5px] lg:flex lg:w-[300px]">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
            <div className="flex flex-1 flex-col gap-[15px]">
              <KnowledgeGraph currentId={folderId} onFullChange={setGraphFull} />
              <ChatComposer />
            </div>
          </div>
        </div>
      )}

      {!graphFull && (
        <StaggeredMenu
          position="right"
          items={menuItems}
          socialItems={[
            { label: 'Bilibili', link: 'https://space.bilibili.com/549612395' },
            { label: 'Email', link: 'mailto:xjtuzyxf@163.com' },
            { label: 'Wechat', link: 'https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=MzU4NTQ4NTg0Mg==&scene=110#wechat_redirect' },
          ]}
          displaySocials
          displayItemNumbering={false}
          menuButtonColor="#171717"
          openMenuButtonColor="#171717"
          changeMenuColorOnOpen
          accentColor="#5227FF"
          colors={['#B497CF', '#5227FF']}
          isFixed
        />
      )}
    </div>
  );
}
