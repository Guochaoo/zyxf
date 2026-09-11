/**
 * 内容索引流水线：入队 → 下载 → 抽取 → 嵌入 → 落库。
 *
 * 为什么是队列而不是「在请求里同步做」：一次抽取要下载整个对象再解析（实测最大的 PDF
 * 154 MB / 20 s），放在上传或刷新请求里必然超时。这里单并发（解析占 CPU 且 node:sqlite
 * 是同步写）+ 空闲轮询，跑完一轮就停，不会空转。
 *
 * 降级：模型文件缺失时不做嵌入，只抽正文（图谱退回名称层、搜索不受影响），并在
 * /api/index/status 里说明原因——不能因为少一个 20 MB 的模型就让上传或启动失败。
 */

import { db } from './db.js';
import { ossClient } from './oss.js';
import { extractText, contentHash, DOC_KIND, MAX_CONTENT_CHARS } from './textExtract.js';
import {
  embedTexts,
  float32ToBlob,
  isEmbeddingEnabled,
  embeddingLoadError,
  MODEL_NAME,
  VECTOR_DIM,
} from './embed.js';

const IDLE_INTERVAL_MS = Number(process.env.INDEX_POLL_MS) || 8000;
const JITTER_MS = 4000; // 加抖动：多实例/多轮询不撞在一起
const MAX_ATTEMPTS = 3;
const JOB_TIMEOUT_MS = 120_000;
// 每日嵌入配额：防一次误操作（全库重建 × 反复重试）把 CPU 长时间占满。
// 850 个文件的首次全量索引需要 850 次，超过这个数通常意味着出了别的问题。
const DAILY_UNIT_LIMIT = Number(process.env.INDEX_DAILY_LIMIT) || 2000;

let timer = null;
let busy = false;
let started = false;

const today = () => new Date().toISOString().slice(0, 10);

function takeUnit() {
  db.prepare('INSERT OR IGNORE INTO index_usage (day, units) VALUES (?, 0)').run(today());
  const row = db.prepare('SELECT units FROM index_usage WHERE day = ?').get(today());
  if (row.units >= DAILY_UNIT_LIMIT) return false;
  db.prepare('UPDATE index_usage SET units = units + 1 WHERE day = ?').run(today());
  return true;
}

function usedToday() {
  return db.prepare('SELECT units FROM index_usage WHERE day = ?').get(today())?.units || 0;
}

/** 入队：已 done 且内容未变的不重复排。返回是否新增/重置了任务。 */
export function enqueueFile(fileId, { force = false } = {}) {
  const id = Number(fileId);
  if (!Number.isInteger(id) || id <= 0) return false;
  const exists = db.prepare('SELECT 1 FROM files WHERE id = ?').get(id);
  if (!exists) return false;
  const job = db.prepare('SELECT state, attempts FROM index_jobs WHERE file_id = ?').get(id);
  // 已在队列里（pending/running）就没有可做的：连着调用两次（比如上传后手动点重建）
  // 不该把它重复排一遍，也不该把正在跑的那一轮的状态重置掉。
  if (job && (job.state === 'pending' || job.state === 'running') && !force) return false;
  if (job && job.state === 'done' && !force) return false;
  if (job && job.state === 'failed' && !force && job.attempts >= MAX_ATTEMPTS) return false;
  db.prepare(
    `INSERT INTO index_jobs (file_id, state, attempts, enqueued_at, last_error)
     VALUES (?, 'pending', 0, ?, NULL)
     ON CONFLICT(file_id) DO UPDATE SET state = 'pending', attempts = 0, enqueued_at = excluded.enqueued_at, last_error = NULL`
  ).run(id, Date.now());
  return true;
}

/** 全量/增量入队：默认只排「没有抽取记录」的文件，force 时排全部。 */
export function enqueueAll({ force = false } = {}) {
  const rows = force
    ? db.prepare('SELECT id FROM files').all()
    : db
        .prepare(
          `SELECT f.id FROM files f
           LEFT JOIN text_extractions t ON t.file_id = f.id
           WHERE t.file_id IS NULL`
        )
        .all();
  let n = 0;
  for (const r of rows) if (enqueueFile(r.id, { force: true })) n += 1;
  return n;
}

/** 待处理数量（前端据此提示「正在建立索引」）。 */
export function pendingCount() {
  return db.prepare("SELECT COUNT(*) c FROM index_jobs WHERE state IN ('pending','running')").get().c;
}

