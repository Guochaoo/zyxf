import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { BsFolder } from 'react-icons/bs';
import { RiSearchAiLine } from 'react-icons/ri';
import { ChevronRight, Loader2, RotateCw } from 'lucide-react';
import FileIcon from './FileIcon.jsx';

/* ─────────────────────────────────────────────────────────
 * AI 搜索卡（搜索候选框顶部，DESIGN.md §4）
 * 三个形态：入口 → 查找中（彩虹流光泛光）→ 结果卡。
 * 纯展示：请求状态由 useAiSearch 持有，这里只按 status 换形态。
 * ───────────────────────────────────────────────────────── */

// 后端把命中的资料写成回答里的【文件N】引用，正文里直接展示这串编号没有意义——
// 条目已经以列表形式给在下方（与「一句描述 + 候选条目」的结构一致）。
// 标记本身是中文，这里用码点转义写：源码里不得出现中文文案（test/i18n.test.js 强制）。
const CITATION = /\u3010\u6587\u4ef6\d+\u3011/g;
const stripCitations = (value) =>
  (value || '')
    .replace(CITATION, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();

// AI 图标：RiSearchAiLine（放大镜 + 星芒），透明底、图标自身走渐变填充。
// 渐变要在文档里有个 <defs> 才解析得出来，所以随图标渲染一段 0×0 的 svg；
// id 按实例唯一（移动端 / 桌面端两个 SearchBar 可能同时挂载），React 的 useId
// 带冒号，塞进 CSS 的 url() 前先洗掉。
function AiIcon() {
  const gid = `rb-ai-grad-${useId().replace(/:/g, '')}`;
  return (
    <>
      <svg aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--rb-ai-c1)' }} />
            <stop offset="45%" style={{ stopColor: 'var(--rb-ai-c3)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--rb-ai-c6)' }} />
          </linearGradient>
        </defs>
      </svg>
      <span className="rb-ai-icon" aria-hidden="true">
        {/* 末尾那支颜色是兜底：渐变引用万一解析不到，图标仍以品牌紫渲染而不是消失。 */}
        <RiSearchAiLine style={{ fill: `url(#${gid}) var(--rb-ai-c1)` }} />
      </span>
    </>
  );
}

function ItemRow({ item, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="flex w-full items-center gap-2.5 rounded-[9px] bg-inset px-2.5 py-2 text-left transition-colors duration-200 hover:bg-hover"
    >
      {item.type === 'folder' ? (
        <BsFolder className="h-4 w-4 shrink-0 text-amber-400" />
      ) : (
        <FileIcon type="file" ext={item.ext} className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-[1.35]">{item.name}</span>
        {item.folder_path && (
          <span className="rb-ai-card__sub block truncate text-[11px] leading-[1.4]">
            {item.folder_path}
          </span>
        )}
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-35" />
    </button>
  );
}

export default function AiSearchCard({ query, ai, onOpenItem, onOpenSettings }) {
  const { t } = useTranslation();
  const { status, text, items, error, loginRequired, run } = ai;
  const q = (query || '').trim();

  // 入口态：与候选框里的结果行同样是「一行 hover 高亮」，不是卡片。
  if (status === 'idle') {
    return (
      <button
        type="button"
        disabled={!q || loginRequired}
        onClick={() => run(q)}
        className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors duration-200 enabled:hover:bg-black/5 disabled:cursor-default dark:enabled:hover:bg-white/5"
      >
        <AiIcon />
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {loginRequired ? t('aiSearch.loginRequired') : t('aiSearch.entry')}
        </span>
        {!loginRequired && <ChevronRight className="h-4 w-4 shrink-0 opacity-35" />}
      </button>
    );
  }

  const loading = status === 'loading';
  const failed = status === 'error';
  const answer = failed ? '' : stripCitations(text);
  const hits = failed ? null : items;
  const showNoResult = !loading && !failed && !answer && !hits?.length;

  return (
    <div className="rb-ai-card">
      {/* 泛光只在查找中出现（内层卡片盖住中央，只留一圈外溢的流光）。 */}
      {loading && <span className="rb-ai-card__halo" aria-hidden="true" />}
      <div className="rb-ai-card__inner">
        <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-1.5">
          <AiIcon />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium" aria-live="polite">
            {loading ? t('aiSearch.searching') : t('aiSearch.title')}
          </span>
          {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin opacity-45" />}
        </div>

        {answer && (
          <p className="rb-ai-card__sub px-3 pb-2 text-[12.5px] leading-[1.5] whitespace-pre-line">
            {answer}
          </p>
        )}

        {hits?.length > 0 && (
          <div className="flex flex-col gap-1 px-2 pb-2">
            {hits.map((item) => (
              <ItemRow key={`${item.type}-${item.id}`} item={item} onOpen={onOpenItem} />
            ))}
          </div>
        )}

        {showNoResult && (
          <p className="rb-ai-card__sub px-3 pb-2.5 text-[12.5px]">{t('aiSearch.noResult')}</p>
        )}

        {failed && (
          <div className="flex items-start gap-3 px-3 pb-2.5 text-[12.5px]">
            <span className="rb-ai-card__error min-w-0 flex-1">{error}</span>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="shrink-0 rounded-full px-2 py-0.5 text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
              >
                {t('settings.nav.ai')}
              </button>
            )}
            <button
              type="button"
              onClick={() => run(q)}
              className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
            >
              <RotateCw className="h-3 w-3" />
              {t('aiSearch.retry')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
