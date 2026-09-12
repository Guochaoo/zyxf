import { Component } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * ErrorBoundary（IMPROVE-55）：懒 chunk 加载失败（发版后旧 chunk 404、网络切换）
 * 或某个页面渲染抛错时，原先会整树卸载只剩白屏兜底；现在在路由出口拦住，
 * 给出可恢复的报错界面。main.jsx 的 window error 监听仍是最后防线。
 */
class ErrorBoundaryImpl extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      // 文案复用 bootError 三键（同一场景：前端异常的用户可见提示），重试键为本
      // 组件新增——原地重置组件树，不必整页刷新。
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 py-24 text-center">
          <p className="text-sm text-red">{this.props.t('common.bootErrorTitle')}</p>
          <p className="max-w-md text-xs text-ink-3">{this.props.t('common.bootErrorHint')}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-[8px] bg-ink px-3 py-1.5 text-[13px] font-medium text-surface transition-opacity hover:opacity-90"
            >
              {this.props.t('common.errorBoundaryRetry')}
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-[8px] bg-field px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-hover"
            >
              {this.props.t('common.bootErrorReload')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// class 组件用不了 hook，包一层函数组件注入 t。
export default function ErrorBoundary({ children }) {
  const { t } = useTranslation();
  return <ErrorBoundaryImpl t={t}>{children}</ErrorBoundaryImpl>;
}
