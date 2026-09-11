// llmProtocols 纯函数单测：协议适配层不联网、不读 env，可以直接逐条断言翻译结果。
// （llm.js 的 chatStream 在 test/setup.js 里被 mock，覆盖不到真实解析逻辑，故这里补上。）
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOLS,
  isSupportedProtocol,
  normalizeProtocol,
  createSseSplitter,
  createOpenAiReducer,
  createAnthropicReducer,
  toAnthropicMessages,
  toAnthropicTools,
  buildAnthropicBody,
  buildOpenAiRequest,
  buildAnthropicRequest,
  anthropicUrl,
  anthropicHeaders,
  ANTHROPIC_VERSION,
} from '../src/llmProtocols.js';

/** 把若干文本块喂给 splitter，收集所有 data: 载荷。 */
function collectPayloads(chunks) {
  const splitter = createSseSplitter();
  const out = [];
  for (const c of chunks) out.push(...splitter.push(c));
  out.push(...splitter.end());
  return out;
}

/** 跑完整的「切分 + 解析」流程，返回事件数组与 reducer。 */
function runReducer(reducer, chunks) {
  const events = [];
  for (const payload of collectPayloads(chunks)) events.push(...reducer.feed(payload));
  events.push(...reducer.finish());
  return events;
}

describe('协议名归一化', () => {
  test('受支持的两个协议', () => {
    assert.deepEqual(PROTOCOLS, ['openai', 'anthropic']);
    assert.equal(isSupportedProtocol('openai'), true);
    assert.equal(isSupportedProtocol(' Anthropic '), true);
  });

  test('缺省/未知回落到 openai，但白名单判定对未知值返回 false', () => {
    assert.equal(normalizeProtocol(''), 'openai');
    assert.equal(normalizeProtocol(undefined), 'openai');
    assert.equal(normalizeProtocol('gemini'), 'openai');
    assert.equal(isSupportedProtocol('gemini'), false);
  });
});

describe('SSE 切分', () => {
  test('跨块半行残留在缓冲里，拼接后仍能解析', () => {
    assert.deepEqual(collectPayloads(['data: {"a"', ':1}\n\n']), ['{"a":1}']);
  });

  test('末尾无换行的最后一行由 end() 兜住', () => {
    assert.deepEqual(collectPayloads(['data: {"a":1}\ndata: [DONE]']), ['{"a":1}', '[DONE]']);
  });

  test('非 data: 行（event:/注释）被跳过', () => {
    assert.deepEqual(collectPayloads(['event: ping\ndata: {"a":1}\n\n']), ['{"a":1}']);
  });
});

describe('OpenAI reducer', () => {
  test('文本增量与 [DONE]', () => {
    const reducer = createOpenAiReducer();
    const events = runReducer(reducer, [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    assert.deepEqual(events, [
      { type: 'delta', text: '你' },
      { type: 'delta', text: '好' },
    ]);
    assert.equal(reducer.sawDone, true);
  });

  test('tool_call 增量按 index 组装，arguments 拼成完整 JSON', () => {
    const reducer = createOpenAiReducer();
    const events = runReducer(reducer, [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search_files","arguments":"{\\"q\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"高数\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'tool_calls');
    assert.deepEqual(events[0].tool_calls[0], {
      id: 'call_1',
      type: 'function',
      function: { name: 'search_files', arguments: '{"q":"高数"}' },
    });
  });

  // BUG-12：流被截断时 arguments 不是合法 JSON，这类半截调用不能透传给工具回路。
  test('arguments 被截断的 tool_call 被丢弃', () => {
    const reducer = createOpenAiReducer();
    const events = runReducer(reducer, [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search_files","arguments":"{\\"q\\":\\"高"}}]}}]}\n\n',
    ]);
    assert.deepEqual(events, []);
  });
});

describe('Anthropic reducer', () => {
  test('text_delta 转成统一 delta 事件，message_stop 标记正常结束', () => {
    const reducer = createAnthropicReducer();
    const events = runReducer(reducer, [
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    assert.deepEqual(events, [{ type: 'delta', text: '你好' }]);
    assert.equal(reducer.sawDone, true);
  });

  test('tool_use 块 + input_json_delta 增量拼成 arguments 字符串', () => {
    const reducer = createAnthropicReducer();
    const events = runReducer(reducer, [
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"search_files"}}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\""}}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":":\\"高数\\"}"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].tool_calls[0], {
      id: 'toolu_1',
      type: 'function',
      function: { name: 'search_files', arguments: '{"q":"高数"}' },
    });
  });

  test('中途 error 事件抛 502（含 LLM 字样，便于路由映射成上游故障提示）', () => {
    const reducer = createAnthropicReducer();
    assert.throws(
      () => reducer.feed('{"type":"error","error":{"type":"overloaded_error","message":"busy"}}'),
      (err) => err.status === 502 && /LLM/.test(err.message) && /busy/.test(err.message)
    );
  });
});

