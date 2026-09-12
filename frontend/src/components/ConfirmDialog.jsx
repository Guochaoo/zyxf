// 通用确认弹窗（IMPROVE-55）：替代管理操作里的 window.confirm——原生弹窗阻塞
// 主线程、无法样式化、i18n 按钮固定。样式对齐 RenameDialog。
import { useTranslation } from 'react-i18next';
import { useModalDialog } from '../hooks/useModalDialog.js';

export default function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onClose, busy }) {
  const { t } = useTranslation();
  const panelRef = useModalDialog({ enabled: open, onClose });
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/35 px-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rb-card rounded-lg bg-white p-4 text-slate-900"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{message}</p>
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
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rb-btn-dark h-[34px] px-3 text-sm font-semibold disabled:opacity-50"
          >
            {confirmLabel || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
