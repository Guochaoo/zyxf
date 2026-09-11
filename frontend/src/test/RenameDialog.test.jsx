import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RenameDialog from '../pages/Browse/RenameDialog.jsx';

// 手写浮层原先只有「点遮罩关闭」：Esc 无效、Tab 会走到浮层后面的列表并真实触发背景操作。
// 这里锁住 useModalDialog 的三个行为：Esc 关闭、Tab 在弹窗内循环、根节点标记 aria-hidden。
function renderDialog(props = {}) {
  const onClose = vi.fn();
  const view = render(
    <RenameDialog
      target={{ type: 'file', id: 1, name: 'a.pdf' }}
      value="a.pdf"
      onValueChange={() => {}}
      onSubmit={(e) => e.preventDefault()}
      onClose={onClose}
      renaming={false}
      {...props}
    />
  );
  return { onClose, view };
}

describe('RenameDialog 可访问性', () => {
  test('暴露 dialog 语义，并在浮层期间把应用根节点标记为 aria-hidden', () => {
    // 真实应用里 #root 承载全部页面内容；jsdom 默认没有，这里补一个再渲染
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    const { view } = renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.getElementById('root')).toHaveAttribute('aria-hidden', 'true');
    view.unmount();
    expect(document.getElementById('root')).not.toHaveAttribute('aria-hidden');
    root.remove();
  });

  test('Esc 关闭（原先只能点取消按钮）', () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('点遮罩关闭，但点弹窗内部不关闭', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    // 遮罩是 dialog 的父元素
    fireEvent.click(screen.getByRole('dialog').parentElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Tab 在弹窗内循环：最后一个控件按 Tab 回到第一个', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    const focusables = [...dialog.querySelectorAll('button, input')].filter((el) => !el.disabled);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  test('renaming 时（禁用态）Esc 仍按当前 enabled 语义处理', () => {
    const { onClose } = renderDialog({ renaming: true });
    fireEvent.keyDown(document, { key: 'Escape' });
    // enabled 仍为 true（只有 UploadDialog 会在上传中关闭 Esc），关闭由容器决定
    expect(onClose).toHaveBeenCalled();
  });
});
