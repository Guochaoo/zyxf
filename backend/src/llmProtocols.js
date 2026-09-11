// 上游协议适配层：把各家 LLM 协议的请求体/流式响应差异收敛在这里。
// 内部一律使用「OpenAI 形状」的消息（system / user / assistant+tool_calls / tool），
// chat.js 的工具调用回路因此完全不用感知协议差异：
//   请求方向：openai 直传；anthropic 由 toAnthropicMessages/toAnthropicTools 翻译。
//   响应方向：两种协议各自的 SSE 载荷经 reducer 统一成 { delta } / { tool_calls } 事件。
// 本模块只做纯数据变换（不联网、不读 env），便于单测覆盖。

export const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'];
const DEFAULT_PROTOCOL = 'openai-completions';

// 旧值/简称别名：早期版本存的是 openai / anthropic，env 文档也写过这两个词，一律映射到规范名。
const PROTOCOL_ALIASES = {
  openai: 'openai-completions',
  anthropic: 'anthropic-messages',
};

/** 是否为受支持的协议名（前端配置用它做白名单校验）。 */
export function isSupportedProtocol(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return PROTOCOLS.includes(v) || v in PROTOCOL_ALIASES;
}

/** 归一化协议名：未知/缺省按 openai-completions（兼容旧配置与旧客户端）。 */
export function normalizeProtocol(value) {
  if (!isSupportedProtocol(value)) return DEFAULT_PROTOCOL;
  const v = value.trim().toLowerCase();
  return PROTOCOL_ALIASES[v] || v;
}

/**
 * SSE 行切分：喂任意文本块，吐出其中的 `data:` 载荷。
 * 跨块的半行残留在内部缓冲；end() 处理流末尾没有换行的最后一行（个别 provider 不补换行）。
 */
export function createSseSplitter() {
  let buffer = '';
  const payloadOf = (line) => {
    const trimmed = line.trim();
    return trimmed.startsWith('data:') ? trimmed.slice(5).trim() : null;
  };
  return {
    push(text) {
      buffer += text;
      const out = [];
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const payload = payloadOf(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (payload !== null) out.push(payload);
      }
      return out;
    },
    end() {
      const payload = buffer ? payloadOf(buffer) : null;
      buffer = '';
      return payload ? [payload] : [];
    },
  };
}

/**
 * 工具调用完整性校验：function.arguments 必须是有效的 JSON 对象/字符串。
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

/** 按 index 排序并丢掉 arguments 不完整的调用。 */
function finalizeToolCalls(pendingTools) {
  return [...pendingTools.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v)
    .filter(isCompleteToolCall);
}

/** 统一的流式载荷解析器：feed(payload) → 事件数组，finish() → 收尾事件，sawDone → 是否收到正常结束标记。 */
export function createOpenAiReducer() {
  // OpenAI 流式 tool_call 增量按 index 分片累积，流结束拼成完整调用。
  const pendingTools = new Map();
  let sawDone = false;
  return {
    get sawDone() {
      return sawDone;
    },
    feed(payload) {
      if (payload === '[DONE]') {
        sawDone = true;
        return [];
      }
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        return [];
      }
      const delta = json.choices?.[0]?.delta;
      if (!delta) return [];
      const events = [];
      if (delta.content) events.push({ type: 'delta', text: delta.content });
      for (const frag of delta.tool_calls || []) {
        const idx = frag.index ?? 0;
        const acc = pendingTools.get(idx) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (frag.id) acc.id = frag.id;
        if (frag.function?.name) acc.function.name += frag.function.name;
        if (frag.function?.arguments) acc.function.arguments += frag.function.arguments;
        pendingTools.set(idx, acc);
      }
      return events;
    },
    finish() {
      if (pendingTools.size === 0) return [];
      const toolCalls = finalizeToolCalls(pendingTools);
      return toolCalls.length ? [{ type: 'tool_calls', tool_calls: toolCalls }] : [];
    },
  };
}

// ---- Anthropic Messages API ----

export const ANTHROPIC_VERSION = '2023-06-01';
// Anthropic 的 max_tokens 是必填项（不像 OpenAI 可省）；给足一屏回答的长度即可。
export const ANTHROPIC_MAX_TOKENS = 4096;

export function anthropicUrl(baseUrl) {
  // baseUrl 里用户填到版本层（如 https://api.anthropic.com/v1）。
  return `${baseUrl}/messages`;
}

export function anthropicHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  };
}

