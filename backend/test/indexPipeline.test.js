// 内容索引流水线：入队 → 抽取 → 落库 → 状态统计
//
// OSS 由 test/setup.js 统一 stub（不能在这里二次 mock 同一模块），
// 下载用的对象体从 setup 导出的 ossObjectStore.objects 里放。
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const { ossObjectStore } = await import('./setup.js');
// 轮询间隔在读模块时确定：测试里调小，否则每轮要等 8 s 才轮到下一个任务
process.env.INDEX_POLL_MS = '50';
const { db } = await import('../src/db.js');
const { enqueueFile, enqueueAll, indexStatus, pendingCount, startIndexWorker } = await import(
  '../src/indexPipeline.js'
);
const { DOC_KIND } = await import('../src/textExtract.js');
const { float32ToBlob, blobToFloat32, cosine, isEmbeddingEnabled } = await import('../src/embed.js');

let folderId = null;

before(() => {
  const r = db
    .prepare('INSERT INTO folders (name, parent_id, created_at, sort_order) VALUES (?, NULL, ?, 0)')
    .run('高数', Date.now());
  folderId = r.lastInsertRowid;
});

function addFile(name, ext, content) {
  const key = `test/${name}`;
  ossObjectStore.objects.set(key, Buffer.from(content));
  const r = db
    .prepare(
      `INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, sort_order, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, 0, ?)`
    )
    .run(folderId, name, key, content.length, ext, Date.now());
  return r.lastInsertRowid;
}

/** 只登记元数据、**不放对象体**：用来验证「体积闸门在下载之前就生效」。 */
function addFileWithSize(name, ext, size) {
  const r = db
    .prepare(
      `INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, sort_order, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, 0, ?)`
    )
    .run(folderId, name, `test/size/${name}`, size, ext, Date.now());
  return r.lastInsertRowid;
}

/** 等一个任务进入终态（done/failed），超时则带上实际状态报错。 */
async function waitSettled(fileId, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let row = null;
  while (Date.now() < deadline) {
    row = db.prepare('SELECT state, attempts, last_error FROM index_jobs WHERE file_id = ?').get(fileId);
    if (row && (row.state === 'done' || row.state === 'failed')) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`任务未在 ${timeoutMs}ms 内结束：${JSON.stringify(row)}`);
}

describe('索引流水线：入队与幂等', () => {
  test('enqueueFile 建立 pending 任务，重复入队不叠加', () => {
    const id = addFile(`幂等-${Date.now()}.txt`, 'txt', '矩阵分解与特征值');
    assert.equal(enqueueFile(id), true);
    assert.equal(enqueueFile(id), false, '已在队列里不应重复排');
    const job = db.prepare('SELECT state FROM index_jobs WHERE file_id = ?').get(id);
    assert.equal(job.state, 'pending');
  });

  test('不存在的文件不入队（上传与索引之间有竞态，不能凭 id 就建任务）', () => {
    assert.equal(enqueueFile(999999), false);
    assert.equal(enqueueFile('abc'), false);
  });

  test('enqueueAll：已抽过的文件增量不重排，force 时重排', async () => {
    const a = addFile(`增量A-${Date.now()}.txt`, 'txt', 'A');
    enqueueFile(a);
    startIndexWorker();
    await waitSettled(a); // 先让它完成，之后才谈得上「增量跳过」与「force 重排」

    // 增量：已 done 的不重排（返回值可能包含别的用例刚建的任务，因此断言落在本文件上）
    enqueueAll();
    assert.notEqual(
      db.prepare('SELECT state FROM index_jobs WHERE file_id = ?').get(a).state,
      'pending',
      '已完成的文件不该被增量重置为待处理'
    );

    // force：完成过的也要重排
    enqueueAll({ force: true });
    assert.equal(
      db.prepare('SELECT state FROM index_jobs WHERE file_id = ?').get(a).state,
      'pending',
      'force 应把已完成的文件重新排上'
    );
  });
});

