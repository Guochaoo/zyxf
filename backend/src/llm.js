// OpenAI 兼容 / Anthropic 兼容 LLM 客户端（流式）。零依赖：Node 24 全局 fetch + ReadableStream。
// 参照 imm.js 的外部服务调用模式：envOrThrow、非 2xx 抛结构化错误。
// 协议差异（请求体、鉴权头、SSE 形状）收敛在 llmProtocols.js，本文件只负责取配置、发请求、转发事件。

import net from 'node:net';
import dns from 'node:dns';
import { envStr } from './env.js';
import {
  isSupportedProtocol,
  normalizeProtocol,
  createSseSplitter,
  PROTOCOL_IMPLS,
} from './llmProtocols.js';

const LLM_API_KEY = envStr('LLM_API_KEY');
const LLM_BASE_URL = envStr('LLM_BASE_URL').replace(/\/+$/, '');
const LLM_MODEL = envStr('LLM_MODEL');
// 服务端上游协议，缺省 OpenAI 兼容（OpenAI/GLM/DeepSeek 等同款接口）。
const LLM_PROTOCOL = normalizeProtocol(envStr('LLM_PROTOCOL'));

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
 * 三项齐全且合法才有效；baseUrl 仅允许 https（SSRF 防护）并去掉尾部斜杠；
 * protocol 缺省按 openai，显式填了不支持的值则整份配置作废（不静默降级，避免用户以为切了协议）。
 * 返回归一化后的 { apiKey, baseUrl, model, protocol } 或 null。
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
  const protocolRaw = typeof raw.protocol === 'string' ? raw.protocol.trim() : '';
  if (protocolRaw && !isSupportedProtocol(protocolRaw)) return null;
  if (!(await isSafeLlmBaseUrl(baseUrlRaw))) return null; // SSRF 拦截
  let baseUrl;
  try {
    baseUrl = new URL(baseUrlRaw).toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
  return { apiKey, baseUrl, model, protocol: normalizeProtocol(protocolRaw) };
}

/**
 * 流式对话补全。yield 事件（与上游协议无关）：
 *   { type: 'delta', text }                      — 文本增量
 *   { type: 'tool_calls', tool_calls: [...] }    — 完整的工具调用（流结束时产出）
 * config 可传请求级配置（覆盖 env，见 resolveClientLlmConfig）。
 * @param {{ messages: Array, tools?: Array, signal?: AbortSignal, config?: object }} opts
 */
export async function* chatStream({ messages, tools, signal, config }) {
  const apiKey = config?.apiKey || LLM_API_KEY;
  const baseUrl = config?.baseUrl || LLM_BASE_URL;
  const model = config?.model || LLM_MODEL;
  // 有请求级配置就用它自己的协议（缺省 openai-completions，与 resolveClientLlmConfig 的归一化一致），
  // 只有走服务端 env 时才看 LLM_PROTOCOL——否则用户没填协议时会静默继承服务端协议。
  const protocol = normalizeProtocol(config ? config.protocol : LLM_PROTOCOL);
  const { buildRequest, createReducer } = PROTOCOL_IMPLS[protocol];

  const req = buildRequest({ baseUrl, apiKey, model, messages, tools });

  const res = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`LLM 上游错误 ${res.status}: ${detail.slice(0, 300)}`);
    err.status = 502;
    throw err;
  }

  const decoder = new TextDecoder();
  const splitter = createSseSplitter();
  const reducer = createReducer();
  let producedOutput = false; // 是否已向客户端产出任何输出（文本或工具调用）

  // 每段 SSE 载荷交给协议 reducer 变成统一事件；流的切分逻辑各协议共用。
  const emit = function* (payloads) {
    for (const payload of payloads) {
      for (const ev of reducer.feed(payload)) {
        producedOutput = true;
        yield ev;
      }
    }
  };

  for await (const chunk of res.body) {
    yield* emit(splitter.push(decoder.decode(chunk, { stream: true })));
  }
  // 流结束：先 flush decoder（个别 provider 只在最后的 flush 中吐出字节），
  // 再由 splitter.end() 处理残留的无换行尾行（否则末尾的 data: 行会被丢弃），
  // 最后由 reducer 收尾产出工具调用。
  const tail = decoder.decode();
  if (tail) yield* emit(splitter.push(tail));
  yield* emit(splitter.end());
  for (const ev of reducer.finish()) {
    producedOutput = true;
    yield ev;
  }

  if (!reducer.sawDone && !producedOutput) {
    // 上游异常断流且没有任何输出时显式报错，避免前端无限等待。
    // 一旦已产出输出则优雅收尾（不再抛错），与注释意图一致（BUG-12）。
    const err = new Error('LLM 上游连接中断');
    err.status = 502;
    throw err;
  }
}
