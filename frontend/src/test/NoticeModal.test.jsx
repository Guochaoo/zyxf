import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import NoticeModal from '../components/NoticeModal.jsx';

beforeEach(() => {
  localStorage.clear();
  cleanup();
});

describe('NoticeModal', () => {
  test('首发：展示弹窗，点击同意后写入存储并隐藏', () => {
    render(<NoticeModal />);
    const dialog = screen.queryByRole('dialog', { name: '使用须知' });
    expect(dialog).toBeTruthy();
    expect(dialog).toHaveTextContent('文件安全');

    const agree = screen.getByRole('button', { name: /我已阅读并同意/ });
    fireEvent.click(agree);

    expect(localStorage.getItem('usage-notice-v2-agreed')).toBe('1');
    expect(screen.queryByRole('dialog', { name: '使用须知' })).toBeNull();
  });

  test('已同意（存储命中）则不渲染弹窗', () => {
    localStorage.setItem('usage-notice-v2-agreed', '1');
    const { container } = render(<NoticeModal />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog', { name: '使用须知' })).toBeNull();
  });
});