/** 把 tool_call 的 arguments（JSON 字符串）转成 Anthropic 要求的对象；坏数据退化为空对象。 */
function toInputObject(args) {
  try {
    const parsed = JSON.parse(args || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * OpenAI 形状消息 → Anthropic { system, messages }。
 * 三处关键差异：
 *   1. system 是顶层参数，不能留在 messages 里；
 *   2. assistant 的工具调用是 content 里的 tool_use 块（input 是对象，不是字符串）；
 *   3. 工具结果必须是**下一条 user 消息**里的 tool_result 块，同一轮的多个结果合并进同一条消息，
 *      且 Anthropic 要求 user/assistant 交替、不接受空 content。
 */
export function toAnthropicMessages(messages) {
  const systemParts = [];
  const out = [];
  let pendingToolResults = [];

  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    // 相邻同角色消息合并（历史里可能出现连续 user），避免上游以角色未交替为由拒绝。
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };

  const flushToolResults = () => {
    if (!pendingToolResults.length) return;
    const blocks = pendingToolResults;
    pendingToolResults = [];
    push('user', blocks);
  };

  for (const m of messages || []) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'system') {
      if (typeof m.content === 'string' && m.content) systemParts.push(m.content);
      continue;
    }
    if (m.role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
      });
      continue;
    }
    flushToolResults();
    const blocks = [];
    if (typeof m.content === 'string' && m.content) blocks.push({ type: 'text', text: m.content });
    if (m.role === 'assistant') {
      for (const tc of m.tool_calls || []) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name,
          input: toInputObject(tc.function?.arguments),
        });
      }
    }
    push(m.role === 'assistant' ? 'assistant' : 'user', blocks);
  }
  flushToolResults();

  return { system: systemParts.join('\n\n'), messages: out };
}

/** OpenAI 的 tools（function.parameters）→ Anthropic 的 tools（input_schema）。 */
export function toAnthropicTools(tools) {
  return (tools || []).map((t) => ({
    name: t.function?.name,
    description: t.function?.description,
    input_schema: t.function?.parameters ?? { type: 'object', properties: {} },
  }));
}

export function buildAnthropicBody({ model, messages, tools, maxTokens = ANTHROPIC_MAX_TOKENS }) {
  const { system, messages: converted } = toAnthropicMessages(messages);
  const body = { model, max_tokens: maxTokens, messages: converted, stream: true };
  if (system) body.system = system;
  if (tools?.length) body.tools = toAnthropicTools(tools);
  return body;
}

/**
 * 两种协议的请求组装（url / headers / body）。放在这里是为了让「线上长什么样」可被单测直接断言，
 * llm.js 只负责 fetch 与流转发。
 */
export function buildOpenAiRequest({ baseUrl, apiKey, model, messages, tools }) {
  return {
    url: `${baseUrl}/chat/completions`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: {
      model,
      messages,
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
      stream: true,
    },
  };
}

export function buildAnthropicRequest({ baseUrl, apiKey, model, messages, tools }) {
  return {
    url: anthropicUrl(baseUrl),
    headers: anthropicHeaders(apiKey),
    body: buildAnthropicBody({ model, messages, tools }),
  };
}

// ---- OpenAI Responses API（/responses）----

/**
 * OpenAI 形状消息 → Responses 的 { instructions, input }。
 * 与 Chat Completions 的差异：
 *   1. system 提示走顶层 instructions（不是 input 里的一条消息）；
 *   2. input 是「条目」数组：普通消息用 { role, content: '文本' }，
 *      工具调用是 **独立的 function_call 条目**（arguments 仍是 JSON 字符串），
 *      工具结果是 function_call_output 条目（用 call_id 关联，不是 tool_call_id 字段）；
 *   3. tools 平铺成 { type: 'function', name, description, parameters }。
 */
export function toResponsesInput(messages) {
  const instructionParts = [];
  const input = [];
  for (const m of messages || []) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'system') {
      if (typeof m.content === 'string' && m.content) instructionParts.push(m.content);
      continue;
    }
    if (m.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: m.tool_call_id,
        output: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
      });
      continue;
    }
    if (m.role === 'assistant') {
      if (typeof m.content === 'string' && m.content) input.push({ role: 'assistant', content: m.content });
      for (const tc of m.tool_calls || []) {
        input.push({
          type: 'function_call',
          call_id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments || '{}',
        });
      }
      continue;
    }
    if (typeof m.content === 'string' && m.content) input.push({ role: 'user', content: m.content });
  }
  return { instructions: instructionParts.join('\n\n'), input };
}

/** Responses 的 tools：平铺 { type:'function', name, description, parameters }。 */
export function toResponsesTools(tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    name: t.function?.name,
    description: t.function?.description,
    parameters: t.function?.parameters ?? { type: 'object', properties: {} },
  }));
}

