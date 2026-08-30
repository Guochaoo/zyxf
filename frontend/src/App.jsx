import { useEffect, useMemo, useState } from 'react';
import { Route, Routes, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from './auth.jsx';
import BrowsePage from './pages/BrowsePage.jsx';
import AuthPage from './pages/AuthPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AboutPage from './pages/AboutPage.jsx';
import StaggeredMenu from './components/StaggeredMenu.jsx';
import SearchBar from './components/SearchBar.jsx';
import FolderTree from './components/FolderTree.jsx';
import KnowledgeGraph from './components/KnowledgeGraph.jsx';
import ChatComposer from './components/ChatComposer.jsx';
import useMediaQuery from './hooks/useMediaQuery.js';
import NoticeModal from './components/NoticeModal.jsx';

// Static menu items for the floating StaggeredMenu — hoisted out of the
// component so they are allocated once per module load, not per render.
const menuItems = [
  { label: '资料库', ariaLabel: '浏览资料库', link: '/' },
  { label: '统计面板', ariaLabel: '查看统计仪表盘', link: '/dashboard' },
  { label: '关于我们', ariaLabel: '了解仲英书院学业辅导中心', link: '/about' },
];

// Social links shown in the menu footer, also static.
const socialItems = [
  { label: 'Bilibili', link: 'https://space.bilibili.com/549612395' },
  { label: 'Email', link: 'mailto:xjtuzyxf@163.com' },
  { label: 'Wechat', link: 'https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=MzU4NTQ4NTg0Mg==&scene=110#wechat_redirect' },
];

export default function App() {
  const { user, logout, ready } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isLg = useMediaQuery('(min-width: 1024px)');
  // Hide the floating menu button while the knowledge-graph dialog is open.
  const [graphFull, setGraphFull] = useState(false);
  // Collapsible left rail (docs layout) on wide screens. Defaults open.
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // 侧边栏开合的缓动曲线与时长（与 ChatComposer/KnowledgeGraph 的收缩动画一致）。
  const SIDEBAR_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const SIDEBAR_MS = 320;

  // Docs layout: brand + search + folder tree live in the left rail, which
  // appears on browse routes only. Other pages are standalone.
  const isBrowse = location.pathname === '/' || location.pathname.startsWith('/folder/');
  const isDashboard = location.pathname === '/dashboard';
  const isAbout = location.pathname === '/about';
  const folderId = Number(location.pathname.match(/^\/folder\/(\d+)/)?.[1]) || 0;

  // Bottom account card on the menu panel. Logged-in shows username + role;
  // guests show a neutral "未登录" state. Login/logout actions live in the
  // card's ChevronsUpDown popup menu, not on the card itself.
  const account = useMemo(
    () =>
      user
        ? {
            name: user.username || '用户',
            subtitle: user.role === 'admin' ? '管理员' : '普通用户',
            avatarText: (user.username || '友').slice(0, 1).toUpperCase(),
            onLogout: logout,
          }
        : { name: '未登录', subtitle: '游客', guest: true, avatarText: '', onLogin: () => navigate('/login') },
    [user, logout, navigate]
  );

  const brand = useMemo(
    () => (
      <Link to="/" className="flex items-center gap-2 shrink-0 hover:text-brand-500">
        <img
          src="/favicon.png"
          alt=""
          aria-hidden="true"
          className="w-7 h-7 rounded-full object-cover"
        />
        <span className="rb-brand-title whitespace-nowrap">仲英学辅资料库</span>
      </Link>
    ),
    []
  );

  // 资料库标题行右侧的侧边栏开关按钮。展开时常驻侧边栏内（显示 PanelLeftClose，
  // 点击收起）；收起时由左上角浮动按钮接管（显示 PanelLeftOpen，点击展开）。
  // 图标刻意做细（1.7 线宽、18px），颜色偏浅，避免显得粗重。
  const sidebarToggle = (className) => (
    <button
      type="button"
      onClick={() => setSidebarOpen((v) => !v)}
      aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
      aria-pressed={sidebarOpen}
      title={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
      className={`flex items-center justify-center rounded-[7px] text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 ${className}`}
    >
      <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.7} />
    </button>
  );

  // Middle-column layout: browse routes flank the fixed rails; dashboard &
  // about fill the viewport width; everything else is a centered column.
  let mainLayout;
  if (isBrowse) {
    // Left rail padding collapses with a smooth transition when the sidebar
    // is toggled off, matching the rail's transform easing.
    mainLayout = `w-full ${
      sidebarOpen ? 'lg:pl-[calc(250px+1rem)]' : 'lg:pl-0'
    } lg:pr-[calc(300px+1rem)] lg:transition-[padding] lg:duration-[${SIDEBAR_MS}ms] lg:ease-[${SIDEBAR_EASE}]`;
  } else if (isDashboard || isAbout) {
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
          page scrolls (sticky rails drift at scroll extremes).
          开合用 transform:translateX 滑入/滑出（非线性缓动），而非瞬间显隐。 */}
      {isBrowse && (
        <div
          className={`hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-10 lg:flex lg:flex-col lg:gap-4 lg:overflow-hidden lg:bg-[#ECECEE] lg:px-4 lg:pt-[11px] lg:w-[250px] ${
            sidebarOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full'
          } transition-transform lg:duration-[${SIDEBAR_MS}ms] lg:ease-[${SIDEBAR_EASE}] will-change-transform ${
            sidebarOpen ? 'lg:pointer-events-auto' : 'lg:pointer-events-none'
          }`}
        >
          {/* 34px-high row keeps the brand aligned with the middle toolbar (41px center). */}
          <div className="flex h-[34px] items-center justify-between gap-2">
            {brand}
            <span
              className={`transition-opacity duration-[${SIDEBAR_MS}ms] ease-[${SIDEBAR_EASE}] ${
                sidebarOpen ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {sidebarToggle('shrink-0 h-7 w-7')}
            </span>
          </div>
          <SearchBar />
          <FolderTree currentId={folderId} />
        </div>
      )}
      {/* 折叠后，左上角浮现一个固定的「展开侧边栏」按钮；展开时它淡出消失，
          避免与侧边栏内的收起按钮同时出现。 */}
      {isBrowse && (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="展开侧边栏"
          title="展开侧边栏"
          aria-hidden={sidebarOpen}
          tabIndex={sidebarOpen ? -1 : 0}
          className={`fixed left-[18px] top-[13px] z-20 hidden lg:flex h-7 w-7 items-center justify-center rounded-[7px] text-slate-400 transition-all duration-[${SIDEBAR_MS}ms] ease-[${SIDEBAR_EASE}] hover:bg-slate-100 hover:text-slate-700 ${
            sidebarOpen ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
          }`}
        >
          <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.7} />
        </button>
      )}
      <main
        className={`min-w-0 overflow-x-hidden ${
          // Dashboard uses a fixed pt-[11px] to match the browse page logo top offset (14px).
        isDashboard
          ? 'px-4 pt-[11px] pb-6'
          : 'px-3 pt-4 pb-2 sm:px-4 sm:pt-[10.5px] sm:pb-2'
        } ${mainLayout}`}
      >
        <Routes>
          <Route path="/" element={<BrowsePage />} />
          <Route path="/folder/:id" element={<BrowsePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/about" element={<AboutPage />} />
          {/* /login 与 /register 渲染同一 AuthPage 实例：切换不重挂载，仅表单区过渡 */}
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {/* Right column — the original StaggeredMenu toggle button stays
          fixed at the top-right; the knowledge graph sits below it.
          pt matches the file list card top in the middle column:
          main sm:pt-[10.5px] + toolbar (35px) + space-y-4 gap (16px),
          so the graph's top border lines up with the list card. */}
      {isBrowse && isLg && (
        <div className="fixed inset-y-0 right-0 z-10 hidden flex-col gap-4 overflow-hidden pr-2 pt-[61.5px] lg:flex lg:w-[300px]">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
            <div className="flex min-h-0 flex-1 flex-col gap-[15px]">
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
          socialItems={socialItems}
          account={account}
          displaySocials
          displayItemNumbering={false}
          menuButtonColor="#ffffff"
          openMenuButtonColor="#ffffff"
          changeMenuColorOnOpen
          accentColor="#5227FF"
          colors={['#B497CF', '#5227FF']}
          isFixed
        />
      )}

      {/* 首次访问的注意清单弹窗：同意后写入 localStorage 才放行站点操作 */}
      <NoticeModal />
    </div>
  );
}
