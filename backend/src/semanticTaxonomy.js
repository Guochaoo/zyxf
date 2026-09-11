/**
 * 内容语义分类（图谱「内容视图」的组织方式）。
 *
 * 目标：不再按目录摊开，而是**按内容把资料归到学科 → 细分**里，细分节点由内容自己产生。
 *
 * 两级的来源（这是实测出来的取舍，见 docs/ISSUES.md 的 IMPROVE-40）：
 *   - **大类 = 顶层目录**（数学/物理/化学…）。试过让向量自己产生大类：k-means 的簇心之间
 *     余弦普遍 >0.9，按簇心相似度归并时 0.72 就把 518 个文件里的 447 个并成一坨，
 *     0.82 仍有 366 个——两层结构从向量几何里长不出来。顶层目录本身是可靠的人工学科划分，
 *     拿它当骨架反而稳。
 *   - **细分 = 单个学科目录内部做 k-means**（余弦距离）。这一层向量很有效：生命科学基础
 *     分出「代谢 / 细胞信号 / 中心法则」，高数上分出「积分 / 中值定理 / 小助手系列」。
 *   - **细分名字**：优先 LLM 按簇内文件给一个 2-6 字中文名（一次索引只调一次、落库缓存，
 *     失败不影响结构）；没有 LLM 时回落到「文件名里本簇独有、其他簇不出现」的词。
 *
 * 全程确定性（k-means++ 用低差异序列而非随机数），同一份向量跑两次结果一致。
 */

import { db } from './db.js';
import { blobToFloat32, cosine, isEmbeddingEnabled, MODEL_NAME, VECTOR_DIM } from './embed.js';
import { chatStream, isLlmEnabled } from './llm.js';
// 细分粒度：大约每 8 个文件一个细分，[1, 5] 之间；文件少的学科退化成一个细分
const FILES_PER_CLUSTER = 8;
export const MAX_CLUSTERS = 5;
const MIN_FILES_FOR_SPLIT = 4;
export const TAXONOMY_VERSION = 1; // 算法或参数变化时递增，触发重算
const MAX_LLM_CALLS = 200; // 极端情况下的兜底上限

/* ---------------- k-means（余弦） ---------------- */

function kmeans(vectors, k, iters = 30) {
  const n = vectors.length;
  if (n <= k) {
    return { assign: vectors.map((_, i) => i), centroids: vectors.map((v) => Float32Array.from(v)) };
  }
  // k-means++ 用低差异序列挑初始中心：不引随机数，保证同样输入同样结果
  const centroids = [Float32Array.from(vectors[0])];
  while (centroids.length < k) {
    const weights = vectors.map((v) => {
      let best = -Infinity;
      for (const c of centroids) best = Math.max(best, cosine(v, c));
      return Math.max(0, 1 - best);
    });
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let target = (centroids.length * 0.6180339887) % 1;
    let picked = 0;
    for (let i = 0; i < n; i += 1) {
      target -= weights[i] / total;
      if (target <= 0) {
        picked = i;
        break;
      }
    }
    centroids.push(Float32Array.from(vectors[picked]));
  }

  const assign = new Array(n).fill(-1);
  for (let iter = 0; iter < iters; iter += 1) {
    for (let i = 0; i < n; i += 1) {
      let best = -Infinity;
      let bestK = 0;
      for (let c = 0; c < centroids.length; c += 1) {
        const s = cosine(vectors[i], centroids[c]);
        if (s > best) {
          best = s;
          bestK = c;
        }
      }
      assign[i] = bestK;
    }
    const sums = centroids.map(() => new Float64Array(VECTOR_DIM));
    const counts = centroids.map(() => 0);
    for (let i = 0; i < n; i += 1) {
      counts[assign[i]] += 1;
      for (let d = 0; d < VECTOR_DIM; d += 1) sums[assign[i]][d] += vectors[i][d];
    }
    for (let c = 0; c < centroids.length; c += 1) {
      if (!counts[c]) continue;
      let norm = 0;
      for (let d = 0; d < VECTOR_DIM; d += 1) {
        centroids[c][d] = sums[c][d] / counts[c];
        norm += centroids[c][d] * centroids[c][d];
      }
      norm = Math.sqrt(norm) || 1;
      for (let d = 0; d < VECTOR_DIM; d += 1) centroids[c][d] /= norm;
    }
  }
  return { assign, centroids };
}

/* ---------------- 名字的确定性兜底：文件名里的「本簇独有词」 ---------------- */

const STOP_CHARS = new Set([...'与和及或的之等中第年级版次末卷参答总汇复讲']);
const STOP_WORDS = new Set([
  '讲义', '课件', '资料', '往年题', '真题', '试题', '答案', '参考答案', '参考', '作业', '习题',
  '练习', '复习', '期末', '期中', '考试', '上机', '教材', '教辅', '笔记', '总结', '汇总', '基础',
  '重点', '难点', '典型', '题解', '课堂', '随堂', '课程', '讲稿', '试卷', '大纲', '提纲', '解答',
  '例题', '自测题', '样卷', '样题', '知识点', '梳理', '部分', '全套', '最新', '完整', '大学',
]);

