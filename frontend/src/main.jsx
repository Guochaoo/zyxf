import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import i18n, { syncHtmlLang } from './i18n/index.js';
import './index.css';

// 应用启动时同步 <html lang>（如英文则 en，否则 zh-CN）。
syncHtmlLang(i18n.language);

ReactDOM.createRoot(document.getElementById('root')).render(
  <I18nextProvider i18n={i18n}>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </I18nextProvider>
);
