import { Fragment, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import initHeaderScroll from './Dzhz/headerScroll.js';
import dzhzHtml from './Dzhz/content.html?raw';
import legalDoc from './Dzhz/legalContent.json';
import './Dzhz/dzhz.css';

/* ============================================================
 * 岱宗盒子 · 用户协议与隐私政策（/dzhz/legal）
 *
 * 版式照 deepseek.com/harness/privacy/ 做：固定顶栏 + 60px 大标题 +
 * `.legal-document` 正文（960px、17px/1.9），只把原站的纯白底换成 #F8F8F8。
 * 顶栏直接从 content.html 里取 /dzhz 首页的 `.ds-header-wrapper` 与移动端菜单，
 * 两边共用同一份 DOM，避免两处顶栏各自维护。
 *
 * 正文与 App 内「设置 → 关于 → 用户协议与隐私政策」是同一份（App 仓库
 * feature/settings/.../legal/Eula.kt），由 legalContent.json 逐字保存
 * （version = App 的 CURRENT_EULA_VERSION）。App 改条款时重新生成该 JSON
 * 并同步 version，两处才不会出现「设置里读到的不是网页上这份」。
 * 页面保留 #terms（标题）与 #privacy（第二节「数据来源与使用」）锚点，
 * 供外部直接深链。正文只有中文版，英文界面会在导语里如实说明。
 * ============================================================ */

const { version: LEGAL_VERSION, sections: LEGAL_SECTIONS } = legalDoc;

/* 顶栏的 DOM 只有一份，在 content.html 里；这里一次性取出注入。 */
function extractHeader(raw) {
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const desktop = doc.querySelector('.ds-header-wrapper');
  const mobileMenu = doc.querySelector('#harness-mobile-menu');
  return `${desktop?.outerHTML ?? ''}${mobileMenu?.outerHTML ?? ''}`;
}

const HEADER_HTML = typeof DOMParser === 'undefined' ? '' : extractHeader(dzhzHtml);

export default function DzhzLegalPage() {
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
              id="terms"
              className="max-w-[900px] scroll-mt-[112px] font-ds-display text-[38px] font-semibold leading-[1.12] tracking-[-0.03em] md:text-[60px]"
            >
              {`${t('menu.dzhz')} ${t('dzhzLegal.title')}`}
            </h1>
          </header>

          <div className="legal-page-body ds-container max-w-[960px] pb-ds-11">
            <article lang="zh-CN" className="legal-document">
              <p>{t('dzhzLegal.meta', { version: LEGAL_VERSION })}</p>
              <p>{t('dzhzLegal.intro')}</p>

              {LEGAL_SECTIONS.map((section) => (
                <Fragment key={section.id}>
                  {/* #privacy 供直接深链：第二节开始讲数据与隐私 */}
                  <h2 id={section.id === 'data' ? 'privacy' : section.id}>{section.title}</h2>
                  {section.blocks.map((block, blockIndex) => (
                    <p key={blockIndex}>
                      {block.map((segment, segmentIndex) =>
                        segment.b ? (
                          <strong key={segmentIndex}>{segment.t}</strong>
                        ) : (
                          <span key={segmentIndex}>{segment.t}</span>
                        )
                      )}
                    </p>
                  ))}
                </Fragment>
              ))}
            </article>
          </div>
        </main>

        <footer className="ds-container pb-ds-6">
          <div className="flex flex-col gap-ds-3 py-ds-5 text-[13px] text-ds-description sm:flex-row sm:items-center sm:justify-between">
            <Link className="legal-back-link transition-colors hover:text-ds-primary" to="/dzhz">
              ← {t('dzhzLegal.back')}
            </Link>
            <span>GPL-3.0 license</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
