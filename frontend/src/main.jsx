import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import i18n, { syncHtmlLang } from './i18n/index.js';
import './index.css';

// 应用启动时同步 <html lang>（如英文则 en，否则 zh-CN）。
syncHtmlLang(i18n.language);

/**
 * 启动失败要能被看见。模块求值期异常或首次渲染异常会让 #root 保持空白，而原因只出现在
 * 控制台里——排查时极易被误判成「后端挂了」「HMR 坏了」。这里把致命错误直接写进页面，
 * 让任何一种白屏都自带原因。
 * 只在「什么都没渲染出来」时接管：运行期偶发错误不该把已经可用的界面清空。
 */
function showBootError(err) {
  const root = document.getElementById('root');
  if (!root || root.childElementCount !== 0) return;
  const text = (err && (err.stack || err.message)) || String(err);
  root.innerHTML = '';
  const box = document.createElement('pre');
  box.setAttribute('data-boot-error', '');
  box.style.cssText =
    'margin:24px;padding:16px;border:1px solid #fecaca;border-radius:10px;' +
    'background:#fef2f2;color:#b91c1c;font-size:12px;line-height:1.6;' +
    'white-space:pre-wrap;word-break:break-word';
  box.textContent = `${i18n.t('common.bootError')}\n\n${text}`;
  root.appendChild(box);
}

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
