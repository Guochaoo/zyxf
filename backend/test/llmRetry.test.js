import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

// 免费额度（智谱 GLM-*-Flash、硅基流动免费模型）高峰期会回 429，llm.js 现在最多试 3 次。
// setup.js 会把 ../src/llm.js 整体 mock 掉，所以用子进程 import 真实实现。
// 假上游必须也放在子进程里：父进程用 spawnSync 等待子进程时事件循环被占住，
// 父进程里的 http server 根本处理不了请求（第一版就卡死在这里）。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const llmUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'llm.js')).href;

const CHILD = `
import http from 'node:http';
const { chatStream } = await import(${JSON.stringify(llmUrl)});
const script = JSON.parse(process.env.SCRIPT);
const hits = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const step = script[hits.length] ?? script[script.length - 1];
    hits.push(step);
    if (step === 429) {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end('{"error":{"code":"1305","message":"该模型当前访问量过大"}}');
      return;
    }
    if (step === 401) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"error":{"message":"invalid api key"}}');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"ok"}}]}\\n\\n');
    res.write('data: [DONE]\\n\\n');
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const out = { ok: false, events: [], error: null };
try {
  for await (const ev of chatStream({
    messages: [{ role: 'user', content: 'hi' }],
    config: { apiKey: 'test-key', baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1' },
  })) out.events.push(ev);
  out.ok = true;
} catch (e) {
  out.error = e.message;
}
server.close();
await new Promise((r) => server.close(r));
console.log(JSON.stringify({ ...out, hits }));
`;

function runChild(script) {
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
    env: { ...process.env, SCRIPT: JSON.stringify(script), NODE_ENV: 'test' },
    encoding: 'utf8',
    timeout: 30000,
  });
  const line = res.stdout.trim().split('\n').at(-1);
  assert.ok(line, `子进程无输出：${res.stderr}`);
  return { out: JSON.parse(line), stderr: res.stderr };
}

describe('chatStream 对上游 429 的重试（#89）', () => {
  test('连续两次 429 后第三次成功，事件照常产出', () => {
    const { out, stderr } = runChild([429, 429, 200]);
    assert.equal(out.ok, true, `应当最终成功：${out.error}`);
    assert.deepEqual(out.events, [{ type: 'delta', text: 'ok' }]);
    assert.equal(out.hits.length, 3, '应请求三次');
    assert.match(stderr, /\[llm\] upstream 429/, '重试应留下日志');
  });

  test('三次都 429 时报 LLM 上游错误并落日志，不会无限重试', () => {
    const { out, stderr } = runChild([429]);
    assert.equal(out.ok, false);
    assert.match(out.error, /LLM 上游错误 429/);
    assert.equal(out.hits.length, 3, '最多试 3 次');
    assert.match(stderr, /upstream 429: /, '最终失败要落日志');
    assert.doesNotMatch(stderr, /test-key/, '日志不得包含 API key');
  });

  test('非重试状态码（401）立即失败，只请求一次', () => {
    const { out } = runChild([401]);
    assert.equal(out.ok, false);
    assert.match(out.error, /LLM 上游错误 401/);
    assert.equal(out.hits.length, 1);
  });
});
