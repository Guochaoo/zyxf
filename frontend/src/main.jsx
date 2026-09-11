import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import i18n, { syncHtmlLang } from './i18n/index.js';
import { showBootError } from './bootError.js';
import './index.css';

// 应用启动时同步 <html lang>（如英文则 en，否则 zh-CN）。
syncHtmlLang(i18n.language);

// 启动失败要能被看见：白屏兜底界面（友好提示 + 刷新；堆栈只在开发环境展开）。见 bootError.js。
window.addEventListener('error', (e) => showBootError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showBootError(e.reason));

try {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <I18nextProvider i18n={i18n}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </I18nextProvider>
  );
} catch (err) {
  showBootError(err);
  throw err;
}
