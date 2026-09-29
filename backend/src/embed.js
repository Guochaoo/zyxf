/**
 * 本地文本嵌入：bge-small-zh-v1.5（ONNX，量化版 22.9 MB）+ onnxruntime-node。
 *
 * 为什么走本地而不是云端：
 *   - 零调用成本、零隐私外发（资料内容不出服务器）；
 *   - 实测 4 段文本 7 ms，850 个文件约 1–2 分钟；
 *   - 你现用的 StepFun 线路（api.stepfun.com/step_plan/v1）只有对话接口，没有 /embeddings。
 *
 * 模型文件不在仓库里（.gitignore 掉，约 23 MB），按 docs/DEPLOY.md 的说明下载；
 * 缺失时本模块所有函数优雅降级：isEmbeddingEnabled() 为 false，索引只抽正文不出向量。
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MODEL_NAME = 'bge-small-zh-v1.5';
export const MODEL_DIR =
  process.env.EMBED_MODEL_DIR || path.join(__dirname, '..', 'models', MODEL_NAME);
export const VECTOR_DIM = 512;
export const MAX_TOKENS = 256; // bge-small-zh 训练长度 512，索引场景 256 足够且更快
const BATCH_SIZE = 16;
const SPECIAL_TOKENS = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', '[MASK]'];

let session = null; // ONNX InferenceSession
let tokenizer = null;
let loadError = null;
let loading = null;
let runtimeAvailable = null; // onnxruntime-node 是否可解析（缓存）

/**
 * onnxruntime-node 是否装上了（BUG-102）。
 *
 * 它是 **optionalDependency**：postinstall 会联网拉对应平台的原生库，服务器上
 * （无代理、走 npmmirror）会因 302 判定失败，把 `npm install` 整体拖挂、部署中断。
 * 降级成可选依赖后「装不上」不再是部署阻断，但必须在**功能层**也降级：模型文件在、
 * 运行时缺失时如果 isEmbeddingEnabled() 仍返回 true，索引会走进 embedTexts 然后
 * 每个文件都失败一轮。这里用 require.resolve 做同步探测（只查包是否可解析，
 * 便宜且可缓存），真正的加载错误仍由 load() 捕获并记进 loadError。
 */
function hasRuntime() {
  if (runtimeAvailable == null) {
    try {
      createRequire(import.meta.url).resolve('onnxruntime-node');
      runtimeAvailable = true;
    } catch {
      runtimeAvailable = false;
    }
  }
  return runtimeAvailable;
}

/** 嵌入是否可用：运行时（onnxruntime-node）与模型文件**都**就绪才算可用。 */
export function isEmbeddingEnabled() {
  try {
    return (
      hasRuntime() &&
      fs.existsSync(path.join(MODEL_DIR, 'model_quantized.onnx')) &&
      fs.existsSync(path.join(MODEL_DIR, 'tokenizer.json'))
    );
  } catch {
    return false;
  }
}

/** 上次加载失败的原因（给运维接口显示，避免「为什么没向量」只能靠猜）。 */
export function embeddingLoadError() {
  if (loadError) return loadError;
  if (!hasRuntime()) {
    return 'onnxruntime-node 未安装（optionalDependency，postinstall 拉原生库失败时会被跳过）——只抽正文不出向量';
  }
  return null;
}

async function load() {
  if (session && tokenizer) return;
  if (loading) return loading;
  loading = (async () => {
    const ort = await import('onnxruntime-node');
    const tk = await import('@huggingface/tokenizers');
    session = await ort.default.InferenceSession.create(
      path.join(MODEL_DIR, 'model_quantized.onnx'),
      { intraOpNumThreads: 1, graphOptimizationLevel: 'all' }
    );
    // tokenizer.json 由 @huggingface/tokenizers 直接吃整个对象，内部自己拼装 normalizer/pre_tokenizer
    const raw = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, 'tokenizer.json'), 'utf8'));
    tokenizer = new tk.Tokenizer(raw, { additional_special_tokens: SPECIAL_TOKENS });
    console.log(`[embed] 模型就绪：${MODEL_NAME}（${VECTOR_DIM} 维）`);
  })();
  try {
    await loading;
    loadError = null;
  } catch (e) {
    loadError = e?.message || String(e);
    session = null;
    tokenizer = null;
    throw e;
  } finally {
    loading = null;
  }
}

/** 文本 → token id 矩阵（定长补齐，attention_mask 标出真实长度）。 */
function encodeBatch(texts) {
  const rows = texts.map((t) => tokenizer.encode(String(t || '').slice(0, 4000)).ids.slice(0, MAX_TOKENS));
  const len = Math.max(1, Math.max(...rows.map((r) => r.length)));
  const n = rows.length;
  const ids = new BigInt64Array(n * len);
  const mask = new BigInt64Array(n * len);
  const types = new BigInt64Array(n * len);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < len; j += 1) {
      const v = j < rows[i].length ? rows[i][j] : 0;
      ids[i * len + j] = BigInt(v);
      mask[i * len + j] = BigInt(j < rows[i].length ? 1 : 0);
    }
  }
  return { ids, mask, types, len, n };
}

function l2normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) sum += vec[i] * vec[i];
  const inv = 1 / Math.sqrt(sum || 1);
  for (let i = 0; i < vec.length; i += 1) vec[i] *= inv;
  return vec;
}

/**
 * 批量嵌入。返回 Float32Array[]（已 L2 归一化，因此余弦相似度 = 点积）。
 * bge 系列用 CLS pooling（取每句第一个 token 的隐藏态），不是 mean pooling。
 */
export async function embedTexts(texts) {
  if (!Array.isArray(texts) || !texts.length) return [];
  await load();
  const ort = await import('onnxruntime-node');
  const out = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const { ids, mask, types, len, n } = encodeBatch(batch);
    const feeds = {
      input_ids: new ort.default.Tensor('int64', ids, [n, len]),
      attention_mask: new ort.default.Tensor('int64', mask, [n, len]),
      token_type_ids: new ort.default.Tensor('int64', types, [n, len]),
    };
    const result = await session.run(feeds);
    const first = result[session.outputNames[0]];
    const [, seqLen, dim] = first.dims;
    for (let i = 0; i < n; i += 1) {
      const slice = first.data.subarray(i * seqLen * dim, i * seqLen * dim + dim);
      out.push(l2normalize(Float32Array.from(slice)));
    }
  }
  return out;
}

/** 单条便捷入口（查询、单文件）。 */
export async function embedOne(text) {
  const [v] = await embedTexts([text]);
  return v;
}

export function float32ToBlob(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function blobToFloat32(blob) {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  // Buffer 的底层 ArrayBuffer 可能比数据长，必须用 offset/length 精确切片
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** 余弦相似度：两边都已归一化，点积即可。 */
export function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}
