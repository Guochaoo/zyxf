import { useEffect, useRef } from 'react';

/**
 * 自定义浮层的可访问性行为（统一入口）。
 *
 * 本项目有三个手写浮层（预览 Preview、上传 UploadDialog、重命名 RenameDialog）挂在
 * document.body 末尾，原先都只有「点遮罩关闭」：
 *  - Esc 关不掉（RenameDialog 连遮罩点击都不关）；
 *  - Tab 会一路走到浮层后面的文件列表/工具栏，回车会真的触发背景操作；
 *  - 读屏不知道出现了对话框。
 *
 * 这里给出统一实现：Esc 关闭、打开时聚焦首个控件、Tab 在浮层内循环、关闭后焦点回到
 * 打开它的元素，并顺手把浮层期间的应用根节点标记为 aria-hidden（模态语义一致）。
 * 调用方只需把返回的 ref 挂到**浮层内容容器**（不是遮罩层）上，并给该容器加
 * role="dialog" aria-modal="true"。
 *
 * @param {{ enabled?: boolean, onClose: () => void }} options
 *   enabled=false 时不绑定（例如内容尚未渲染 / 正在上传中不希望 Esc 关掉）
 * @returns {import('react').RefObject<HTMLElement>} 内容容器的 ref
 */
export function useModalDialog({ enabled = true, onClose } = {}) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled) return undefined;
    const panel = panelRef.current;
    const opener = document.activeElement; // 关闭后把焦点还给它
    const root = document.getElementById('root');

    const focusables = () =>
      Array.from(
        panel?.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      ).filter((el) => !el.hasAttribute('hidden') && el.offsetParent !== null);

    // 打开时把焦点移进浮层（内容里有 autoFocus 的元素时浏览器已先聚焦，这里只是兜底）
    if (panel && !panel.contains(document.activeElement)) {
      (focusables()[0] || panel).focus?.();
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      // 焦点跑到浮层外（例如浮层里暂时没有可聚焦元素）也要拉回来
      if (!panel?.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    if (root) root.setAttribute('aria-hidden', 'true');

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (root) root.removeAttribute('aria-hidden');
      // 焦点归还：元素可能已随列表刷新消失，所以先确认仍在文档里
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus?.();
    };
  }, [enabled]);

  return panelRef;
}
