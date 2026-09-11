// 内容分类：按学科缓存的增量行为
//
// 这条链路是「上传新文件之后会怎样」的核心保障：索引是异步的，分类按学科缓存，
// 上传一个文件**只应重算它所在的那个学科**——整库重算会重新 LLM 命名全部细分
// （实测 273 秒），而且是在请求里同步跑。
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.INDEX_POLL_MS = '50';
const { db } = await import('../src/db.js');
const { deriveTaxonomy } = await import('../src/semanticTaxonomy.js');
const { float32ToBlob, VECTOR_DIM } = await import('../src/embed.js');

// 测试环境没有模型：deriveTaxonomy 只做 k-means + 文件名兜底命名（useLlm 传 false 同理）
const KEEP_LLM = false;

let subjectA = null;
let subjectB = null;

/** 造一个维度正确、方向可区分的假向量（不依赖模型，纯占位）。 */
function fakeVec(seed) {
  const v = new Float32Array(VECTOR_DIM);
  v[seed % VECTOR_DIM] = 1;
  v[(seed * 7 + 1) % VECTOR_DIM] = 0.5;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < VECTOR_DIM; i += 1) v[i] /= norm;
  return v;
}

function addSubject(name) {
  return db
    .prepare('INSERT INTO folders (name, parent_id, created_at, sort_order) VALUES (?, NULL, ?, 0)')
    .run(name, Date.now()).lastInsertRowid;
}

function addIndexed(folderId, name, seed) {
  const fileId = db
    .prepare(
      `INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, sort_order, created_at)
       VALUES (?, ?, ?, 1, NULL, 'pdf', 0, ?)`
    )
    .run(folderId, name, `tax/${name}-${seed}`, Date.now()).lastInsertRowid;
  db.prepare(
    'INSERT INTO file_embeddings (file_id, vec, dim, model, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(fileId, float32ToBlob(fakeVec(seed)), VECTOR_DIM, 'test-model', Date.now());
  return fileId;
}

before(() => {
  subjectA = addSubject('分类测试-数学');
  subjectB = addSubject('分类测试-物理');
  // 每个学科各放 5 个已索引文件（≥ MIN_FILES_FOR_SPLIT，才会真的分细分）
  for (let i = 0; i < 5; i += 1) addIndexed(subjectA, `数学资料${i}.pdf`, i);
  for (let i = 0; i < 5; i += 1) addIndexed(subjectB, `物理资料${i}.pdf`, 100 + i);
});

describe('内容分类：按学科缓存与增量重算', () => {
  test('首次全量：每个学科各算一次，产出该学科下的细分', async () => {
    const t = await deriveTaxonomy({ useLlm: KEEP_LLM, refresh: true });
    assert.ok(t.groups.length >= 2);
    assert.equal(t.rebuilt, t.groups.length, '全量时每个学科都要重建');
    assert.equal(t.reused, 0);
    const a = t.groups.find((g) => g.subject === '分类测试-数学');
    assert.ok(a, '数学学科应出现在分类里');
    const members = a.clusters.reduce((n, c) => n + c.fileIds.length, 0);
    assert.equal(members, 5);
    // 细分 key 带学科前缀，保证跨学科不撞
    for (const c of a.clusters) assert.match(c.key, /^\d+:\d+$/);
  });

  test('再次请求：全部命中缓存，不重算任何学科', async () => {
    const t = await deriveTaxonomy({ useLlm: KEEP_LLM });
    assert.equal(t.rebuilt, 0, '没有变化就不该重算');
    assert.ok(t.reused >= 2);
  });

  test('**新增一个文件只重算它所在的学科**（这是「上传之后会怎样」的关键）', async () => {
    const before = await deriveTaxonomy({ useLlm: KEEP_LLM });
    assert.equal(before.rebuilt, 0);
    const total = before.groups.length;

    addIndexed(subjectA, '数学新增资料.pdf', 42);

    const after = await deriveTaxonomy({ useLlm: KEEP_LLM });
    assert.equal(after.rebuilt, 1, '只有数学学科该重算');
    // 其余学科继续复用（重建一个就意味着复用少一个）
    assert.equal(after.reused, total - 1, '物理等其他学科应继续复用缓存');

    // 新文件必须出现在分类里（否则用户会以为上传丢了）
    const a = after.groups.find((g) => g.subject === '分类测试-数学');
    const ids = a.clusters.flatMap((c) => c.fileIds);
    assert.equal(ids.length, 6);
  });

  test('删除文件同样只让那个学科失效', async () => {
    const target = db
      .prepare("SELECT file_id FROM file_embeddings WHERE file_id IN (SELECT id FROM files WHERE name = '数学新增资料.pdf')")
      .get();
    db.prepare('DELETE FROM files WHERE id = ?').run(target.file_id);
    const t = await deriveTaxonomy({ useLlm: KEEP_LLM });
    assert.equal(t.rebuilt, 1);
    const a = t.groups.find((g) => g.subject === '分类测试-数学');
    assert.equal(a.clusters.flatMap((c) => c.fileIds).length, 5);
  });

  test('没有向量的文件不进分类（扫描件/老格式/尚未索引）', async () => {
    const pending = db
      .prepare(
        `INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, sort_order, created_at)
         VALUES (?, '还没索引.pdf', 'tax/pending.pdf', 1, NULL, 'pdf', 0, ?)`
      )
      .run(subjectA, Date.now()).lastInsertRowid;
    const t = await deriveTaxonomy({ useLlm: KEEP_LLM });
    const ids = t.groups.flatMap((g) => g.clusters.flatMap((c) => c.fileIds));
    assert.ok(!ids.includes(pending), '没有向量的文件不该出现在分类里');
    // 也不该让任何学科失效（向量集合没变）
    assert.equal(t.rebuilt, 0);
    db.prepare('DELETE FROM files WHERE id = ?').run(pending);
  });

  test('分类是确定性的：同样输入两次结果完全一致（否则每次刷新都在跳）', async () => {
    const a = await deriveTaxonomy({ useLlm: KEEP_LLM, refresh: true });
    const b = await deriveTaxonomy({ useLlm: KEEP_LLM, refresh: true });
    const shape = (t) =>
      t.groups.map((g) => `${g.subject}:${g.clusters.map((c) => c.fileIds.join('+')).join('|')}`);
    assert.deepEqual(shape(a), shape(b));
  });
});
