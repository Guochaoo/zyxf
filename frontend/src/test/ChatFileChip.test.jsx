import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FileChip } from '../components/Chat/parts.jsx';

// IMPROVE-34 回归：未知扩展名的胶囊徽章原先回落 `bg-brand-500`，而 index.css 的
// `.app-theme .bg-brand-500 { background: var(--ink) !important }` 会把它染成墨黑
// （既不是品牌蓝，也不是中性灰）。现在必须与 archive / 文件夹一致用中性灰。
const badgeOf = (item) => {
  const { container } = render(
    <MemoryRouter>
      <FileChip item={item} />
    </MemoryRouter>
  );
  const text = item.type === 'folder' ? 'DIR' : (item.ext || '').toUpperCase().slice(0, 4);
  const badge = [...container.querySelectorAll('span')].find((el) => el.textContent === text);
  expect(badge, `未找到徽章 span（期望文案 ${text}）`).toBeTruthy();
  return badge;
};

describe('FileChip 类型徽章色调', () => {
  test('未知扩展名 → 中性灰，不再是会被覆盖成墨黑的 bg-brand-500', () => {
    const badge = badgeOf({ type: 'file', name: 'README.md', ext: 'md' });
    expect(badge.className).toContain('bg-[#808080]');
    expect(badge.className).not.toContain('bg-brand-500');
  });

  test('无扩展名 / 无 ext 字段同样回落中性灰', () => {
    expect(badgeOf({ type: 'file', name: 'Makefile', ext: '' }).className).toContain('bg-[#808080]');
    expect(badgeOf({ type: 'file', name: 'LICENSE' }).className).toContain('bg-[#808080]');
  });

  test('已知族别与文件夹的既有色调不变', () => {
    expect(badgeOf({ type: 'file', name: 'a.pdf', ext: 'pdf' }).className).toContain('bg-red');
    expect(badgeOf({ type: 'file', name: 'a.xlsx', ext: 'xlsx' }).className).toContain('bg-green');
    expect(badgeOf({ type: 'file', name: 'a.docx', ext: 'docx' }).className).toContain('bg-orange');
    expect(badgeOf({ type: 'folder', name: '高数', ext: '' }).className).toContain('bg-[#808080]');
  });
});
