import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { app } from '../src/index.js';
import { signToken } from '../src/auth.js';
import { llmState, ensureTestUser } from './setup.js';

let server;
let base;

before(async () => {
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  llmState.enabled = false;
  llmState.script = [];
  llmState.calls = [];
  db.prepare('DELETE FROM download_logs').run();
  db.prepare('DELETE FROM files').run();
  db.prepare('DELETE FROM folders').run();
});

async function request(method, path, { body, headers } = {}) {
  const res = await fetch(base + path, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }
      : { headers }),
  });
  return res;
}

// IMPROVE-10：自带 Key 的路径要求登录——用它模拟已登录用户（普通用户即可，无需 admin）。
// attachUser 会回查用户行（BUG-51/52），故先落一行真实账号。
const userAuth = () => {
  ensureTestUser({ id: 77, username: 'u', role: 'user' });
  return { authorization: `Bearer ${signToken({ id: 77, username: 'u', role: 'user' })}` };
};

// 读完 SSE 响应并解析出事件数组
async function readSse(res) {
  const text = await res.text();
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload) events.push(JSON.parse(payload));
  }
  return events;
}

function seedLibrary() {
  const now = Date.now();
  db.prepare('INSERT INTO folders (name, parent_id, created_at) VALUES (?, NULL, ?)').run(
    '高等数学',
    now
  );
  const folderId = db.prepare('SELECT id FROM folders WHERE name = ?').get('高等数学').id;
  db.prepare(
    'INSERT INTO files (name, folder_id, oss_key, size, ext, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('高等数学期末版.pdf', folderId, 'zyxf-test/高等数学/高等数学期末版.pdf', 1024, 'pdf', now);
  db.prepare(
    'INSERT INTO files (name, folder_id, oss_key, size, ext, created_at) VALUES (?, NULL, ?, ?, ?, ?)'
  ).run('大学物理作业.pdf', 'zyxf-test/大学物理作业.pdf', 2048, 'pdf', now);
}

function toolCallEvent(q) {
  return [
    {
      type: 'tool_calls',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'search_files', arguments: JSON.stringify({ q }) },
        },
      ],
    },
  ];
}

