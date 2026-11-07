import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';

// 一次渲染的字数上限。几 MB 的纯文本直接塞进 <pre> 会让布局计算卡住几秒，
// 这里只截断「渲染量」，文件本身仍完整取到，截断提示里引导用户下载全文。
const MAX_CHARS = 200_000;

// 校园资料里 GBK/GB18030 编码的 .txt 非常常见（Windows 记事本默认就是 ANSI），
// 按 UTF-8 严格解码会抛错，此时按 GB18030 的超集再解一次。
function decodeBuffer(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('gb18030').decode(buffer);
  }
}

/**
 * TextViewer — 取回文本后按纯文本渲染。
 *
 * 不用 <iframe> 直接嵌 txt 的原因：OSS 返回的 Content-Type 不带 charset，
 * 浏览器对 GBK 纯文本的猜测经常是错的（乱码），而且没法跟随站点主题色。
 */
export default function TextViewer({ url, onDownload }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ status: 'loading', text: '', truncated: false });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', text: '', truncated: false });

    fetch(url)
      .then(async (resp) => {
        if (!resp.ok) throw new Error(String(resp.status));
        return decodeBuffer(await resp.arrayBuffer()).replace(/^\uFEFF/, '');
      })
      .then((text) => {
        if (cancelled) return;
        setState(
          text.length > MAX_CHARS
            ? { status: 'ready', text: text.slice(0, MAX_CHARS), truncated: true }
            : { status: 'ready', text, truncated: false }
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', text: '', truncated: false });
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state.status === 'loading') {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-ink-3">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('preview.loading')}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8">
        <div className="text-sm text-ink-2">{t('preview.textFailed')}</div>
        {onDownload && (
          <button
            onClick={onDownload}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
          >
            <Download className="w-4 h-4" />
            {t('preview.downloadFile')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <pre className="p-4 text-sm leading-relaxed text-ink whitespace-pre-wrap break-words font-mono">
        {state.text}
      </pre>
      {state.truncated && (
        <div className="px-4 pb-3 text-xs text-ink-3">{t('preview.truncated')}</div>
      )}
    </div>
  );
}
