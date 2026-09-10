// BrowsePage 的 OSS 同步 hook（IMPROVE-01 拆分）。
// 顶部「刷新」按钮：把共享 bucket 同步进本地库（多部署共用同一 bucket），
// 再重载当前文件夹；结果用底部胶囊提示 5 秒。
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { syncOss } from '../../api.js';
import { errMsg, notifyFoldersChanged } from '../../utils.js';

export function useOssSync(refresh) {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncMsgOk, setSyncMsgOk] = useState(true);
  const syncTimerRef = useRef(null);
  const showSyncMsg = (msg, ok = true) => {
    setSyncMsg(msg);
    setSyncMsgOk(ok);
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => setSyncMsg(''), 5000);
  };
  useEffect(() => () => clearTimeout(syncTimerRef.current), []);

  const onSyncRefresh = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await syncOss();
      notifyFoldersChanged();
      const a = r.added || {};
      const rm = r.removed || {};
      if (a.files || a.folders || rm.files) {
        showSyncMsg(
          t('browse.syncDone', {
            folders: a.folders || 0,
            files: a.files || 0,
            removed: rm.files || 0,
          })
        );
      } else {
        showSyncMsg(t('browse.syncDone', { folders: 0, files: 0, removed: 0 }));
      }
    } catch (e) {
      showSyncMsg(errMsg(e, t('browse.syncError')), false);
    } finally {
      setSyncing(false);
      refresh();
    }
  };

  return { syncing, syncMsg, syncMsgOk, onSyncRefresh };
}