describe('POST /api/chat', () => {
  test('returns 503 when the LLM is not configured', async () => {
    const res = await request('POST', '/api/chat', { body: { messages: [{ role: 'user', content: 'hi' }] } });
    assert.equal(res.status, 503);
  });

  test('rejects missing or malformed input (400)', async () => {
    llmState.enabled = true;
    const noMessages = await request('POST', '/api/chat', { body: {} });
    assert.equal(noMessages.status, 400);
    const endsWithAssistant = await request('POST', '/api/chat', {
      body: { messages: [{ role: 'assistant', content: 'hi' }] },
    });
    assert.equal(endsWithAssistant.status, 400);
  });

  test('streams a tool-call round, then the answer with cited files', async () => {
    seedLibrary();
    llmState.enabled = true;
    llmState.script = [
      toolCallEvent('高数'),
      [
        { type: 'delta', text: '为你找到高数资料，推荐【文件1】' },
        { type: 'delta', text: '，也可以看看【文件2】。' },
      ],
    ];

    const res = await request('POST', '/api/chat', {
      body: { messages: [{ role: 'user', content: '有没有高数期末题' }] },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);

    const events = await readSse(res);
    const deltas = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
    assert.equal(deltas, '为你找到高数资料，推荐【文件1】，也可以看看【文件2】。');

    const filesEvent = events.find((e) => e.type === 'files');
    assert.ok(filesEvent, 'files event missing');
    assert.equal(filesEvent.files.length, 2);
    // 编号池文件夹在前：【文件1】= 文件夹「高等数学」，【文件2】= 文件
    assert.equal(filesEvent.files[0].type, 'folder');
    assert.equal(filesEvent.files[0].name, '高等数学');
    assert.equal(filesEvent.files[1].name, '高等数学期末版.pdf');
    assert.equal(filesEvent.files[1].folder_path, '高等数学');

    assert.equal(events.at(-1).type, 'done');

    // 第二次上游调用必须带回工具结果（检索结果以编号清单注入）
    assert.equal(llmState.calls.length, 2);
    const toolMsg = llmState.calls[1].messages.find((m) => m.role === 'tool');
    assert.ok(toolMsg, 'tool result message missing');
    assert.match(toolMsg.content, /高等数学期末版\.pdf/);
  });

  test('answers without tools when the LLM skips them', async () => {
    llmState.enabled = true;
    llmState.script = [[{ type: 'delta', text: '资料库里暂时没有相关内容。' }]];

    const res = await request('POST', '/api/chat', {
      body: { messages: [{ role: 'user', content: '有没有量子力学资料' }] },
    });
    const events = await readSse(res);
    assert.equal(events.filter((e) => e.type === 'delta').length, 1);
    assert.equal(events.find((e) => e.type === 'files'), undefined);
    assert.equal(events.at(-1).type, 'done');
    assert.equal(llmState.calls.length, 1);
    assert.ok(llmState.calls[0].tools, 'first round must offer the search tool');
  });

  test('upstream errors surface as an SSE error event', async () => {
    llmState.enabled = true;
    llmState.script = [{ __throw: 'LLM 上游错误 502: boom' }];

    const res = await request('POST', '/api/chat', {
      body: { messages: [{ role: 'user', content: 'hi' }] },
    });
    const events = await readSse(res);
    const err = events.find((e) => e.type === 'error');
    assert.ok(err);
    assert.equal(err.message, 'AI 服务暂时不可用，请稍后再试');
  });

  test('guests are rate limited (short window)', async () => {
    llmState.enabled = true;
    llmState.script = [[{ type: 'delta', text: 'ok' }]];
    const xff = { 'x-forwarded-for': '203.0.113.120' };
    let ok = 0;
    let limited = 0;
    for (let i = 0; i < 7; i++) {
      const res = await request('POST', '/api/chat', {
        headers: xff,
        body: { messages: [{ role: 'user', content: 'q' }] },
      });
      if (res.status === 200) ok += 1;
      else if (res.status === 429) limited += 1;
    }
    assert.equal(ok, 6);
    assert.equal(limited, 1);
  });

  test('client-provided LLM config works for a signed-in user without server env config', async () => {
    llmState.enabled = false; // 服务端未配置
    llmState.script = [[{ type: 'delta', text: 'ok' }]];
    const xff = { 'x-forwarded-for': '203.0.113.130' };

    const res = await request('POST', '/api/chat', {
      headers: { ...xff, ...userAuth() },
      body: {
        messages: [{ role: 'user', content: 'hi' }],
        llm: { apiKey: 'client-key', baseUrl: 'https://llm.test/v1/', model: 'test-model' },
      },
    });
    assert.equal(res.status, 200);
    const events = await readSse(res);
    assert.equal(events.at(-1).type, 'done');
    // 配置被规范化（去尾斜杠）并传给 LLM 客户端
    assert.deepEqual(llmState.calls[0].config, {
      apiKey: 'client-key',
      baseUrl: 'https://llm.test/v1',
      model: 'test-model',
    });
  });

  // IMPROVE-10：服务端未配置时，自带 Key 的路径等于让本站代理任意公网 https 上游 → 必须登录。
  test('anonymous client-config requests are rejected (401)', async () => {
    llmState.enabled = false;
    const xff = { 'x-forwarded-for': '203.0.113.132' };
    const res = await request('POST', '/api/chat', {
      headers: xff,
      body: {
        messages: [{ role: 'user', content: 'hi' }],
        llm: { apiKey: 'client-key', baseUrl: 'https://llm.test/v1', model: 'test-model' },
      },
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /登录/);
    // 在鉴权前就拒绝：既不解析客户端 baseUrl，也不触达上游
    assert.equal(llmState.calls.length, 0);
  });

  // 生产主场景（服务端已配置 LLM_*）不受 IMPROVE-10 影响：匿名照旧可用，且客户端配置被忽略。
  test('anonymous requests still work when the server has its own LLM config', async () => {
    llmState.enabled = true;
    llmState.script = [[{ type: 'delta', text: 'ok' }]];
    const res = await request('POST', '/api/chat', {
      headers: { 'x-forwarded-for': '203.0.113.133' },
      body: {
        messages: [{ role: 'user', content: 'hi' }],
        llm: { apiKey: 'client-key', baseUrl: 'https://llm.test/v1', model: 'test-model' },
      },
    });
    assert.equal(res.status, 200);
    assert.equal(llmState.calls[0].config, undefined);
  });

  test('invalid client config falls back to none → 503', async () => {
    llmState.enabled = false;
    const xff = { 'x-forwarded-for': '203.0.113.131', ...userAuth() };
    const badProtocol = await request('POST', '/api/chat', {
      headers: xff,
      body: {
        messages: [{ role: 'user', content: 'hi' }],
        llm: { apiKey: 'k', baseUrl: 'ftp://llm.test', model: 'm' },
      },
    });
    assert.equal(badProtocol.status, 503);

    const incomplete = await request('POST', '/api/chat', {
      headers: xff,
      body: {
        messages: [{ role: 'user', content: 'hi' }],
        llm: { apiKey: 'k', model: 'm' },
      },
    });
    assert.equal(incomplete.status, 503);
  });
});
