import { useTranslation } from 'react-i18next';
import DocPageShell from './Dzhz/DocPageShell.jsx';
import { parseGpl } from './Dzhz/parseGpl.js';
import licenseText from './Dzhz/gpl-3.0.txt?raw';

/* ============================================================
 * 岱宗盒子 · 开源协议（/dzhz/license）
 *
 * 正文是 GNU General Public License v3.0 官方原文，取自 App 仓库
 * yeliqin666/xjtu-toolbox-android 的 LICENSE。原文按 ~72 字符硬换行，
 * 直接展示只占正文左侧一条；parseGpl 按空行分段后重排，章节标题按
 * `.legal-document` 的 h2 渲染，正文铺满 960px，与协议页同一版式。
 * 仓库换许可证时同步替换 gpl-3.0.txt。
 * ============================================================ */

const LICENSE_BLOCKS = parseGpl(licenseText);

export default function DzhzLicensePage() {
  const { t } = useTranslation();

  return (
    <DocPageShell
      title={t('dzhzLicense.title')}
      otherDoc={{ label: t('dzhzLegal.title'), to: '/dzhz/legal' }}
    >
      {LICENSE_BLOCKS.map((block, index) =>
        block.type === 'h2' ? (
          <h2 key={index} style={index === 0 ? { marginTop: 0 } : undefined}>
            {block.text}
          </h2>
        ) : (
          <p key={index}>{block.text}</p>
        )
      )}
    </DocPageShell>
  );
}
