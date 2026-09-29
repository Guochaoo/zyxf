import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NamePromptDialog from '../components/NamePromptDialog.jsx';

// 输入弹窗是「受控 open + 自己管 value」的混合体：初值只在「每次打开」这一拍灌进去，
// 关闭不销毁 state（组件仍挂在父级里），所以重开必须靠 effect 重置，否则会残留上次输入。
function renderDialog(props = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const base = {
    open: true,
    title: '新建文件夹',
    placeholder: '文件夹名称',
    initial: '',
    submitLabel: '确认',
    onSubmit,
    onClose,
  };
  const view = render(<NamePromptDialog {...base} {...props} />);
  const rerenderWith = (next) => view.rerender(<NamePromptDialog {...base} {...props} {...next} />);
  return { onSubmit, onClose, view, rerenderWith };
}

const input = () => screen.getByRole('textbox');
const confirmButton = () => screen.getByRole('button', { name: '确认' });

describe('NamePromptDialog 空值保护', () => {
  test('未输入任何内容时确认按钮禁用', () => {
    renderDialog();
    expect(confirmButton()).toBeDisabled();
  });

  test('只输入空格时确认按钮仍禁用（防建出看不见的文件夹）', () => {
    renderDialog();
    fireEvent.change(input(), { target: { value: '   ' } });
    expect(confirmButton()).toBeDisabled();
  });

  test('输入有效名称后按钮可用，提交把 trim 后的值回传给 onSubmit', () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(input(), { target: { value: ' 线性代数 ' } });
    expect(confirmButton()).toBeEnabled();

    fireEvent.submit(input().closest('form'));
    // issue #64：校验只判「非空白」，提交时由组件统一 trim，调用方不必再处理首尾空格
    expect(onSubmit).toHaveBeenCalledWith('线性代数');
  });

  test('不传 submitLabel 时按钮有兜底文案（不再渲染成无名空按钮）', () => {
    renderDialog({ submitLabel: undefined });
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
  });

  test('取消按钮触发 onClose，不触发 onSubmit', () => {
    const { onSubmit, onClose } = renderDialog();
    fireEvent.change(input(), { target: { value: '未提交' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('NamePromptDialog 初值重置', () => {
  test('关闭后重新打开：输入框回到 initial，而不是残留上次输入', () => {
    const { rerenderWith } = renderDialog({ initial: '默认名' });
    expect(input().value).toBe('默认名');

    fireEvent.change(input(), { target: { value: '上次打的字' } });
    rerenderWith({ open: false });
    expect(screen.queryByRole('textbox')).toBeNull();

    rerenderWith({ open: true });
    expect(input().value).toBe('默认名');
  });

  test('默认 initial 为空串：重开后是空输入且确认按钮重新禁用', () => {
    const { rerenderWith } = renderDialog();
    fireEvent.change(input(), { target: { value: '临时名字' } });
    expect(confirmButton()).toBeEnabled();

    rerenderWith({ open: false });
    rerenderWith({ open: true });

    expect(input().value).toBe('');
    expect(confirmButton()).toBeDisabled();
  });

  // issue #64：打开期间父级改 initial（重命名目标变了 / 列表刷新带回新值）不该覆盖用户输入
  test('打开期间 initial 变化不覆盖正在输入的内容；关闭重开后新 initial 才生效', () => {
    const { rerenderWith } = renderDialog({ initial: '旧目标' });
    fireEvent.change(input(), { target: { value: '用户正在打的字' } });

    rerenderWith({ initial: '新目标' });
    expect(input().value).toBe('用户正在打的字');

    rerenderWith({ open: false, initial: '新目标' });
    rerenderWith({ open: true, initial: '新目标' });
    expect(input().value).toBe('新目标');
  });
});

describe('NamePromptDialog 提交中', () => {
  test('busy 时确认按钮显示「加载中…」且两个按钮都禁用', () => {
    renderDialog({ busy: true, initial: '课程' });
    expect(screen.getByRole('button', { name: '加载中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
  });
});