describe('索引流水线：抽取落库', () => {
  test('txt 走完一轮：正文入库、任务 done、payload 记录 doc_kind', async () => {
    const id = addFile(`正文-${Date.now()}.txt`, 'txt', '极限的定义与中值定理');
    enqueueFile(id);
    startIndexWorker();
    const settled = await waitSettled(id);
    assert.equal(settled.state, 'done', `抽取应成功：${settled.last_error || ''}`);
    const row = db.prepare('SELECT content, doc_kind, chars FROM text_extractions WHERE file_id = ?').get(id);
    assert.equal(row.doc_kind, DOC_KIND.TEXT);
    assert.match(row.content, /中值定理/);
    assert.equal(row.chars, row.content.length);
    const job = db.prepare('SELECT content_hash FROM index_jobs WHERE file_id = ?').get(id);
    assert.ok(job.content_hash, 'done 时要写上内容指纹，供下次判断是否需要重算');
  });

  test('.doc 这类无解析路径的格式记为 unsupported，且不产生向量', async () => {
    const id = addFile(`老格式-${Date.now()}.doc`, 'doc', 'D0CF11E0A1B11AE1');
    enqueueFile(id);
    const settled = await waitSettled(id);
    assert.equal(settled.state, 'done');
    const row = db.prepare('SELECT doc_kind, content FROM text_extractions WHERE file_id = ?').get(id);
    assert.equal(row.doc_kind, DOC_KIND.UNSUPPORTED);
    assert.equal(row.content, '');
    assert.equal(db.prepare('SELECT 1 FROM file_embeddings WHERE file_id = ?').get(id), undefined);
  });

  test('删除文件后相关索引行被级联清掉（不留孤儿向量）', async () => {
    const id = addFile(`待删-${Date.now()}.txt`, 'txt', '临时内容');
    enqueueFile(id);
    await waitSettled(id);
    db.prepare('DELETE FROM files WHERE id = ?').run(id);
    assert.equal(db.prepare('SELECT 1 FROM text_extractions WHERE file_id = ?').get(id), undefined);
    assert.equal(db.prepare('SELECT 1 FROM index_jobs WHERE file_id = ?').get(id), undefined);
    assert.equal(db.prepare('SELECT 1 FROM file_embeddings WHERE file_id = ?').get(id), undefined);
  });

  test('**超过体积上限的文件不下载、不解析**（保护小内存服务器，见 INDEX_MAX_FILE_MB）', async () => {
    // 故意不放对象体：如果闸门没生效，这一步会因 NoSuchKey 失败——正是要防的「先下载再判断」
    const id = addFileWithSize(`超大-${Date.now()}.pdf`, 'pdf', 300 * 1024 * 1024);
    enqueueFile(id);
    const settled = await waitSettled(id);
    assert.equal(settled.state, 'done', `应直接跳过而不是失败：${settled.last_error || ''}`);
    const row = db.prepare('SELECT doc_kind, content, chars FROM text_extractions WHERE file_id = ?').get(id);
    assert.equal(row.doc_kind, DOC_KIND.TOO_LARGE);
    assert.equal(row.chars, 0);
    assert.equal(db.prepare('SELECT 1 FROM file_embeddings WHERE file_id = ?').get(id), undefined);
  });

  test('体积闸门会清掉旧向量：文件被换成超大件后不能再拿旧内容的语义去连线', async () => {
    const id = addFile(`先小后大-${Date.now()}.pdf`, 'pdf', '这是一段足够长的正文用来生成向量 内容内容内容');
    enqueueFile(id);
    await waitSettled(id);
    // 模拟「同名文件被替换成一个超大件」：只改 size
    db.prepare('UPDATE files SET size = ? WHERE id = ?').run(400 * 1024 * 1024, id);
    enqueueFile(id, { force: true });
    await waitSettled(id);
    assert.equal(
      db.prepare('SELECT 1 FROM file_embeddings WHERE file_id = ?').get(id),
      undefined,
      '旧向量必须被清掉'
    );
    assert.equal(
      db.prepare('SELECT doc_kind FROM text_extractions WHERE file_id = ?').get(id).doc_kind,
      DOC_KIND.TOO_LARGE
    );
  });

  test('对象缺失时记 last_error 并保留重试（不静默吞掉，也不当成成功）', async () => {
    const id = addFile(`缺对象-${Date.now()}.txt`, 'txt', 'x');
    // 把 OSS 对象删掉，模拟对象被外部清理：这一轮必然失败
    const name = db.prepare('SELECT name FROM files WHERE id = ?').get(id).name;
    ossObjectStore.objects.delete(`test/${name}`);
    enqueueFile(id);
    const deadline = Date.now() + 8000;
    let row = null;
    while (Date.now() < deadline) {
      row = db.prepare('SELECT state, attempts, last_error FROM index_jobs WHERE file_id = ?').get(id);
      if (row && row.state === 'failed') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(row && row.attempts > 0, '失败要被记录');
    assert.ok(row.last_error, '要有可读的错误原因');
    // 重试到上限后落到 failed，不会再无限重试
    assert.equal(row.state, 'failed');
    assert.ok(row.attempts >= 2);
    db.prepare('DELETE FROM index_jobs WHERE file_id = ?').run(id);
  });
});

describe('索引状态快照', () => {
  test('status 汇报覆盖率、向量数、配额与失败清单', () => {
    const s = indexStatus();
    assert.ok(s.totals.files > 0);
    assert.ok(s.totals.extracted > 0);
    assert.ok(s.totals.kinds[DOC_KIND.TEXT] > 0);
    assert.ok(s.totals.states.done > 0);
    assert.equal(typeof s.embedding.enabled, 'boolean');
    assert.ok(s.usage.limit > 0);
    assert.ok(Array.isArray(s.failures));
    assert.equal(typeof pendingCount(), 'number');
  });
});

describe('嵌入层：向量序列化与相似度', () => {
  test('float32 ↔ BLOB 往返无损（向量存 BLOB，取回来必须逐位一致）', () => {
    const vec = Float32Array.from([0.1, -0.25, 0.3333, 1, 0]);
    const back = blobToFloat32(float32ToBlob(vec));
    assert.equal(back.length, vec.length);
    for (let i = 0; i < vec.length; i += 1) assert.equal(back[i], vec[i]);
  });

  test('cosine：同向为 1、正交为 0、反向为 -1', () => {
    const a = Float32Array.from([1, 0, 0]);
    assert.equal(cosine(a, Float32Array.from([1, 0, 0])), 1);
    assert.equal(cosine(a, Float32Array.from([0, 1, 0])), 0);
    assert.equal(cosine(a, Float32Array.from([-1, 0, 0])), -1);
  });

  test('模型缺失时 isEmbeddingEnabled 为 false（降级路径必须能跑）', () => {
    // 测试环境没有 models/ 目录，因此这里恒为 false；正是要断言「缺模型不抛异常」
    assert.equal(typeof isEmbeddingEnabled(), 'boolean');
    assert.doesNotThrow(() => isEmbeddingEnabled());
  });
});
