import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

// ConfirmDialog 是纯受控弹窗（类型对齐 RenameDialog）：open/busy 都由容器决定，
// 自己只负责渲染与把点击原样回调出去。
function renderDialog(props = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <ConfirmDialog
      open
      title="删除文件夹"
      message="确认删除「课程资料」？"
      confirmLabel="删除"
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />
  );
  return { onConfirm, onClose, view };
}

describe('ConfirmDialog', () => {
  test('open 为 false 时整棵弹窗不渲染', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByText('删除文件夹')).toBeNull();
  });

  test('打开时渲染标题与正文，并带 alertdialog 模态语义', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('删除文件夹');
    expect(screen.getByText('确认删除「课程资料」？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
  });

  test('未传 confirmLabel 时确认按钮回落到字典的「确认」', () => {
    renderDialog({ confirmLabel: undefined });
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
  });

  test('点确认触发 onConfirm；点取消与遮罩触发 onClose；点弹窗内部不关闭', () => {
    const { onConfirm, onClose } = renderDialog();

    fireEvent.click(screen.getByRole('alertdialog'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // 遮罩是 alertdialog 的父元素
    fireEvent.click(screen.getByRole('alertdialog').parentElement);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('busy 时确认与取消都禁用（提交中不能再点第二下）', () => {
    renderDialog({ busy: true });
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  });

  test('Esc 关闭（遮罩点击之外的退出方式）', () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
