import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsModal from '../components/SettingsModal.jsx';

// 语言下拉：点击「行 + 菜单」以外的任意处（含弹窗内空白与遮罩）应收起。
// 这里直接渲染弹窗（它用 createPortal，查询走 document.body）。

function renderModal() {
  return render(<SettingsModal open onClose={() => {}} />);
}

// 进入「外观」板块（语言下拉所在处）。
async function goToAppearance() {
  fireEvent.click(screen.getByRole('button', { name: '外观' }));
  await waitFor(() => expect(screen.getByText('字体和语言')).toBeInTheDocument());
}

const langRow = () => screen.getByRole('button', { name: /语言/ });
const langMenu = () => document.querySelector('.settings-lang-menu');

beforeEach(() => {
  localStorage.clear();
});

describe('SettingsModal 语言下拉：点击空白收起', () => {
  test('点击行展开菜单，再点弹窗内空白处收起', async () => {
    renderModal();
    await goToAppearance();

    expect(langMenu()).toBeNull();
    fireEvent.click(langRow());
    expect(langMenu()).not.toBeNull();

    // 点击弹窗内的非交互空白（板块标题）——mousedown 在容器外即收起
    fireEvent.mouseDown(screen.getByText('字体和语言'));
    await waitFor(() => expect(langMenu()).toBeNull());
  });

  test('点击遮罩（弹窗卡片之外）同样收起菜单', async () => {
    renderModal();
    await goToAppearance();
    fireEvent.click(langRow());
    expect(langMenu()).not.toBeNull();

    fireEvent.mouseDown(document.querySelector('.settings-backdrop'));
    await waitFor(() => expect(langMenu()).toBeNull());
  });

  test('点击行自身不会因外部监听而立刻收起（仍可切换）', async () => {
    renderModal();
    await goToAppearance();

    fireEvent.click(langRow());
    expect(langMenu()).not.toBeNull();
    // 再点一次行：由行自身的切换逻辑收起，而非外部监听误触发
    fireEvent.click(langRow());
    await waitFor(() => expect(langMenu()).toBeNull());

    fireEvent.click(langRow());
    expect(langMenu()).not.toBeNull();
  });

  test('选择语言后菜单收起且应用生效', async () => {
    renderModal();
    await goToAppearance();
    fireEvent.click(langRow());

    fireEvent.click(screen.getByRole('option', { name: 'English' }));

    await waitFor(() => expect(langMenu()).toBeNull());
    expect(localStorage.getItem('zyxf_lang')).toBe('en');
    // 复位，避免影响其他用例（i18n 由 setup 的 beforeEach 兜底）
    localStorage.setItem('zyxf_lang', 'zh');
  });
});
