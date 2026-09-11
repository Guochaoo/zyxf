import { Router } from 'express';
import { searchLibrary, MAX_QUERY_LEN } from '../searchService.js';

const router = Router();

router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  // IMPROVE-20：结果带 truncated 标志，前端据此显示「显示 20 / 共 N 条」而不是把截断值当总数。
  if (!q) return res.json({ folders: [], files: [], truncated: false });
  // 超长直接拒绝而不截断：匹配是全库同步扫描 + 拼音 DP，一条请求就能占住事件循环
  // （实测 8000 字查询 ≈ 2.3 s）。截断则会让用户以为搜的是整串，语义更糟。
  if (q.length > MAX_QUERY_LEN) {
    return res.status(400).json({ error: `搜索关键词过长（最多 ${MAX_QUERY_LEN} 个字符）` });
  }
  res.json(searchLibrary(q));
});

export default router;
