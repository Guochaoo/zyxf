import { describe, test, expect, vi } from 'vitest';
import fs from 'node:fs';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Toast from '../components/Toast.jsx';

// 登录/注册页与资料页同步反馈共用这个通知卡，此前没有测试。
describe('Toast 通知卡', () => {
  test('主行与副行文案都渲染出来', () => {
    render(
      <MemoryRouter>
        <Toast type="success" message="同步完成" sub="新增 1 个文件夹 / 2 个文件，清理 3 个失效文件" />
      </MemoryRouter>
    );
    const card = screen.getByRole('alert');
    expect(card.className).toContain('toast-card--success');
    expect(screen.getByText('同步完成')).toBeInTheDocument();
    expect(screen.getByText('新增 1 个文件夹 / 2 个文件，清理 3 个失效文件')).toBeInTheDocument();
  });

  test('未知类型回退为 info，未传 sub 时用字典默认副文案', () => {
    render(
      <MemoryRouter>
        <Toast type="不存在的类型" message="提示" />
      </MemoryRouter>
    );
    const card = screen.getByRole('alert');
    expect(card.className).toContain('toast-card--info');
    expect(card.textContent).toContain('提示');
  });

  test('点关闭按钮进入 closing 态，随后回调 onClose（且只回调一次）', () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      render(
        <MemoryRouter>
          <Toast type="error" message="出错了" onClose={onClose} />
        </MemoryRouter>
      );
      fireEvent.click(screen.getByRole('button', { name: '关闭' }));
      const card = screen.getByRole('alert');
      expect(card.className).toContain('toast-card--closing');
      expect(onClose).not.toHaveBeenCalled(); // 先播放淡出动画

      // 正常路径是 animationend 回调；但该事件并非必然到达（用户禁用动画、被扩展覆盖），
      // 所以组件另有一道 500ms 兜底。jsdom 里 React 收不到 animationend（已实测），
      // 这里验证的正是兜底路径，同时断言不会重复回调。
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(onClose).toHaveBeenCalledTimes(1);

      fireEvent(card, new Event('animationend', { bubbles: true }));
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(onClose).toHaveBeenCalledTimes(1); // 两条路径共用 closeOnce
    } finally {
      vi.useRealTimers();
    }
  });

  // 回归守卫：曾用 `-webkit-line-clamp` + `display:-webkit-box` 让文案换成两行，
  // 但该 display 在「纵向 flex + align-items:flex-start」的子项上宽度会算成 0——
  // 文字仍在 DOM 里（查询查得到）却整段不可见，比截断更糟，单测查不出来。
  // 这里直接盯住样式表。
  test('文案样式不得使用 -webkit-box 截断，且必须撑满列宽', () => {
    // 先剥掉注释：注释里正解释了「为什么不要用」，直接匹配会误伤。
    const css = fs
      .readFileSync('src/components/Toast.css', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // 全表都不该出现行数截断写法
    expect(css).not.toMatch(/-webkit-line-clamp|line-clamp/);
    expect(css).not.toMatch(/display:\s*-webkit-box/);
    // 承载文案的那条规则必须显式撑满列宽（块级子项默认按内容宽度收缩，长文案会被裁）
    const layout = (css.match(/\.toast-card__message,\s*\.toast-card__sub\s*\{[^}]*\}/) || [''])[0];
    expect(layout).not.toBe('');
    expect(layout).toMatch(/width:\s*100%/);
    expect(layout).toMatch(/overflow-wrap/);
  });
});
