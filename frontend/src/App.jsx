import { Route, Routes, Link, Navigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import BrowsePage from './pages/BrowsePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import StaggeredMenu from './components/StaggeredMenu.jsx';
import Beams from './components/Beams.jsx';
import SearchBar from './components/SearchBar.jsx';
import { FolderOpen } from 'lucide-react';

export default function App() {
  const { user, logout, ready } = useAuth();
  if (!ready) {
    return <div className="h-full flex items-center justify-center text-slate-400">加载中...</div>;
  }

  const menuItems = [
    { label: '资料库', ariaLabel: '浏览资料库', link: '/' },
    { label: '统计', ariaLabel: '查看统计仪表盘', link: '/dashboard' },
    ...(user
      ? [{ label: `退出 (${user.username})`, ariaLabel: '退出登录', action: logout }]
      : [{ label: '管理员登录', ariaLabel: '管理员登录', link: '/login' }]),
  ];

  return (
    <div className="min-h-full flex flex-col relative">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <Beams
          beamWidth={3}
          beamHeight={30}
          beamNumber={20}
          lightColor="#ffffff"
          speed={2}
          noiseIntensity={1.75}
          scale={0.2}
          rotation={30}
        />
      </div>

      <header className="bg-white/10 backdrop-blur-md border-b border-white/10 shadow-sm relative z-50">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
          <Link to="/" className="flex items-center justify-center sm:justify-start gap-2 text-white hover:text-brand-400 shrink-0">
            <FolderOpen className="w-6 h-6 text-brand-400" />
            <span className="text-base sm:text-lg font-semibold whitespace-nowrap">仲英学辅资料库</span>
          </Link>
          <SearchBar />
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-4 py-4 sm:py-6 relative z-10">
        <Routes>
          <Route path="/" element={<BrowsePage />} />
          <Route path="/folder/:id" element={<BrowsePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <StaggeredMenu
        position="right"
        items={menuItems}
        displaySocials={false}
        displayItemNumbering={false}
        menuButtonColor="#e2e8f0"
        openMenuButtonColor="#000000"
        changeMenuColorOnOpen
        accentColor="#2563eb"
        isFixed
      />

      <footer className="text-center text-xs text-slate-500 py-4 relative z-10">
        仲英书院学业辅导中心 · 资料库
      </footer>
    </div>
  );
}
