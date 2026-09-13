// 重命名弹窗（原 BrowsePage.jsx 内联定义，IMPROVE-01 拆分）。
// 纯受控组件：改名请求由容器提交，这里只负责取值与展示。
import { useTranslation } from 'react-i18next';
import { useModalDialog } from '../../hooks/useModalDialog.js';

export default function RenameDialog({ target, value, onValueChange, onSubmit, onClose, renaming }) {
  const { t } = useTranslation();
  // Esc 关闭、Tab 在弹窗内循环、关闭后焦点回到触发按钮（原先 Esc 与遮罩点击都不关）
  const panelRef = useModalDialog({ enabled: !!target, onClose });
  if (!target) return null;
  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/35 px-4"
      onClick={onClose}
    >
      <form
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('browse.rename')}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rb-card rounded-lg bg-white p-4 text-slate-900"
      >
        <h2 className="text-base font-semibold">{t('browse.rename')}</h2>
        <p className="mt-1 text-xs text-slate-400">
          {target.type === 'folder' ? t('browse.foldersLabel') : t('browse.filesLabel')}
        </p>
        <input
          autoFocus
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className="mt-4 w-full rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={renaming}
            className="rb-btn-ghost h-[34px] px-3 text-sm disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={renaming}
            className="rename-dialog-save rb-btn-dark h-[34px] px-3 text-sm font-semibold disabled:opacity-50"
          >
            {renaming ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
