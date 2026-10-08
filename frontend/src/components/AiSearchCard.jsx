import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { BsFolder } from 'react-icons/bs';
import { RiSearchAiLine } from 'react-icons/ri';
import { ChevronRight, Loader2, RotateCw } from 'lucide-react';
import FileIcon from './FileIcon.jsx';

/* ─────────────────────────────────────────────────────────
 * AI 搜索卡（搜索候选框顶部，DESIGN.md §4）
 * 三个形态：入口 → 查找中（彩虹流光泛光）→ 结果卡。
 * 结果卡只给「一句固定说明 + 命中条目」：LLM 的正文（markdown）不渲染。
 * 纯展示：请求状态由 useAiSearch 持有，这里只按 status 换形态。
 * ───────────────────────────────────────────────────────── */

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
  const { status, items, error, loginRequired, run } = ai;
  const q = (query || '').trim();

  // 入口态：与结果卡**共用同一层几何**——外层同样是 .rb-ai-card（只把渐变环与
  // 内层底色藏起来），内层是按钮，内边距与卡片头部逐项一致。这样点击前后内容
  // 一动不动（只有环浮现、右侧 chevron 换成转圈），内层圆角也恒为 12 − 1.5 = 10.5px。
  if (status === 'idle') {
    return (
      <div className="rb-ai-card rb-ai-card--idle">
        <button
          type="button"
          disabled={!q || loginRequired}
          onClick={() => run(q)}
          className="rb-ai-card__inner flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-200 enabled:hover:bg-black/5 disabled:cursor-default dark:enabled:hover:bg-white/5"
        >
          <AiIcon />
          <span className="min-w-0 flex-1 truncate text-[13px]">
            {loginRequired ? t('aiSearch.loginRequired') : t('aiSearch.entry')}
          </span>
          {!loginRequired && <ChevronRight className="h-4 w-4 shrink-0 opacity-35" />}
        </button>
      </div>
    );
  }

  const loading = status === 'loading';
  const failed = status === 'error';
  const hits = failed ? null : items;

  return (
    <div className="rb-ai-card">
      {/* 泛光只在查找中出现（内层卡片盖住中央，只留一圈外溢的流光）。 */}
      {loading && <span className="rb-ai-card__halo" aria-hidden="true" />}
      <div className="rb-ai-card__inner">
        {/* 头部行的内边距必须与入口态按钮逐项相同（px-3 py-2.5），否则点击后
            内容会位移几个像素——两处一起改。 */}
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <AiIcon />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium" aria-live="polite">
            {loading ? t('aiSearch.searching') : t('aiSearch.title')}
          </span>
          {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin opacity-45" />}
        </div>

        {/* LLM 的正文不渲染：它本来是 markdown，剥掉引用后仍会与下方清单重复，
            还会把 ** 之类的记号露给用户。命中资料由下面的条目行承担，说明行固定。 */}
        {hits?.length > 0 && (
          <>
            <p className="rb-ai-card__sub px-3 pb-2 text-[12.5px]">{t('aiSearch.describe')}</p>
            <div className="flex flex-col gap-1 px-2 pb-2">
              {hits.map((item) => (
                <ItemRow key={`${item.type}-${item.id}`} item={item} onOpen={onOpenItem} />
              ))}
            </div>
          </>
        )}

        {!loading && !failed && !hits?.length && (
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
