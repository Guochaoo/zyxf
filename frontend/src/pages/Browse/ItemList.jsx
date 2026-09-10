// 文件/文件夹列表（原 BrowsePage.jsx 内联定义，IMPROVE-01 拆分）。
// 纯展示：拖拽状态与各类回调由容器传入，本模块不发起任何请求。
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, PenLine, Trash } from 'lucide-react';
import { BsGripVertical } from 'react-icons/bs';
import FileIcon from '../../components/FileIcon.jsx';
import GlideList from '../../components/GlideList.jsx';
import { formatDate, formatSize } from '../../utils.js';
import { RowAction } from './primitives.jsx';

export default function ItemList({
  data,
  isAdmin,
  dragging,
  dropZone,
  onEnterFolder,
  onPreviewFile,
  onDeleteFolder,
  onDeleteFile,
  onRenameFolder,
  onRenameFile,
  onDownloadFile,
  onDragStart,
  onDragEnd,
  onRowDragOver,
  onRowDragLeave,
  onRowDrop,
}) {
  const { t } = useTranslation();
  // data.items 存在（manual 模式）时它就是完整列表；否则 folders + files。
  const total = data?.items?.length ?? ((data?.folders?.length || 0) + (data?.files?.length || 0));
  if (total === 0) {
    return <div className="py-16 text-center text-slate-500 text-sm">{t('browse.empty')}</div>;
  }
  const actionWidthClass = isAdmin ? 'w-28' : 'w-16';
  // 按当前列表实际大小数量等分成 6 段，得到 5 个分位阈值
  const thresholds = useMemo(
    () =>
      sizeThresholds(
        [...(data?.folders || []), ...(data?.files || [])]
          .map((x) => x.size)
          .filter((n) => Number.isFinite(n))
      ),
    [data]
  );
  // 手动排序下后端返回合并视图 items（文件夹与文件共享 sort_order 序列），
  // 直接按它渲染才能保持拖拽出的交错顺序（BUG-27）；其余排序模式后端给不出
  // 交错语义，仍按「文件夹在前、文件在后」渲染。
  const ordered = data?.items ?? [
    ...(data?.folders || []).map((f) => ({ ...f, type: 'folder' })),
    ...(data?.files || []).map((f) => ({ ...f, type: 'file' })),
  ];

  // 两类的行内结构一致，仅点击目标与操作按钮不同——统一构造避免重复。
  const rows = ordered.map((item) => {
    const isFolder = item.type === 'folder';
    return {
      key: `${isFolder ? 'd' : 'f'}-${item.id}`,
      item,
      onClick: isFolder ? () => onEnterFolder(item) : () => onPreviewFile(item),
      actions: isFolder ? (
        isAdmin && (
          <>
            <RowAction title={t('browse.rename')} onClick={() => onRenameFolder(item)}>
              <PenLine className="w-4 h-4" />
            </RowAction>
            <RowAction title={t('common.delete')} onClick={() => onDeleteFolder(item)}>
              <Trash className="w-4 h-4" />
            </RowAction>
          </>
        )
      ) : (
        <>
          <RowAction title={t('browse.download')} onClick={() => onDownloadFile(item)}>
            <Download className="w-4 h-4" />
          </RowAction>
          {isAdmin && (
            <>
              <RowAction title={t('browse.rename')} onClick={() => onRenameFile(item)}>
                <PenLine className="w-4 h-4" />
              </RowAction>
              <RowAction title={t('common.delete')} onClick={() => onDeleteFile(item)}>
                <Trash className="w-4 h-4" />
              </RowAction>
            </>
          )}
        </>
      ),
    };
  });
  return (
    <GlideList as="ul" highlightClassName="bg-hover">
      <li className="rb-table-heading hidden sm:flex items-center gap-2 px-4 py-2 text-xs text-slate-500 bg-field">
        {isAdmin && <span className="w-4 h-4 -ml-1 sm:mr-1 sm:-ml-2 shrink-0" />}
        <span className="flex-1 flex items-center gap-2 min-w-0">
          <span className="w-5 h-5 shrink-0" />
          <span>{t('browse.colName')}</span>
        </span>
        <span className="w-24 text-right">{t('browse.colSize')}</span>
        <span className="w-28 text-right">{t('browse.colModified')}</span>
        <span className={`${actionWidthClass} text-right`}>{t('browse.colAction')}</span>
      </li>
      {rows.map(({ key, item, onClick, actions }) => (
        <Row
          key={key}
          item={item}
          tone={toneFor(item.size, thresholds)}
          isAdmin={isAdmin}
          dragging={dragging}
          dropZone={dropZone}
          actionWidthClass={actionWidthClass}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onRowDragOver={onRowDragOver}
          onRowDragLeave={onRowDragLeave}
          onRowDrop={onRowDrop}
          onClick={onClick}
          actions={actions}
        />
      ))}
    </GlideList>
  );
}

