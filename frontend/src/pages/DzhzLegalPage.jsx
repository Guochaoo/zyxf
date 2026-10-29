import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import DocPageShell from './Dzhz/DocPageShell.jsx';
import legalDoc from './Dzhz/legalContent.json';

/* ============================================================
 * 岱宗盒子 · 用户协议与隐私政策（/dzhz/legal）
 *
 * 正文与 App 内「设置 → 关于 → 用户协议与隐私政策」是同一份（App 仓库
 * feature/settings/.../legal/Eula.kt），由 legalContent.json 逐字保存
 * （version = App 的 CURRENT_EULA_VERSION）。App 改条款时重新生成该 JSON
 * 并同步 version，两处才不会出现「设置里读到的不是网页上这份」。
 * 页面保留 #terms（标题）与 #privacy（第二节「数据来源与使用」）锚点，
 * 供外部直接深链。版式与顶栏见 DocPageShell。
 * ============================================================ */

const { version: LEGAL_VERSION, sections: LEGAL_SECTIONS } = legalDoc;

export default function DzhzLegalPage() {
  const { t } = useTranslation();

  return (
    <DocPageShell
      title={`${t('menu.dzhz')} ${t('dzhzLegal.title')}`}
      titleId="terms"
      otherDoc={{ label: t('dzhzLicense.title'), to: '/dzhz/license' }}
    >
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
    </DocPageShell>
  );
}
