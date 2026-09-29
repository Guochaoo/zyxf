import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../components/ErrorBoundary.jsx';

// 抛不抛错由模块级开关控制：ErrorBoundary 的「重试」是原地 setState({error:null}) 后
// 重新渲染子树——子组件会再挂载一次，只有这种外部开关能在不改 props 的前提下让第二次渲染成功。
let failing = true;
let renders = 0;
function Bomb() {
  renders += 1;
  if (failing) throw new Error('渲染失败');
  return <p>子组件正常内容</p>;
}

beforeEach(() => {
  failing = true;
  renders = 0;
  // React 会把捕获到的错误再打一遍到 console.error（componentDidCatch 也自己打一条），
  // 不静音的话每次用例都会刷一大段预期内的错误堆栈。
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary 兜底与复位', () => {
  test('子组件抛错时渲染可恢复的兜底界面（标题 + 提示 + 两个按钮）', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText('页面出了点问题')).toBeInTheDocument();
    expect(screen.getByText(/刷新一下通常就能恢复/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeInTheDocument();
    // 兜底期间子树整体不渲染，不会继续把错误扩散出去
    expect(screen.queryByText('子组件正常内容')).toBeNull();
    // componentDidCatch 的日志前缀（排查线上白屏时靠它区分哪一层边界接住的）
    expect(console.error).toHaveBeenCalledWith('[ErrorBoundary]', expect.anything(), expect.anything());
  });

  test('点「重试」清空 error 状态后，子组件被重新渲染出正常内容', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    expect(renders).toBeGreaterThan(0);
    const beforeRetry = renders;

    // 模拟「故障已消失」（例如子组件依赖的数据/接口恢复了）
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(screen.getByText('子组件正常内容')).toBeInTheDocument();
    expect(screen.queryByText('页面出了点问题')).toBeNull();
    // 子树是真被重新挂载了一次，而不是把旧树原样还原
    expect(renders).toBeGreaterThan(beforeRetry);
  });

  test('故障未排除时点「重试」仍回到兜底界面（不会把失败当成已恢复）', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    const beforeRetry = renders;

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(screen.getByText('页面出了点问题')).toBeInTheDocument();
    expect(screen.queryByText('子组件正常内容')).toBeNull();
    expect(renders).toBeGreaterThan(beforeRetry);
  });

  test('兜底只覆盖自己这棵子树：外层与兄弟内容照常渲染', () => {
    render(
      <div>
        <p>外层内容</p>
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
        <p>兄弟内容</p>
      </div>
    );

    expect(screen.getByText('页面出了点问题')).toBeInTheDocument();
    expect(screen.getByText('外层内容')).toBeInTheDocument();
    expect(screen.getByText('兄弟内容')).toBeInTheDocument();
  });
});
