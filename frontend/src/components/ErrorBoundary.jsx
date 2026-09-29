import { Component } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * ErrorBoundary（IMPROVE-55）：懒 chunk 加载失败（发版后旧 chunk 404、网络切换）
 * 或某个页面渲染抛错时，原先会整树卸载只剩白屏兜底；现在在路由出口拦住，
 * 给出可恢复的报错界面。main.jsx 的 window error 监听仍是最后防线。
 */

// 懒 chunk 加载失败的文案特征（各浏览器/打包器写法不同）：命中它说明「原地重试」根本没戏。
// React.lazy 会把失败的 import 缓存在模块级 payload 上（_status=2、_result=error），之后每次
// 渲染都直接重新抛出同一个错误——清边界 state 只是让它再抛一次，动态 import 不会重发
// （issue #63）。所以这类失败必须整页重载才可能恢复。
const CHUNK_ERROR_RE =
  /Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|dynamically imported module/iu;

export const isChunkLoadError = (err) =>
  CHUNK_ERROR_RE.test(String(err?.message || err?.name || err || ''));

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
      // 组件新增——渲染期错误原地重置组件树即可，chunk 失败只能整页重载。
      const chunkFailed = isChunkLoadError(this.state.error);
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 py-24 text-center">
          <p className="text-sm text-red">{this.props.t('common.bootErrorTitle')}</p>
          <p className="max-w-md text-xs text-ink-3">{this.props.t('common.bootErrorHint')}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (chunkFailed) this.props.onHardReload();
                else this.setState({ error: null });
              }}
              className="rounded-[8px] bg-ink px-3 py-1.5 text-[13px] font-medium text-surface transition-opacity hover:opacity-90"
            >
              {this.props.t('common.errorBoundaryRetry')}
            </button>
            <button
              type="button"
              onClick={() => this.props.onHardReload()}
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

// class 组件用不了 hook，包一层函数组件注入 t（onHardReload 同样做成可注入，便于测试——
// jsdom 下 window.location.reload 不可 patch）。
export default function ErrorBoundary({ children, onHardReload = () => window.location.reload() }) {
  const { t } = useTranslation();
  return (
    <ErrorBoundaryImpl t={t} onHardReload={onHardReload}>
      {children}
    </ErrorBoundaryImpl>
  );
}
