import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { DownloadIcon } from '../icons';
import { refreshWebofficeToken } from '../../api.js';

/**
 * OfficeViewer — renders WebOffice via the official IMM JS-SDK.
 *
 * The backend returns WebofficeURL + AccessToken from IMM
 * GenerateWebofficeToken. This component lazily loads the official SDK
 * (g.alicdn.com/IMM/office-js), mounts the editor into the container and sets
 * the token. Access tokens live 30 min; the SDK's refreshToken callback
 * rotates them via the backend (RefreshWebofficeToken) before expiry.
 * Works in desktop browsers and mobile WebViews alike.
 */
const SDK_URL = 'https://g.alicdn.com/IMM/office-js/1.1.19/aliyun-web-office-sdk.min.js';

// Token expiry margins (ms). Access token lives 30 min; refresh it 5 min
// before it dies. After each refresh, wait another 10 min before the next.
const INITIAL_REFRESH_INTERVAL = 25 * 60 * 1000;
const SUBSEQUENT_REFRESH_INTERVAL = 10 * 60 * 1000;

let sdkPromise = null;
function loadSdk() {
  if (window.aliyun?.config) return Promise.resolve(window.aliyun);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-weboffice-sdk]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.aliyun), { once: true });
      existing.addEventListener('error', () => reject(new Error('WebOffice SDK 加载失败')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.dataset.webofficeSdk = '1';
    s.async = true;
    s.onload = () => resolve(window.aliyun);
    s.onerror = () => reject(new Error('WebOffice SDK 加载失败'));
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export default function OfficeViewer({ wbToken, fileId, name, onDownload }) {
  const mountRef = useRef(null);
  const instanceRef = useRef(null);
  const tokenRef = useRef(null);
  const [state, setState] = useState('loading'); // loading | ready | error

  // Keep the latest token pair reachable from the SDK refresh callback.
  useEffect(() => {
    if (!wbToken?.token || !fileId) return;
    tokenRef.current = {
      fileId,
      accessToken: wbToken.token,
      refreshToken: wbToken.refresh_token,
    };
  }, [wbToken, fileId]);

  // Called by the JS-SDK shortly before the access token expires. Returns
  // the fresh token + the delay until the next refresh. On failure (e.g. the
  // 1-day refresh token expired) surface an error and stop the session.
  const handleRefresh = useCallback(async () => {
    const cur = tokenRef.current;
    if (!cur) return { token: '', timeout: SUBSEQUENT_REFRESH_INTERVAL };
    try {
      const data = await refreshWebofficeToken(cur.fileId, cur.accessToken, cur.refreshToken);
      tokenRef.current = {
        ...cur,
        accessToken: data.token,
        refreshToken: data.refresh_token,
      };
      return { token: data.token, timeout: SUBSEQUENT_REFRESH_INTERVAL };
    } catch (e) {
      setState('error');
      throw e;
    }
  }, []);

  useEffect(() => {
    if (!wbToken?.url || !wbToken?.token) return undefined;
    let cancelled = false;
    setState('loading');

    loadSdk()
      .then((aliyun) => {
        if (cancelled || !mountRef.current) return;
        const ins = aliyun.config({
          mount: mountRef.current,
          url: wbToken.url,
          refreshToken: handleRefresh, // Token 过期自动刷新
        });
        ins.setToken({ token: wbToken.token, timeout: INITIAL_REFRESH_INTERVAL });
        instanceRef.current = ins;
        setState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setState('error');
      });

    return () => {
      cancelled = true;
      try {
        instanceRef.current?.destroy?.();
      } catch {
        /* instance already gone */
      }
      instanceRef.current = null;
    };
  }, [wbToken, handleRefresh]);

  if (state === 'error') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3 p-8">
        <div className="text-3xl">⚠️</div>
        <div className="text-sm text-center text-slate-600">预览服务出错，暂时无法在线预览</div>
        <div className="text-xs text-slate-400 text-center">请点击下方按钮直接下载文件查看</div>
        <button
          onClick={onDownload}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
        >
          <DownloadIcon className="w-4 h-4" />
          下载文件
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 bg-white">
      {state === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
          <div className="text-xs text-slate-400">文档加载中，首次加载可能需要较长时间…</div>
        </div>
      )}
      <div ref={mountRef} className="absolute inset-0 z-0" aria-label={name} />
    </div>
  );
}
