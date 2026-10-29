import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import initHeaderScroll from './headerScroll.js';
import dzhzHtml from './content.html?raw';
import './dzhz.css';

/* ============================================================
 * 岱宗盒子文档页外壳（/dzhz/legal、/dzhz/license 共用）
 *
 * 版式照 deepseek.com/harness/privacy/ 做：固定顶栏 + 60px 大标题 +
 * `.legal-document` 正文（960px、17px/1.9），页面底色 #F8F8F8（原站为纯白）。
 * 顶栏直接从 content.html 里取 /dzhz 首页的 `.ds-header-wrapper` 与移动端菜单，
 * 三个页面共用同一份 DOM，避免顶栏各自维护。
 *
 * 页脚：左侧「返回岱宗盒子」，右侧链接到另一份文档（协议页 ↔ 开源协议页）。
 * ============================================================ */

/* 顶栏的 DOM 只有一份，在 content.html 里；这里一次性取出注入。 */
function extractHeader(raw) {
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const desktop = doc.querySelector('.ds-header-wrapper');
  const mobileMenu = doc.querySelector('#harness-mobile-menu');
  return `${desktop?.outerHTML ?? ''}${mobileMenu?.outerHTML ?? ''}`;
}

const HEADER_HTML = typeof DOMParser === 'undefined' ? '' : extractHeader(dzhzHtml);

export default function DocPageShell({ title, titleId, otherDoc, children }) {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const rootRef = useRef(null);

  // 顶栏滚动收缩与下载下拉（与 /dzhz 同一套行为）。
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    return initHeaderScroll(root);
  }, []);

  // 内容由 React 渲染，整页加载时浏览器可能先按空文档滚一次；按 hash 再定位一次。
  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(hash.slice(1));
    if (target) target.scrollIntoView({ block: 'start' });
  }, [hash]);

  return (
    <div ref={rootRef} className="dzhz-page">
      <div data-theme="light" className="harness-site relative w-full min-h-screen bg-ds-page">
        {/* 构建期固定的复刻 HTML，不含任何用户输入。 */}
        <div dangerouslySetInnerHTML={{ __html: HEADER_HTML }} />

        <main id="main-content">
          <header className="legal-page-header ds-container pt-[152px] pb-[104px] md:pt-[184px] md:pb-[128px]">
            <h1
              id={titleId}
              className="max-w-[900px] scroll-mt-[112px] font-ds-display text-[38px] font-semibold leading-[1.12] tracking-[-0.03em] md:text-[60px]"
            >
              {title}
            </h1>
          </header>

          <div className="legal-page-body ds-container max-w-[960px] pb-ds-11">
            <article lang="zh-CN" className="legal-document">
              {children}
            </article>
          </div>
        </main>

        <footer className="ds-container pb-ds-6">
          <div className="flex flex-col gap-ds-3 py-ds-5 text-[13px] text-ds-description sm:flex-row sm:items-center sm:justify-between">
            <Link className="legal-back-link transition-colors hover:text-ds-primary" to="/dzhz">
              ← {t('dzhzLegal.back')}
            </Link>
            <Link className="transition-colors hover:text-ds-primary" to={otherDoc.to}>
              {otherDoc.label}
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
