// OpenAI 兼容 LLM 客户端（流式）。零依赖：Node 24 全局 fetch + ReadableStream。
// 参照 imm.js 的外部服务调用模式：envOrThrow、非 2xx 抛结构化错误。

import net from 'node:net';
import dns from 'node:dns';
import { envStr } from './env.js';

const LLM_API_KEY = envStr('LLM_API_KEY');
const LLM_BASE_URL = envStr('LLM_BASE_URL').replace(/\/+$/, '');
const LLM_MODEL = envStr('LLM_MODEL');

// 三个变量齐全才启用；缺失时聊天路由返回 503，不影响其他功能。
// 导出为函数而非常量：测试通过 mock.module 整体替换本模块来控制启用态（见 test/setup.js）。
export function isLlmEnabled() {
  return Boolean(LLM_API_KEY && LLM_BASE_URL && LLM_MODEL);
}

const MAX_KEY_LEN = 500;
const MAX_URL_LEN = 300;
const MAX_MODEL_LEN = 100;

// BUG-20 SSRF 防护：客户端仅允许 https，且主机名/IP 不得落入回环/私网/链路本地/云元数据等网段。
// 主机名（非 IP 字面量）通过 dns.lookup 解析后校验结果；解析失败/超时视为外部主机（不据此阻断）。
const RESERVED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.googleinternal',
]);

// 判断 IP 是否属于被拦截的网段（回环/私网/链路本地/云元数据/CGNAT 等）。
function isForbiddenIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 127) return true; // 0.0.0.0/8、127.0.0.0/8 回环
    if (a === 10) return true; // 10.0.0.0/8 私网
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 私网
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 私网
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 链路本地（含云元数据 169.254.169.254）
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1' || lower === '::ffff:127.0.0.1') return true;
    // IPv4 映射的 IPv6 地址：URL 会把 ::ffff:127.0.0.1 规范化为 ::ffff:7f00:1（十六进制）或保持点分（::ffff:a.b.c.d），
    // 两者都按 IPv4 规则校验，避免回环/私网被绕行。
    let mapped = null;
    const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) {
      mapped = dotted[1];
    } else {
      const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const hi = parseInt(hex[1], 16);
        const lo = parseInt(hex[2], 16);
        mapped = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
      }
    }
    if (mapped) return isForbiddenIp(mapped);
    // IPv4 兼容地址（::a.b.c.d，非 ::ffff: 前缀）同样映射回 IPv4 规则。
    const compat = lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
    if (compat) return isForbiddenIp(compat[1]);
    // 其余 IPv6 按首段判定内网/保留网段。必须拦：fc00::/7 唯一本地地址（阿里云内网
    // 元数据在 IPv6 下就是 fd00:0:0:0::1）、fe80::/10 链路本地、fec0::/10 站点本地、
    // ff00::/8 组播。只放行全局单播 2000::/3。
    const firstHextet = parseInt(lower.split(':')[0] || '', 16);
    if (Number.isNaN(firstHextet)) return true; // 解析不出来 → 保守拦截
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10
    if ((firstHextet & 0xffc0) === 0xfec0) return true; // fec0::/10（已废弃的站点本地）
    if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8
    return (firstHextet & 0xe000) !== 0x2000; // 非 2000::/3（全局单播）一律拦
  }
  return false;
}

