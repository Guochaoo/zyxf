// BrowsePage 的 OSS 同步 hook（IMPROVE-01 拆分）：同步共享 bucket 后重载当前文件夹，
// 结果交给顶部 Toast 展示。`id` 供调用方做 key：连续两次同步文案相同时必须重挂载，
// 否则 Toast 沿用上一次的关闭定时器。
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { syncOss } from '../../api.js';
import { errMsg, notifyFoldersChanged } from '../../utils.js';

export function useOssSync(refresh) {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState(null); // { id, ok, message, sub }
  const noticeIdRef = useRef(0);
  const showSyncMsg = ({ message, sub, ok = true }) =>
    setSyncNotice({ id: (noticeIdRef.current += 1), ok, message, sub });
  const clearSyncNotice = () => setSyncNotice(null);

  const onSyncRefresh = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await syncOss();
      notifyFoldersChanged();
      const a = r.added || {};
      const rm = r.removed || {};
      const changed = Boolean(a.files || a.folders || rm.files);
      // 主行只放「同步完成」这类短标题，明细交给副行——Toast 主行两行后即省略，
      // 原先整句塞在主行会显示不全（卡片文字区仅约 200px）。
      showSyncMsg({
        message: t('browse.syncDone'),
        sub: changed
          ? t('browse.syncDetail', {
              folders: a.folders || 0,
              files: a.files || 0,
              removed: rm.files || 0,
            })
          : t('browse.syncNone'),
      });
    } catch (e) {
      showSyncMsg({ message: errMsg(e, t('browse.syncError')), ok: false });
    } finally {
      setSyncing(false);
      refresh();
    }
  };

  return { syncing, syncNotice, clearSyncNotice, onSyncRefresh };
}
