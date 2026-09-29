import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { lazy, Suspense } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary, { isChunkLoadError } from '../components/ErrorBoundary.jsx';

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

// issue #63：懒 chunk 失败时「重试」原先只清边界 state，而 React.lazy 会把失败的 import
// 缓存在模块级 payload 上（_status=2），再渲染只是把同一个错误重新抛出——动态 import 根本
// 不会重发，按钮是死键、只有「刷新页面」能恢复。这类失败现在直接走整页重载。
describe('ErrorBoundary 的 chunk 失败重试语义（issue #63）', () => {
  test('isChunkLoadError 认得各浏览器/打包器的文案，普通错误不误判', () => {
    for (const msg of [
      'Loading chunk 5 failed.',
      'Loading CSS chunk 3 failed.',
      'Failed to fetch dynamically imported module: https://zyxf.top/assets/x.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
    ]) {
      expect(isChunkLoadError(new Error(msg)), msg).toBe(true);
    }
    for (const other of ['渲染失败', '', undefined, null, { name: 'TypeError' }]) {
      expect(isChunkLoadError(other)).toBe(false);
    }
  });

  test('懒 chunk 失败：点「重试」走整页重载（原地重试不可能恢复）', async () => {
    let attempts = 0;
    const Lazy = lazy(() => {
      attempts += 1;
      return Promise.reject(new Error('Loading chunk 7 failed.'));
    });
    const onHardReload = vi.fn();

    render(
      <ErrorBoundary onHardReload={onHardReload}>
        <Suspense fallback={<p>加载中</p>}>
          <Lazy />
        </Suspense>
      </ErrorBoundary>
    );

    fireEvent.click(await screen.findByRole('button', { name: '重试' }));

    // 走的是重载而不是复位；动态 import 只发起过一次（失败结果被 lazy 缓存）
    expect(onHardReload).toHaveBeenCalledTimes(1);
    expect(attempts).toBe(1);
    // 因为测试里没有真的重载，兜底仍在——这正是「原地重试救不回来」的证据
    expect(screen.getByText('页面出了点问题')).toBeInTheDocument();
  });

  test('渲染期错误：点「重试」仍原地复位（不误触发整页重载）', () => {
    const onHardReload = vi.fn();
    render(
      <ErrorBoundary onHardReload={onHardReload}>
        <Bomb />
      </ErrorBoundary>
    );

    failing = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(screen.getByText('子组件正常内容')).toBeInTheDocument();
    expect(onHardReload).not.toHaveBeenCalled();
  });

  test('「刷新页面」按钮始终走整页重载', () => {
    const onHardReload = vi.fn();
    render(
      <ErrorBoundary onHardReload={onHardReload}>
        <Bomb />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByRole('button', { name: '刷新页面' }));
    expect(onHardReload).toHaveBeenCalledTimes(1);
  });
});