// 带超时的 DNS 解析（all:true），避免解析挂起拖慢请求。
function lookupWithTimeout(host, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dns lookup timeout')), timeoutMs);
    dns.promises.lookup(host, { all: true }).then(
      (addrs) => {
        clearTimeout(timer);
        resolve(addrs);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// 校验客户端自定义 baseUrl 是否可安全使用（仅 https；拒绝回环/私网/链路本地/云元数据地址）。
// 返回 true（可安全使用）或 false。解析失败/超时不在此处阻断（fetch 自身会失败，无法据此发起内网访问）。
async function isSafeLlmBaseUrl(baseUrlRaw) {
  let url;
  try {
    url = new URL(baseUrlRaw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false; // 仅允许 https，杜绝明文/任意协议
  const host = (url.hostname || '').replace(/^\[|\]$/g, '').toLowerCase(); // 去掉 IPv6 包裹括号
  if (!host) return false;
  if (RESERVED_HOSTNAMES.has(host)) return false;
  if (net.isIP(host)) return !isForbiddenIp(host); // 字面 IP 直接校验

  // 非 IP 字面量：解析后校验所有解析地址，任一命中即拒绝。
  try {
    const addrs = await lookupWithTimeout(host);
    if (!Array.isArray(addrs) || addrs.length === 0) return true; // 无法解析 → 视为外部主机
    return addrs.every((a) => !isForbiddenIp(a.address));
  } catch {
    return true; // 解析失败/超时：交由 fetch 自身失败，不在此处拦截
  }
}

/**
 * 校验请求携带的客户端 LLM 配置（前端设置面板可让用户自带 Key）。
 * 三项齐全且合法才有效；baseUrl 仅允许 https（SSRF 防护）并去掉尾部斜杠。
 * 返回归一化后的 { apiKey, baseUrl, model } 或 null。
 */
export async function resolveClientLlmConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  const baseUrlRaw = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  if (!apiKey || !baseUrlRaw || !model) return null;
  if (apiKey.length > MAX_KEY_LEN || baseUrlRaw.length > MAX_URL_LEN || model.length > MAX_MODEL_LEN) {
    return null;
  }
  if (!(await isSafeLlmBaseUrl(baseUrlRaw))) return null; // SSRF 拦截
  let baseUrl;
  try {
    baseUrl = new URL(baseUrlRaw).toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
  return { apiKey, baseUrl, model };
}

/**
 * 校验组装的工具调用是否完整：function.arguments 必须是有效的 JSON 对象/字符串。
 * 流式断连可能留下被截断的半截 arguments，这类不完整的调用不应透传（BUG-12）。
 */
function isCompleteToolCall(tc) {
  if (!tc || typeof tc.function?.arguments !== 'string') return false;
  try {
    const parsed = JSON.parse(tc.function.arguments || '{}');
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

/**
 * 对累积的 tool_call 增量做最终组装与完整性过滤。
 * 输入 pendingTools（index → tool_call 组装对象），返回按 index 排序且 arguments 完好的调用列表。
 */
function finalizeToolCalls(pendingTools) {
  return [...pendingTools.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v)
    .filter(isCompleteToolCall);
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
  let producedOutput = false; // 是否已向客户端产出任何输出（文本或工具调用）

  const decoder = new TextDecoder();
  let buffer = '';
  // 以换行切分并处理 SSE 数据块。返回本次应产出的事件；buffer/sawDone/producedOutput/pendingTools 由闭包共享。
  // 抽成函数以复用同一套切分逻辑：流结束后也能处理 buffer 残留的末段（无换行的尾行）以及 decoder 最后 flush 出的字节。
  const consumeBuffer = (text) => {
    buffer += text;
    const outputs = [];
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
      if (delta.content) {
        producedOutput = true;
        outputs.push({ type: 'delta', text: delta.content });
      }
      for (const frag of delta.tool_calls || []) {
        const idx = frag.index ?? 0;
        const acc = pendingTools.get(idx) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (frag.id) acc.id = frag.id;
        if (frag.function?.name) acc.function.name += frag.function.name;
        if (frag.function?.arguments) acc.function.arguments += frag.function.arguments;
        pendingTools.set(idx, acc);
      }
    }
    return outputs;
  };

  for await (const chunk of res.body) {
    for (const out of consumeBuffer(decoder.decode(chunk, { stream: true }))) yield out;
  }
  // 流结束：先 flush decoder（个别 provider 只在最后的 flush 中吐出字节），
  // 再处理 buffer 中残留的无换行尾行（否则末尾的 data: 行会被丢弃）。
  for (const out of consumeBuffer(decoder.decode())) yield out;

  if (pendingTools.size > 0) {
    const toolCalls = finalizeToolCalls(pendingTools);
    if (toolCalls.length > 0) {
      producedOutput = true;
      yield { type: 'tool_calls', tool_calls: toolCalls };
    }
  }
  if (!sawDone && !producedOutput) {
    // 上游异常断流且没有任何输出时显式报错，避免前端无限等待。
    // 一旦已产出输出则优雅收尾（不再抛错），与注释意图一致（BUG-12）。
    const err = new Error('LLM 上游连接中断');
    err.status = 502;
    throw err;
  }
}
