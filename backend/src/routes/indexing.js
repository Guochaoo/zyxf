import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { adminBypassLimiter } from '../limiter.js';
import { enqueueAll, enqueueFile, indexStatus, pendingCount } from '../indexPipeline.js';
import { getTaxonomy } from '../semanticTaxonomy.js';
import { wrapAsync } from '../http.js';

const router = Router();

// 分类要读全库向量做 k-means（首次还会调 LLM 命名），比普通 JSON 接口重；
// 与 sync/chat 同口径分层限流，避免匿名刷爆。
const taxonomyLimiter = adminBypassLimiter(60 * 1000, 30, '图谱数据请求过于频繁，请稍后再试');

/** 索引状态与覆盖率（运维用；匿名也能看，便于前端提示「正在建立索引」）。 */
router.get('/status', (req, res) => {
  const status = indexStatus();
  // 失败清单含文件路径与错误详情，只给管理员看
  if (!req.user) delete status.failures;
  res.json(status);
});

/** 入队：单文件重建（管理员） */
router.post('/rebuild/:fileId', requireAdmin, (req, res) => {
  const id = Number(req.params.fileId);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '无效的文件 ID' });
  const queued = enqueueFile(id, { force: true });
  res.json({ queued, pending: pendingCount() });
});

/** 入队：全量/增量重建（管理员）。增量只排没有抽取记录的文件。 */
router.post('/rebuild', requireAdmin, (req, res) => {
  const force = req.body?.force === true;
  const queued = enqueueAll({ force });
  res.json({ queued, force, pending: pendingCount() });
});

/**
 * 内容语义分类：图谱「内容视图」的组织方式。
 * 结构 = 顶层学科目录（大类）→ 目录内按内容向量细分；细分名字由 LLM 起（缓存，可回落）。
 * 只回结构（fileId 列表 + 名字），不回向量。
 */
router.get('/taxonomy', taxonomyLimiter, wrapAsync(async (req, res) => {
  const taxonomy = await getTaxonomy({ refresh: req.query.refresh === '1' });
  // 前端按 id 找标签：目录节点看 folder:<id>，细分节点看 cluster:<key>
  const labels = {};
  for (const g of taxonomy.groups) {
    labels[`subject:${g.subjectId}`] = g.subject;
    const folder = db
      .prepare('SELECT id FROM folders WHERE name = ? AND parent_id IS NULL')
      .get(g.subject);
    if (folder) labels[`folder:${folder.id}`] = g.subject;
    for (const c of g.clusters) labels[`cluster:${c.key}`] = c.name || null;
  }
  res.json({
    enabled: true,
    model: taxonomy.model,
    llm: Boolean(taxonomy.llm),
    cached: Boolean(taxonomy.cached),
    files: taxonomy.files,
    // 索引是异步的：刚上传的文件在向量生成前不会出现在分类里。
    // 把待处理数回给前端，让它提示「正在建立索引」并稍后自动重拉，而不是让用户以为文件丢了。
    pending: pendingCount(),
    groups: taxonomy.groups,
    labels,
  });
}));

/** 管理员：强制重算分类（改过算法、或想让 LLM 重新命名时用）。 */
router.post('/taxonomy/refresh', requireAdmin, wrapAsync(async (_req, res) => {
  const taxonomy = await getTaxonomy({ refresh: true });
  res.json({ ok: true, groups: taxonomy.groups.length, llm: Boolean(taxonomy.llm) });
}));

export default router;
