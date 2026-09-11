import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { adminBypassLimiter } from '../limiter.js';
import { enqueueAll, enqueueFile, indexStatus, pendingCount } from '../indexPipeline.js';
import { cosine, isEmbeddingEnabled, MODEL_NAME, VECTOR_DIM } from '../embed.js';
import { wrapAsync } from '../http.js';

const router = Router();

// 语义图谱数据要读全库向量并两两算相似度，比普通 JSON 接口重得多；
// 与 sync/chat 同口径分层限流，避免匿名刷爆（内容视图是登录后主要在用的页面）。
const semanticsLimiter = adminBypassLimiter(60 * 1000, 30, '图谱数据请求过于频繁，请稍后再试');

/**
 * 向量缓存：一次把全库向量读进内存。
 * 850 个文件 × 512 维 float32 ≈ 1.7 MB，全量点积约 44 万次乘加 —— 比每次查询都回表快得多，
 * 也远小于引入 ANN 索引（hnsw / sqlite-vec）的复杂度。库规模上到几万条再考虑换索引。
 */
let vectorCache = { list: null, at: 0 };
const VECTOR_CACHE_MS = 60 * 1000;

function loadVectors() {
  const now = Date.now();
  if (vectorCache.list && now - vectorCache.at < VECTOR_CACHE_MS) return vectorCache.list;
  const rows = db
    .prepare(
      `SELECT e.file_id, e.vec, e.dim, f.name, f.folder_id
       FROM file_embeddings e JOIN files f ON f.id = e.file_id`
    )
    .all();
  // 全库向量拷进**一块** ArrayBuffer，再用 subarray 切视图：各自是独立向量，但只占一块内存。
  // （早先每个文件 new 一个 Float32Array，高频请求下会持续制造 MB 级垃圾）
  const usable = rows.filter((r) => r.dim > 0 && r.vec.length >= r.dim * 4);
  const all = new Float32Array(new ArrayBuffer(usable.length * VECTOR_DIM * 4));
  const list = usable.map((r, i) => {
    all.set(new Float32Array(r.vec.buffer, r.vec.byteOffset, r.dim), i * VECTOR_DIM);
    return {
      id: r.file_id,
      name: r.name,
      folder_id: r.folder_id,
      vec: all.subarray(i * VECTOR_DIM, (i + 1) * VECTOR_DIM),
    };
  });
  vectorCache = { list, at: now };
  return list;
}

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
 * 图谱内容视图的数据：后端算好「每个文件最相似的 K 个邻居」再回传。
 * 不把全库向量交给前端（850×512 float32 base64 ≈ 2.3 MB），也不让前端做 O(n²) 比较。
 */
router.get('/semantics', semanticsLimiter, (req, res) => {
  // 连线阈值放到 0.6（让前端还能看到较弱的相似），成簇阈值由前端按真实分布定（0.78）：
  // 实测低于 0.75 时链式效应会把上百个「南卷汇」跨学科试卷集串成一个簇。
  const k = Math.min(20, Math.max(1, Number(req.query.k) || 8));
  const minSim = Math.min(0.99, Math.max(0.5, Number(req.query.min) || 0.6));
  const rows = loadVectors();
  if (!rows.length) {
    return res.json({
      enabled: isEmbeddingEnabled(),
      model: MODEL_NAME,
      files: 0,
      edges: [],
      labels: {},
      hint: isEmbeddingEnabled()
        ? '尚未建立内容索引'
        : '未安装嵌入模型，内容视图不可用',
    });
  }

  const labels = new Map(); // 簇标签：用文件名与目录名兜底，无 LLM 时也能读
  for (const r of rows) labels.set(r.id, labelFor(r));

  const edges = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const best = [];
    for (let j = 0; j < rows.length; j += 1) {
      if (i === j) continue;
      const sim = cosine(rows[i].vec, rows[j].vec);
      if (sim >= minSim) best.push({ j, sim });
    }
    best.sort((a, b) => b.sim - a.sim);
    // 每节点只留 top-K：不设 K 时相似边会稠密到无法阅读（一个文件可能和几十个都过阈值）
    for (const { j, sim } of best.slice(0, k)) {
      const a = Math.min(rows[i].id, rows[j].id);
      const b = Math.max(rows[i].id, rows[j].id);
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: rows[i].id, target: rows[j].id, weight: Number(sim.toFixed(3)) });
    }
  }

  res.json({
    enabled: true,
    model: MODEL_NAME,
    files: rows.length,
    edges,
    labels: Object.fromEntries(labels),
  });
});

/** 节点标签（无 LLM）：取文件所在目录名；根目录文件回落到文件名主干。 */
function labelFor(row) {
  if (row.folder_id) {
    const folder = db.prepare('SELECT name FROM folders WHERE id = ?').get(row.folder_id);
    if (folder?.name) return folder.name;
  }
  return String(row.name || '').replace(/\.[^.]+$/, '').slice(0, 16);
}

export default router;
