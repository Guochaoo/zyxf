import { useTranslation } from 'react-i18next';
import DocPageShell from './Dzhz/DocPageShell.jsx';
import licenseText from './Dzhz/gpl-3.0.txt?raw';

/* ============================================================
 * 岱宗盒子 · 开源协议（/dzhz/license）
 *
 * 正文是 GNU General Public License v3.0 官方原文，直接取自 App 仓库
 * yeliqin666/xjtu-toolbox-android 的 LICENSE（未做任何改动，含原始换行
 * 与缩进，用 pre-wrap 保留）。版式与顶栏复用 DocPageShell，与协议页一致。
 * 仓库换许可证时同步替换 gpl-3.0.txt。
 * ============================================================ */

export default function DzhzLicensePage() {
  const { t } = useTranslation();

  return (
    <DocPageShell
      title={t('dzhzLicense.title')}
      otherDoc={{ label: t('dzhzLegal.title'), to: '/dzhz/legal' }}
    >
      <p>{t('dzhzLicense.intro')}</p>
      <div lang="en" className="whitespace-pre-wrap">
        {licenseText}
      </div>
    </DocPageShell>
  );
}
