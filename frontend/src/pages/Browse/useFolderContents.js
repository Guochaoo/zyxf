// BrowsePage 的数据 hook（IMPROVE-01 拆分）。
// 负责「当前文件夹 + 当前排序」这一次数据请求，以及刷新与排序切换；
// 返回的 data 原样透传后端契约（manual 模式额外含合并视图 items，见 BUG-27）。
// IMPROVE-56：请求去重/取消/缓存下沉到 data/resource.js——返回导航命中缓存
// 即时呈现（后台静默 revalidate），排序切换仍整页 loading（不同 key）。
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listFolder } from '../../api.js';
import { errMsg } from '../../utils.js';
import { useResource } from '../../data/resource.js';

export function useFolderContents(folderId) {
  const { t } = useTranslation();
  const [sort, setSort] = useState('manual');
  const [order, setOrder] = useState('asc');

  const { data, error, loading, reload } = useResource(
    `contents:${folderId}:${sort}:${order}`,
    (_key, { signal }) => listFolder(folderId, sort, order, { signal })
  );

  const refresh = useCallback(() => {
    reload();
  }, [reload]);

  // Manual 模式没有升降序——重复点击同一项是 no-op。
  const toggleSort = (key) => {
    if (sort === key) {
      if (key === 'manual') return;
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setOrder('asc');
    }
  };

  return {
    data,
    // 首次加载（该 key 还没有任何数据）才整页转圈；后台 revalidate 不闪。
    loading: loading && data === undefined,
    err: error ? errMsg(error, t('common.loadFailed')) : '',
    sort,
    order,
    setSort,
    refresh,
    toggleSort,
  };
}
