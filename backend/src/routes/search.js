import { Router } from 'express';
import { searchLibrary, MAX_QUERY_LEN } from '../searchService.js';
import { tieredLimiter } from '../limiter.js';

// IMPROVE-32：/api/search 是全库同步扫描（命中拉丁串时还进 pinyin-pro 的 DP），
// 原先只靠 index.js 的全局兜底（300 次/分钟/IP）。这里挂专属的分层配额：
// 游客 60 次/分钟 · 登录用户 240 次/分钟（按 user id 计数，不占出口 IP 配额）· 管理员豁免。
// 数值刻意留了余量：SearchBar 是 250ms 防抖的逐次请求，校园 NAT 下游客共用 IP，
// 收到 429 应是「明显滥用」而不是正常打字（仍比全局兜底紧 5 倍）。
// 注：chat.js 的 AI 工具直接调 searchService 函数、不走这条 HTTP 路径，不受限流影响。
const searchLimiter = tieredLimiter({
  windowMs: 60 * 1000,
  guest: 60,
  user: 240,
  message: '搜索过于频繁，请稍后再试',
});

const router = Router();

router.get('/', searchLimiter, (req, res) => {
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