export function buildResponsesBody({ model, messages, tools }) {
  const { instructions, input } = toResponsesInput(messages);
  const body = { model, input, stream: true, store: false }; // store:false：不在上游留对话副本
  if (instructions) body.instructions = instructions;
  if (tools?.length) body.tools = toResponsesTools(tools);
  return body;
}

export function buildOpenAiResponsesRequest({ baseUrl, apiKey, model, messages, tools }) {
  return {
    url: `${baseUrl}/responses`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: buildResponsesBody({ model, messages, tools }),
  };
}

/**
 * Responses 流式载荷 → 统一事件。
 * 相关事件：response.output_text.delta（文本增量）、response.output_item.added（function_call 条目
 * 给出 call_id/name）、response.function_call_arguments.delta / .done（拼接 arguments）、
 * response.completed（正常结束）、response.failed / error（上游报错）。
 * 内部工具回调约定用 call_id 作为调用 id，回灌时 function_call_output 才能对上。
 */
export function createOpenAiResponsesReducer() {
  const pendingTools = new Map(); // item_id → tool_call（call_id 作为对外的 id）
  let sawDone = false;
  return {
    get sawDone() {
      return sawDone;
    },
    feed(payload) {
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        return [];
      }
      if (json.type === 'response.output_text.delta') {
        return json.delta ? [{ type: 'delta', text: json.delta }] : [];
      }
      if (json.type === 'response.output_item.added' && json.item?.type === 'function_call') {
        pendingTools.set(json.item.id, {
          id: json.item.call_id || json.item.id,
          type: 'function',
          function: { name: json.item.name || '', arguments: '' },
        });
        return [];
      }
      if (json.type === 'response.function_call_arguments.delta') {
        const acc = pendingTools.get(json.item_id);
        if (acc && json.delta) acc.function.arguments += json.delta;
        return [];
      }
      if (json.type === 'response.function_call_arguments.done') {
        // 该事件带完整 arguments，直接以它为准（比逐片拼接更稳）
        const acc = pendingTools.get(json.item_id);
        if (acc && typeof json.arguments === 'string') acc.function.arguments = json.arguments;
        return [];
      }
      if (json.type === 'response.completed') {
        sawDone = true;
        return [];
      }
      if (json.type === 'response.failed' || json.type === 'error') {
        const detail = json.response?.error?.message || json.error?.message || json.message || '';
        const err = new Error(`LLM 上游错误: ${detail}`.trim());
        err.status = 502;
        throw err;
      }
      return [];
    },
    finish() {
      if (pendingTools.size === 0) return [];
      const toolCalls = finalizeToolCalls(pendingTools);
      return toolCalls.length ? [{ type: 'tool_calls', tool_calls: toolCalls }] : [];
    },
  };
}

/** 协议 → 请求组装 / 流解析。llm.js 只按这张表分发。 */
export const PROTOCOL_IMPLS = {
  'openai-completions': { buildRequest: buildOpenAiRequest, createReducer: createOpenAiReducer },
  'openai-responses': { buildRequest: buildOpenAiResponsesRequest, createReducer: createOpenAiResponsesReducer },
  'anthropic-messages': { buildRequest: buildAnthropicRequest, createReducer: createAnthropicReducer },
};

/**
 * Anthropic 流式载荷 → 统一事件。
 * 相关事件：content_block_start（tool_use 块给出 id/name）、content_block_delta（text_delta /
 * input_json_delta 增量，后者拼成 arguments 字符串）、message_stop（正常结束）、error（上游中途报错）。
 */
export function createAnthropicReducer() {
  const pendingTools = new Map();
  let sawDone = false;
  return {
    get sawDone() {
      return sawDone;
    },
    feed(payload) {
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        return [];
      }
      if (json.type === 'error') {
        const err = new Error(`LLM 上游错误: ${json.error?.type || 'error'} ${json.error?.message || ''}`.trim());
        err.status = 502;
        throw err;
      }
      if (json.type === 'message_stop') {
        sawDone = true;
        return [];
      }
      if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
        pendingTools.set(json.index ?? 0, {
          id: json.content_block.id || '',
          type: 'function',
          function: { name: json.content_block.name || '', arguments: '' },
        });
        return [];
      }
      if (json.type === 'content_block_delta') {
        const delta = json.delta || {};
        if (delta.type === 'text_delta' && delta.text) return [{ type: 'delta', text: delta.text }];
        if (delta.type === 'input_json_delta' && delta.partial_json) {
          const acc = pendingTools.get(json.index ?? 0);
          if (acc) acc.function.arguments += delta.partial_json;
        }
      }
      return [];
    },
    finish() {
      if (pendingTools.size === 0) return [];
      const toolCalls = finalizeToolCalls(pendingTools);
      return toolCalls.length ? [{ type: 'tool_calls', tool_calls: toolCalls }] : [];
    },
  };
}
