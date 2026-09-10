// BrowsePage 的数据 hook（IMPROVE-01 拆分）。
// 负责「当前文件夹 + 当前排序」这一次数据请求，以及刷新与排序切换；
// 返回的 data 原样透传后端契约（manual 模式额外含合并视图 items，见 BUG-27）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listFolder } from '../../api.js';
import { errMsg } from '../../utils.js';

export function useFolderContents(folderId) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [sort, setSort] = useState('manual');
  const [order, setOrder] = useState('asc');
  // Refs keep the latest sort/order so refresh() always reads current values,
  // avoiding stale-closure bugs when both setSort and refresh are called together.
  const sortRef = useRef(sort);
  sortRef.current = sort;
  const orderRef = useRef(order);
  orderRef.current = order;

  const refresh = useCallback(() => {
    setLoading(true);
    setErr('');
    listFolder(folderId, sortRef.current, orderRef.current)
      .then(setData)
      .catch((e) => setErr(errMsg(e, t('browse.moveError'))))
      .finally(() => setLoading(false));
  }, [folderId, t]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId, sort, order]);

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

  return { data, loading, err, sort, order, setSort, refresh, toggleSort };
}