// 大小配色：6 档（小→大）的 背景/字体 色对
const SIZE_TONES = [
  { bg: '#DCF2E9', fg: '#3DAB7D' }, // 1 绿
  { bg: '#E0F1F7', fg: '#50A8C4' }, // 2 蓝
  { bg: '#EAE4FB', fg: '#896BD9' }, // 3 紫
  { bg: '#F6E1F8', fg: '#CF81DA' }, // 4 粉紫
  { bg: '#FCE1EA', fg: '#D982AB' }, // 5 粉（字体调深，浅粉底上更清晰）
  { bg: '#FBE0DE', fg: '#D2615A' }, // 6 红（字体调深，浅粉底上更清晰）
];

// 按当前列表实际大小数量等分成 6 段，返回 5 个分位阈值（单位：字节）
function sizeThresholds(sizes) {
  const sorted = [...sizes].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const n = SIZE_TONES.length;
  const t = [];
  for (let i = 1; i < n; i += 1) {
    t.push(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * i) / n))]);
  }
  return t;
}

// 大小落在哪一档（0..5）；越过所有阈值则落在最大档
function toneFor(size, thresholds) {
  let i = 0;
  while (i < thresholds.length && size >= thresholds[i]) i += 1;
  return i;
}

// 大小标签徽章：按档位取对应配色并渲染格式化后的文件大小
function SizeChip(size, tone) {
  const c = SIZE_TONES[tone] ?? SIZE_TONES[0];
  return (
    <span className="records-tag" style={{ background: c.bg, color: c.fg, '--tag-base': c.fg }}>
      {formatSize(size)}
    </span>
  );
}

function Row({
  item,
  isAdmin,
  dragging,
  dropZone,
  actionWidthClass,
  onDragStart,
  onDragEnd,
  onRowDragOver,
  onRowDragLeave,
  onRowDrop,
  onClick,
  actions,
  tone,
}) {
  const isSelf = dragging?.type === item.type && dragging.id === item.id;
  const targetMatch =
    dropZone && dropZone.targetType === item.type && dropZone.id === item.id;
  const isInto = targetMatch && dropZone.mode === 'into';
  const isBefore = targetMatch && dropZone.mode === 'before';
  const isAfter = targetMatch && dropZone.mode === 'after';

  return (
    <li
      data-glide-row
      draggable={isAdmin}
      onDragStart={(e) => onDragStart(e, { type: item.type, id: item.id, name: item.name })}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onRowDragOver(e, { type: item.type, id: item.id })}
      onDragLeave={() => onRowDragLeave({ type: item.type, id: item.id })}
      onDrop={(e) => onRowDrop(e, { type: item.type, id: item.id })}
      // 行内主操作（进入文件夹 / 预览文件）原先是裸 onClick 的 <li>：键盘用户完全够不到，
      // 读屏也不知道这行可以打开（BUG-66）。补 role/tabIndex 与 Enter/Space 处理，
      // 行内操作按钮仍是各自独立的 <button>（点它们不会冒泡到本行，见下方 stopPropagation）。
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return; // 行内按钮自行处理键盘
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); // 空格默认会滚屏
          onClick();
        }
      }}
      className={`relative flex items-center gap-2 px-3 sm:px-4 py-3 sm:py-2.5 cursor-pointer transition-[background-color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/30 ${
        isInto ? 'bg-black/5 ring-1 ring-inset ring-black/10' : ''
      } ${
        isBefore ? 'shadow-[inset_0_2px_0_0_rgba(0,0,0,0.6)]' : ''
      } ${
        isAfter ? 'shadow-[inset_0_-2px_0_0_rgba(0,0,0,0.6)]' : ''
      } ${!targetMatch && isSelf ? 'opacity-40' : ''}`}
      onClick={onClick}
    >
      {isAdmin && (
        <BsGripVertical className="w-4 h-4 -ml-1 sm:mr-1 sm:-ml-2 shrink-0 cursor-grab" />
      )}
      <span className="flex-1 flex items-center gap-2 min-w-0">
        <FileIcon type={item.type} ext={item.ext} />
        <span className="min-w-0 truncate">{item.name}</span>
      </span>
      <span className="hidden sm:flex w-24 justify-end">
        {SizeChip(item.size, tone)}
      </span>
      <span className="hidden sm:inline w-28 text-right text-xs text-slate-400">
        {formatDate(item.created_at)}
      </span>
      <span
        className={`flex ${isAdmin ? 'w-24 sm:w-28' : 'w-9 sm:w-16'} shrink-0 justify-end gap-1`}
        onClick={(e) => e.stopPropagation()}
      >
        {actions}
      </span>
    </li>
  );
}