describe('OpenAI 形状消息 → Anthropic', () => {
  test('system 抽到顶层，user 内容包成 text 块', () => {
    const { system, messages } = toAnthropicMessages([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '你好' },
    ]);
    assert.equal(system, '你是助手');
    assert.deepEqual(messages, [{ role: 'user', content: [{ type: 'text', text: '你好' }] }]);
  });

  test('assistant.tool_calls → tool_use 块，arguments 解析成 input 对象', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: '高数期末' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'search_files', arguments: '{"q":"高数"}' } },
        ],
      },
    ]);
    assert.deepEqual(messages[1], {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_1', name: 'search_files', input: { q: '高数' } }],
    });
    // content 为 null 时不产出空 text 块（Anthropic 不接受空 content）
    assert.equal(messages[1].content.length, 1);
  });

  test('一轮的多个 tool 结果合并进同一条 user 消息', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '找一下', tool_calls: [{ id: 'call_1', function: { name: 'search_files', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '结果A' },
      { role: 'tool', tool_call_id: 'call_2', content: '结果B' },
    ]);
    assert.equal(messages.length, 3);
    assert.deepEqual(messages[2], {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: '结果A' },
        { type: 'tool_result', tool_use_id: 'call_2', content: '结果B' },
      ],
    });
  });

  test('相邻同角色消息合并（历史里出现连续 user 时上游不至于因角色未交替而拒绝）', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: '一' },
      { role: 'user', content: '二' },
    ]);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].content, [
      { type: 'text', text: '一' },
      { type: 'text', text: '二' },
    ]);
  });

  test('坏 arguments 退化成空 input，不抛错', () => {
    const { messages } = toAnthropicMessages([
      { role: 'assistant', tool_calls: [{ id: 'c', function: { name: 'f', arguments: '{"q":' } }] },
    ]);
    assert.deepEqual(messages[0].content[0].input, {});
  });
});

describe('Anthropic 请求组装', () => {
  test('tools 从 function.parameters 转成 input_schema', () => {
    const tools = toAnthropicTools([
      {
        type: 'function',
        function: { name: 'search_files', description: '搜索', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
      },
    ]);
    assert.deepEqual(tools, [
      {
        name: 'search_files',
        description: '搜索',
        input_schema: { type: 'object', properties: { q: { type: 'string' } } },
      },
    ]);
  });

  test('body：system 与 tools 只在有内容时出现，max_tokens 必填', () => {
    const withTools = buildAnthropicBody({
      model: 'claude-x',
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'f', parameters: {} } }],
      maxTokens: 123,
    });
    assert.equal(withTools.model, 'claude-x');
    assert.equal(withTools.max_tokens, 123);
    assert.equal(withTools.stream, true);
    assert.equal(withTools.system, 'sys');
    assert.equal(withTools.tools.length, 1);

    const plain = buildAnthropicBody({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    assert.ok(plain.max_tokens > 0);
    assert.equal('system' in plain, false);
    assert.equal('tools' in plain, false);
  });

  test('URL 与鉴权头', () => {
    assert.equal(anthropicUrl('https://api.anthropic.com/v1'), 'https://api.anthropic.com/v1/messages');
    const headers = anthropicHeaders('sk-ant');
    assert.equal(headers['x-api-key'], 'sk-ant');
    assert.equal(headers['anthropic-version'], ANTHROPIC_VERSION);
    assert.equal('authorization' in headers, false);
  });
});

// 线上形状（url / headers / body）直接断言：llm.js 只做 fetch + 流转发，这两条覆盖了「发出去长什么样」。
describe('请求组装（线上形状）', () => {
  const tools = [
    { type: 'function', function: { name: 'search_files', description: '搜索', parameters: { type: 'object', properties: {} } } },
  ];
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ];

  test('OpenAI：/chat/completions + Bearer + tool_choice（无工具时不带 tools）', () => {
    const req = buildOpenAiRequest({ baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'm', messages, tools });
    assert.equal(req.url, 'https://llm.test/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer k');
    assert.deepEqual(req.body.messages, messages); // 原样透传，不做翻译
    assert.equal(req.body.stream, true);
    assert.equal(req.body.tool_choice, 'auto');
    assert.equal(req.body.tools.length, 1);
    assert.equal('max_tokens' in req.body, false);

    const noTools = buildOpenAiRequest({ baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'm', messages });
    assert.equal('tools' in noTools.body, false);
    assert.equal('tool_choice' in noTools.body, false);
  });

  test('Anthropic：/messages + x-api-key + system 顶层 + input_schema', () => {
    const req = buildAnthropicRequest({ baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant', model: 'claude', messages, tools });
    assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(req.headers['x-api-key'], 'sk-ant');
    assert.equal(req.headers.authorization, undefined);
    assert.ok(req.body.max_tokens > 0); // Anthropic 必填
    assert.equal(req.body.stream, true);
    assert.equal(req.body.system, 'sys');
    assert.deepEqual(req.body.messages, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
    assert.deepEqual(req.body.tools[0].input_schema, { type: 'object', properties: {} });
    assert.equal('parameters' in req.body.tools[0], false);
  });

  // 两轮工具回路：OpenAI 形状的 assistant(tool_calls) + tool 结果要翻成 tool_use / tool_result，
  // 且同一轮的多个结果合并进同一条 user 消息（Anthropic 的硬性要求）。
  test('Anthropic：工具结果回灌翻译成 tool_use + tool_result', () => {
    const req = buildAnthropicRequest({
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant',
      model: 'claude',
      tools,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: '高数' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'toolu_9', function: { name: 'search_files', arguments: '{"q":"高数"}' } }] },
        { role: 'tool', tool_call_id: 'toolu_9', content: '结果A' },
        { role: 'tool', tool_call_id: 'toolu_10', content: '结果B' },
      ],
    });
    assert.deepEqual(req.body.messages, [
      { role: 'user', content: [{ type: 'text', text: '高数' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_9', name: 'search_files', input: { q: '高数' } }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_9', content: '结果A' },
          { type: 'tool_result', tool_use_id: 'toolu_10', content: '结果B' },
        ],
      },
    ]);
  });
});