/** 文件名 → 候选词（中文 2/3-gram + 拉丁词，去掉扩展名与套话） */
export function nameTokens(name) {
  const s = String(name || '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .normalize('NFKC')
    .replace(/[_\-.,+·、()（）[\]【】《》<>"'~!?=:;|\\/]+/g, ' ')
    .toLowerCase();
  const out = new Set();
  const han = [];
  for (const w of s.split(' ')) {
    han.push(...[...w].filter((c) => /[\u4e00-\u9fff]/.test(c)));
    if (/^[a-z][a-z0-9]*$/.test(w) && w.length >= 3) out.add(w);
  }
  for (let i = 0; i < han.length - 1; i += 1) {
    if (!STOP_CHARS.has(han[i]) && !STOP_CHARS.has(han[i + 1])) out.add(han[i] + han[i + 1]);
  }
  for (let i = 0; i < han.length - 2; i += 1) {
    if (!STOP_CHARS.has(han[i]) && !STOP_CHARS.has(han[i + 1]) && !STOP_CHARS.has(han[i + 2])) {
      out.add(han[i] + han[i + 1] + han[i + 2]);
    }
  }
  for (const t of [...out]) {
    if (STOP_WORDS.has(t) || /^(19|20)\d\d$/.test(t)) out.delete(t);
  }
  return out;
}

/**
 * 给一个学科内的若干细分起名：取「本簇覆盖高、其他簇不出现」的词。
 * 起不出名字时返回 null（前端会显示「N 个文件」而不是编一个名字）。
 */
export function fallbackNames(clusters, names) {
  const clusterOf = new Map();
  clusters.forEach((members, c) => {
    const seen = new Set();
    for (const i of members) {
      for (const w of nameTokens(names[i])) seen.add(w);
    }
    clusterOf.set(c, seen);
  });
  return clusters.map((members, c) => {
    if (members.length < 2) return null;
    const mine = clusterOf.get(c);
    if (!mine) return null;
    const hit = new Map();
    for (const i of members) {
      for (const w of nameTokens(names[i])) hit.set(w, (hit.get(w) || 0) + 1);
    }
    const candidates = [...hit.entries()]
      .filter(([w, n]) => n / members.length >= 0.5)
      .filter(([w]) => {
        // 其他簇里也出现的词不具区分度
        for (const [other, set] of clusterOf) if (other !== c && set.has(w)) return false;
        return true;
      })
      .map(([w, n]) => ({ w, cover: n / members.length, len: [...w].length }))
      .sort((a, b) => b.cover - a.cover || b.len - a.len || (a.w < b.w ? -1 : 1));
    return candidates[0]?.w || null;
  });
}

/* ---------------- LLM 命名（可缺省） ---------------- */

/**
 * 一次索引只调一次：把每个细分的样本文名交给模型起名。
 * 失败/未配置就整批回落，不阻塞、不影响结构。
 */
async function llmNames(subject, clusters, names, summaries = []) {
  if (!isLlmEnabled()) return null;
  const lines = [`学科：${subject}`, ''];
  clusters.forEach((members, c) => {
    lines.push(`细分 ${c + 1}（${members.length} 个文件）：`);
    for (const i of members.slice(0, 6)) lines.push(`  - ${names[i]}`);
    if (summaries[c]) lines.push(`  内容关键词：${summaries[c]}`);
  });
  lines.push(
    '',
    '给每个细分起一个 2-6 个汉字的分类名（例如：线性代数 / 概率论 / 积分与极限 / 电路分析 / 军事理论）。',
    '只用给定信息判断，不要编造学科；实在无法判断时用该细分最具体的共同特征命名。',
    '严格输出 JSON：{"names":[{"index":1,"name":"..."}]}，index 从 1 开始，不要输出其他内容。'
  );
  try {
    let text = '';
    for await (const ev of chatStream({
      messages: [
        { role: 'system', content: '你是资料库的分类助手，只输出要求的 JSON。' },
        { role: 'user', content: lines.join('\n') },
      ],
    })) {
      if (ev.type === 'delta') text += ev.text;
      if (text.length > 4000) break;
    }
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const out = clusters.map(() => null);
    for (const item of parsed.names || []) {
      const idx = Number(item.index) - 1;
      if (idx >= 0 && idx < out.length && typeof item.name === 'string') {
        out[idx] = item.name.trim().slice(0, 12) || null;
      }
    }
    return out;
  } catch {
    return null; // 上游报错就整批回落，不重试、不抛给调用方
  }
}

/* ---------------- 组装分类 ---------------- */

function subjectOf(file) {
  // 文件的顶层学科目录：沿 parent_id 上溯到根
  let folderId = file.folder_id;
  let top = null;
  let guard = 0;
  while (folderId && guard < 50) {
    const row = db.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?').get(folderId);
    if (!row) break;
    top = row;
    folderId = row.parent_id;
    guard += 1;
  }
  return top ? { id: top.id, name: top.name } : { id: 0, name: '根目录' };
}

/**
 * 计算整库的内容分类（不写库）。
 * @returns {{ version, labels: Record<string, string>, groups: Array, files: number }}
 *   groups: [{ subjectId, subject, clusters: [{ key, name, fileIds }] }]
 */
export async function deriveTaxonomy({ useLlm = true } = {}) {
  const rows = db
    .prepare(
      `SELECT e.file_id id, e.vec, e.dim, f.name, f.folder_id
       FROM file_embeddings e JOIN files f ON f.id = e.file_id`
    )
    .all();
  if (!rows.length) {
    return { version: TAXONOMY_VERSION, model: MODEL_NAME, labels: {}, groups: [], files: 0 };
  }

  const bySubject = new Map();
  const meta = new Map();
  for (const r of rows) {
    const subject = subjectOf(r);
    const key = subject.id;
    if (!bySubject.has(key)) bySubject.set(key, { ...subject, rows: [] });
    bySubject.get(key).rows.push(r);
    meta.set(r.id, r);
  }

  const out = [];
  let llmBudget = MAX_LLM_CALLS;
  for (const [key, group] of bySubject) {
    const list = group.rows.slice().sort((a, b) => a.id - b.id); // 稳定顺序
    const vectors = list.map((r) => blobToFloat32(r.vec));
    const k =
      list.length < MIN_FILES_FOR_SPLIT
        ? 1
        : Math.max(1, Math.min(MAX_CLUSTERS, Math.round(list.length / FILES_PER_CLUSTER)));
    const { assign } = kmeans(vectors, k);
    const clusters = Array.from({ length: k }, (_, c) => list.map((_, i) => i).filter((i) => assign[i] === c));
    const names = list.map((r) => r.name);

    let labels = fallbackNames(clusters, names);
    if (useLlm && llmBudget > 0 && k > 1) {
      llmBudget -= 1;
      const fromLlm = await llmNames(group.name, clusters, names);
      if (fromLlm) labels = labels.map((f, i) => fromLlm[i] || f);
    }

    // 细分按成员数排序（稳定），单成员的细分不建节点、文件直接挂在学科下
    const built = clusters
      .map((members, c) => ({ members, name: labels[c] || null }))
      .filter((c) => c.members.length > 0)
      .sort((a, b) => b.members.length - a.members.length || a.members[0] - b.members[0])
      .map((c, idx) => ({
        key: `${key}:${idx}`,
        name: c.name,
        fileIds: c.members.map((i) => list[i].id),
      }));

    out.push({ subjectId: key, subject: group.name, clusters: built });
  }

  // 大类按文件数降序、根目录排最后
  out.sort((a, b) => {
    const sa = a.clusters.reduce((n, c) => n + c.fileIds.length, 0);
    const sb = b.clusters.reduce((n, c) => n + c.fileIds.length, 0);
    return sb - sa || (a.subject < b.subject ? -1 : 1);
  });

  const labels = {};
  for (const g of out) for (const c of g.clusters) if (c.name) labels[c.key] = c.name;
  return {
    version: TAXONOMY_VERSION,
    model: MODEL_NAME,
    llm: isLlmEnabled() && useLlm,
    labels,
    groups: out,
    files: rows.length,
  };
}

export function isTaxonomyAvailable() {
  return isEmbeddingEnabled();
}

/** 指纹：向量集合变了（新增/重算）或算法版本变了就失效。用「数量 + 最新时间 + 版本」足够便宜。 */
function fingerprint() {
  const row = db
    .prepare('SELECT COUNT(*) c, COALESCE(MAX(created_at), 0) t FROM file_embeddings')
    .get();
  return `${TAXONOMY_VERSION}:${row.c}:${row.t}`;
}

/**
 * 读取分类：命中缓存直接返回；否则重算并落库。
 * 分类是整库级别、变化很慢的数据，缓存让「切档看图」不再触发 k-means 与 LLM 调用。
 */
export async function getTaxonomy({ refresh = false, useLlm = true } = {}) {
  const fp = fingerprint();
  if (!refresh) {
    const cached = db.prepare('SELECT version, fingerprint, payload FROM taxonomy_cache WHERE id = 1').get();
    if (cached && cached.version === TAXONOMY_VERSION && cached.fingerprint === fp) {
      try {
        const payload = JSON.parse(cached.payload);
        payload.cached = true;
        return payload;
      } catch {
        /* 缓存坏了就重算 */
      }
    }
  }
  const payload = await deriveTaxonomy({ useLlm });
  try {
    db.prepare(
      `INSERT INTO taxonomy_cache (id, version, fingerprint, payload, created_at) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET version = excluded.version, fingerprint = excluded.fingerprint,
         payload = excluded.payload, created_at = excluded.created_at`
    ).run(TAXONOMY_VERSION, fp, JSON.stringify({ ...payload, cached: false }), Date.now());
  } catch (e) {
    console.warn('[taxonomy] 缓存写入失败（不影响本次返回）:', e.message);
  }
  return { ...payload, cached: false };
}

export const TAXONOMY_CONST = { FILES_PER_CLUSTER, MIN_FILES_FOR_SPLIT };
