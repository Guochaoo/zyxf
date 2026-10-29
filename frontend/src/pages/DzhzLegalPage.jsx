import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import legalDoc from './Dzhz/legalContent.json';

/* ============================================================
 * 岱宗盒子 · 用户协议与隐私政策（/dzhz/legal）
 *
 * 正文与 App 内「设置 → 关于 → 用户协议与隐私政策」是同一份（App 仓库
 * feature/settings/.../legal/Eula.kt），由 legalContent.json 逐字保存
 * （version = App 的 CURRENT_EULA_VERSION）。App 改条款时重新生成该 JSON
 * 并同步 version，两处才不会出现「设置里读到的不是网页上这份」。
 *
 * /dzhz 页脚的「用户协议与隐私政策」指向本页：正文是一份合并文档，不拆成两份
 * 各自维护。页面保留 #terms（标题）与 #privacy（第二节「数据来源与使用」）两个
 * 锚点，供外部直接深链。正文只有中文版，英文界面会在导语里如实说明。
 * ============================================================ */

const { version: LEGAL_VERSION, sections: LEGAL_SECTIONS } = legalDoc;

export default function DzhzLegalPage() {
  const { t } = useTranslation();
  const { hash } = useLocation();

  // 页脚用的是普通 <a href="/dzhz/legal#privacy">，整页加载时浏览器可能先按空
  // 文档滚一次；内容由 React 渲染，这里按 hash 再定位一次，深链才稳定。
  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(hash.slice(1));
    if (target) target.scrollIntoView({ block: 'start' });
  }, [hash]);

  return (
    <div className="mx-auto w-full max-w-[820px]">
      <header className="mb-5 flex min-h-[34px] items-center justify-between gap-4">
        <Link to="/dzhz" className="flex shrink-0 items-center gap-2 hover:opacity-80">
          <img
            src="/dzhz/images/brand-avatar.webp"
            alt=""
            aria-hidden="true"
            className="h-7 w-7 object-contain"
          />
          <span className="rb-brand-title whitespace-nowrap">{t('menu.dzhz')}</span>
        </Link>
        <Link to="/dzhz" className="text-[13px] text-ink-2 transition-opacity hover:opacity-70">
          {t('dzhzLegal.back')}
        </Link>
      </header>

      <article className="rounded-card bg-surface p-5 sm:p-8">
        <p className="text-[12px] tabular-nums text-ink-3">
          {t('dzhzLegal.meta', { version: LEGAL_VERSION })}
        </p>
        <h1 id="terms" className="mt-2 scroll-mt-6 text-[26px] font-semibold leading-tight text-ink sm:text-[30px]">
          {t('dzhzLegal.title')}
        </h1>
        <p className="mt-3 text-[13px] leading-[22px] text-ink-2">{t('dzhzLegal.intro')}</p>

        <div className="mt-8 space-y-7">
          {LEGAL_SECTIONS.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-6">
              {/* #privacy 供直接深链：第二节开始讲数据与隐私 */}
              {section.id === 'data' && <span id="privacy" className="block scroll-mt-6" aria-hidden="true" />}
              <h2 className="text-[16px] font-semibold text-ink sm:text-[17px]">{section.title}</h2>
              <div className="mt-2 space-y-2">
                {section.blocks.map((block, blockIndex) => (
                  <p key={blockIndex} className="text-[14px] leading-[26px] text-ink-2">
                    {block.map((segment, segmentIndex) =>
                      segment.b ? (
                        <strong key={segmentIndex} className="font-semibold text-ink">
                          {segment.t}
                        </strong>
                      ) : (
                        <span key={segmentIndex}>{segment.t}</span>
                      )
                    )}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-8 border-t border-line pt-4 text-[12px] leading-[20px] text-ink-3">
          <p>{t('dzhzLegal.source', { version: LEGAL_VERSION })}</p>
        </footer>
      </article>
    </div>
  );
}
