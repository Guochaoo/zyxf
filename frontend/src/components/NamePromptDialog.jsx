// 文本输入弹窗（IMPROVE-57）：替代管理操作里的 window.prompt——原生弹窗阻塞
// 主线程、无法样式化、i18n 按钮固定。样式与交互对齐 RenameDialog（Esc/遮罩关闭、
// 关闭后焦点归还触发者）。
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalDialog } from '../hooks/useModalDialog.js';

export default function NamePromptDialog({ open, title, placeholder, initial = '', submitLabel, onSubmit, onClose, busy }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const panelRef = useModalDialog({ enabled: open, onClose });

  // 每次打开重置为初始值
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/35 px-4"
      onClick={onClose}
    >
      <form
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(value);
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rb-card rounded-lg bg-white p-4 text-slate-900"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          className="mt-4 w-full rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rb-btn-ghost h-[34px] px-3 text-sm disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="rename-dialog-save rb-btn-dark h-[34px] px-3 text-sm font-semibold disabled:opacity-50"
          >
            {busy ? t('common.loading') : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