/** 处理单个任务。抛错表示这一轮失败（由调用方决定重试或记 failed）。 */
async function runJob(job) {
  const file = db.prepare('SELECT id, name, oss_key, ext FROM files WHERE id = ?').get(job.file_id);
  if (!file) {
    // 文件在上传与索引之间被删了：任务随之作废（外键本会级联，这里只兜底）
    db.prepare('DELETE FROM index_jobs WHERE file_id = ?').run(job.file_id);
    return;
  }
  const object = await ossClient().get(file.oss_key);
  const { text, docKind, pages, thinPages } = await extractText({
    buf: object.content,
    ext: file.ext,
  });
  const body = text.slice(0, MAX_CONTENT_CHARS);
  const hash = contentHash(body, docKind);
  const existing = db.prepare('SELECT content_hash FROM text_extractions WHERE file_id = ?').get(file.id);

  db.prepare(
    `INSERT INTO text_extractions (file_id, content, doc_kind, pages, chars, content_hash, extracted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_id) DO UPDATE SET
       content = excluded.content, doc_kind = excluded.doc_kind, pages = excluded.pages,
       chars = excluded.chars, content_hash = excluded.content_hash, extracted_at = excluded.extracted_at`
  ).run(file.id, body, docKind, pages ?? null, body.length, hash, Date.now());

  // 向量：只有真正拿到正文才做；内容没变且已有向量就跳过（省掉重复推理）
  const canEmbed = isEmbeddingEnabled() && body.length >= 30;
  const hasVector = db.prepare('SELECT 1 FROM file_embeddings WHERE file_id = ?').get(file.id);
  if (canEmbed && (!hasVector || existing?.content_hash !== hash)) {
    if (!takeUnit()) throw new Error('已达当日索引配额，明天再继续');
    const [vec] = await embedTexts([`${file.name}\n${body}`]);
    db.prepare(
      `INSERT INTO file_embeddings (file_id, vec, dim, model, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(file_id) DO UPDATE SET vec = excluded.vec, dim = excluded.dim,
         model = excluded.model, created_at = excluded.created_at`
    ).run(file.id, float32ToBlob(vec), VECTOR_DIM, MODEL_NAME, Date.now());
  }
  if (!canEmbed && hasVector && docKind === DOC_KIND.UNSUPPORTED) {
    // 文件被换成了不可抽取的格式：清掉旧向量，否则它还会用旧内容的语义去连线
    db.prepare('DELETE FROM file_embeddings WHERE file_id = ?').run(file.id);
  }

  db.prepare(
    `UPDATE index_jobs SET state = 'done', content_hash = ?, finished_at = ?, last_error = NULL
     WHERE file_id = ?`
  ).run(hash, Date.now(), file.id);
  return { name: file.name, docKind, chars: body.length, pages, thinPages };
}

/** 跑一轮：取一个 pending 任务执行。返回是否真的做了事。 */
async function runOnce() {
  const job = db
    .prepare("SELECT file_id, attempts FROM index_jobs WHERE state = 'pending' ORDER BY enqueued_at LIMIT 1")
    .get();
  if (!job) return false;
  db.prepare("UPDATE index_jobs SET state = 'running' WHERE file_id = ?").run(job.file_id);
  try {
    // 超时守护：OSS 卡住或解析超大 PDF 时不能让任务永远停在 running
    const result = await Promise.race([
      runJob(job),
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error('索引超时')), JOB_TIMEOUT_MS);
        t.unref?.();
      }),
    ]);
    console.log(`[index] #${job.file_id} ${result.docKind} ${result.chars}字 ${result.name}`);
  } catch (e) {
    const attempts = job.attempts + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    db.prepare(
      `UPDATE index_jobs SET state = ?, attempts = ?, last_error = ?, finished_at = ? WHERE file_id = ?`
    ).run(
      failed ? 'failed' : 'pending',
      attempts,
      String(e.message || e).slice(0, 300),
      failed ? Date.now() : null,
      job.file_id
    );
    console.warn(`[index] #${job.file_id} 失败(${attempts}/${MAX_ATTEMPTS}): ${e.message}`);
  }
  return true;
}

function schedule(delay) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, delay);
  timer.unref?.();
}

async function tick() {
  if (busy) return schedule(IDLE_INTERVAL_MS);
  busy = true;
  try {
    // 一轮里连做多个任务，但每做完一个检查是否还有；空闲则退避到下一轮
    let worked = true;
    let rounds = 0;
    while (worked && rounds < 20) {
      worked = await runOnce();
      rounds += 1;
    }
  } catch (e) {
    console.warn('[index] 轮询异常:', e.message);
  } finally {
    busy = false;
  }
  schedule(IDLE_INTERVAL_MS + Math.random() * JITTER_MS);
}

/** 启动 worker（index.js 在数据库初始化后调用一次）。 */
export function startIndexWorker() {
  if (started) return;
  started = true;
  // 进程重启时把上次中断的 running 拉回 pending：否则这些文件永远停在「进行中」
  const reset = db.prepare("UPDATE index_jobs SET state = 'pending' WHERE state = 'running'").run().changes;
  if (reset) console.log(`[index] 复位 ${reset} 个中断任务`);
  if (!isEmbeddingEnabled()) {
    console.warn(
      `[index] 未找到嵌入模型（${embeddingLoadError() || '模型文件缺失'}），只抽正文不出向量；` +
        '下载方式见 docs/DEPLOY.md'
    );
  }
  schedule(1500);
}

/** 运维快照：覆盖率与失败原因。 */
export function indexStatus() {
  const total = db.prepare('SELECT COUNT(*) c FROM files').get().c;
  const byKind = db
    .prepare('SELECT doc_kind kind, COUNT(*) c FROM text_extractions GROUP BY doc_kind')
    .all();
  const jobs = db.prepare('SELECT state, COUNT(*) c FROM index_jobs GROUP BY state').all();
  const vectors = db.prepare('SELECT COUNT(*) c FROM file_embeddings').get().c;
  const failures = db
    .prepare(
      `SELECT j.file_id, f.name, j.attempts, j.last_error FROM index_jobs j
       JOIN files f ON f.id = j.file_id WHERE j.state = 'failed' ORDER BY j.finished_at DESC LIMIT 20`
    )
    .all();
  const kinds = {};
  for (const k of byKind) kinds[k.kind] = k.c;
  const states = {};
  for (const j of jobs) states[j.state] = j.c;
  return {
    embedding: { enabled: isEmbeddingEnabled(), model: MODEL_NAME, dim: VECTOR_DIM, error: embeddingLoadError() },
    totals: { files: total, vectors, extracted: Object.values(kinds).reduce((a, b) => a + b, 0), kinds, states },
    usage: { today: usedToday(), limit: DAILY_UNIT_LIMIT },
    pending: pendingCount(),
    failures,
  };
}
