import i18n from './i18n/index.js';

/**
 * 启动失败的兜底界面（白屏可见化）。
 *
 * 模块求值期异常或首次渲染异常会让 #root 保持空白，而原因只出现在控制台里——排查时极易被
 * 误判成「后端挂了」「HMR 坏了」。这里把致命错误画进页面，让任何一种白屏都自带原因。
 *
 * 面向用户的只有「友好标题 + 一句怎么办 + 刷新按钮」；原始错误与堆栈**只在开发环境**展开，
 * 生产环境进控制台（`console.error`），不把 ReferenceError 这类内部细节摆到学生面前。
 *
 * 用原生 DOM + 内联样式：白屏的成因可能正是样式表或 React 没加载成功，此时不能指望它们。
 * 只在「什么都没渲染出来」时接管：运行期偶发错误不该把已经可用的界面清空。
 */
export function showBootError(err, { showDetail = true } = {}) {
  // 排查信息永远留一份在控制台：生产环境用户仍可从 devtools 复制出来反馈
  console.error('[boot]', err);

  const root = document.getElementById('root');
  if (!root || root.childElementCount !== 0) return;

  root.innerHTML = '';
  const card = document.createElement('div');
  card.setAttribute('data-boot-error', '');
  card.style.cssText =
    'max-width:420px;margin:48px auto;padding:24px;border-radius:14px;' +
    'background:#ffffff;color:#171717;font-size:14px;line-height:1.6;' +
    'box-shadow:rgba(0,0,0,0.08) 0px 0px 0px 1px,rgba(0,0,0,0.04) 0px 2px 2px,' +
    'rgba(0,0,0,0.04) 0px 8px 8px -8px';

  const title = document.createElement('p');
  title.style.cssText = 'margin:0 0 6px;font-size:17px;font-weight:600';
  title.textContent = i18n.t('common.bootErrorTitle');

  const hint = document.createElement('p');
  hint.style.cssText = 'margin:0 0 16px;color:rgba(23,23,23,0.65)';
  hint.textContent = i18n.t('common.bootErrorHint');

  // 主按钮沿用站点 CTA 的样子（墨黑底 + 14px 圆角），但写成内联样式，避免依赖样式表
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.style.cssText =
    'display:inline-flex;align-items:center;justify-content:center;border:0;cursor:pointer;' +
    'background:#171717;color:#f8f8f8;border-radius:14px;padding:8px 16px;' +
    'font:inherit;font-size:14px;font-weight:500';
  reload.textContent = i18n.t('common.bootErrorReload');
  reload.addEventListener('click', () => window.location.reload());

  card.append(title, hint, reload);

  // 堆栈只画进开发环境的页面：`import.meta.env.DEV` 在生产构建里被静态替换成 false，
  // 这个分支连同里面的字符串会被整体摇掉（测试可用 { showDetail: false } 模拟生产）。
  if (import.meta.env.DEV && showDetail) {
    const label = document.createElement('p');
    label.style.cssText = 'margin:20px 0 6px;font-size:12px;color:rgba(23,23,23,0.45)';
    label.textContent = i18n.t('common.bootError');

    const detail = document.createElement('pre');
    detail.setAttribute('data-boot-error-detail', '');
    detail.style.cssText =
      'margin:0;padding:12px;border-radius:10px;background:#f7f8f9;color:#b91c1c;' +
      'font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-word;' +
      'max-height:40vh;overflow:auto';
    detail.textContent = String((err && (err.stack || err.message)) || err);

    card.append(label, detail);
  }

  root.appendChild(card);
}
