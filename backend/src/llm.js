// OpenAI 兼容 LLM 客户端（流式）。零依赖：Node 24 全局 fetch + ReadableStream。
// 参照 imm.js 的外部服务调用模式：envOrThrow、非 2xx 抛结构化错误。

function env(name) {
  return (process.env[name] || '').trim();
}

const LLM_API_KEY = env('LLM_API_KEY');
const LLM_BASE_URL = env('LLM_BASE_URL').replace(/\/+$/, '');
const LLM_MODEL = env('LLM_MODEL');

// 三个变量齐全才启用；缺失时聊天路由返回 503，不影响其他功能。
// 用函数而非常量导出，便于测试注入（env 本身在运行期不变，参照 oss.js）。
export function isLlmEnabled() {
  return Boolean(LLM_API_KEY && LLM_BASE_URL && LLM_MODEL);
}

const MAX_KEY_LEN = 500;
const MAX_URL_LEN = 300;
const MAX_MODEL_LEN = 100;

/**
 * 校验请求携带的客户端 LLM 配置（前端设置面板可让用户自带 Key）。
 * 三项齐全且合法才有效；baseUrl 限定 http(s) 协议并去掉尾部斜杠。
 * 返回归一化后的 { apiKey, baseUrl, model } 或 null。
 */
export function resolveClientLlmConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  const baseUrlRaw = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  if (!apiKey || !baseUrlRaw || !model) return null;
  if (apiKey.length > MAX_KEY_LEN || baseUrlRaw.length > MAX_URL_LEN || model.length > MAX_MODEL_LEN) {
    return null;
  }
  if (!/^https?:\/\//i.test(baseUrlRaw)) return null;
  let baseUrl;
  try {
    baseUrl = new URL(baseUrlRaw).toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
  return { apiKey, baseUrl, model };
}

/**
 * 流式对话补全。yield 事件：
 *   { type: 'delta', text }                      — 文本增量
 *   { type: 'tool_calls', tool_calls: [...] }    — 完整的工具调用（流结束时产出）
 * config 可传请求级配置（覆盖 env，见 resolveClientLlmConfig）。
 * @param {{ messages: Array, tools?: Array, signal?: AbortSignal, config?: object }} opts
 */
export async function* chatStream({ messages, tools, signal, config }) {
  const apiKey = config?.apiKey || LLM_API_KEY;
  const baseUrl = config?.baseUrl || LLM_BASE_URL;
  const model = config?.model || LLM_MODEL;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
      stream: true,
    }),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`LLM 上游错误 ${res.status}: ${detail.slice(0, 300)}`);
    err.status = 502;
    throw err;
  }

  // OpenAI 流式 tool_call 增量按 index 分片累积，流结束拼成完整调用。
  const pendingTools = new Map();
  let sawDone = false;

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        sawDone = true;
        continue;
      }
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) yield { type: 'delta', text: delta.content };
      for (const frag of delta.tool_calls || []) {
        const idx = frag.index ?? 0;
        const acc = pendingTools.get(idx) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (frag.id) acc.id = frag.id;
        if (frag.function?.name) acc.function.name += frag.function.name;
        if (frag.function?.arguments) acc.function.arguments += frag.function.arguments;
        pendingTools.set(idx, acc);
      }
    }
  }

  if (pendingTools.size > 0) {
    yield {
      type: 'tool_calls',
      tool_calls: [...pendingTools.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v),
    };
  }
  if (!sawDone && pendingTools.size === 0) {
    // 上游异常断流且没有任何输出时显式报错，避免前端无限等待。
    const err = new Error('LLM 上游连接中断');
    err.status = 502;
    throw err;
  }
}
