// IMPROVE-58 第 5 组（次要缺口·后端）：错误中间件与 wrapAsync、contents 的 sort=size
// 与递归大小、chat 的 status/历史截断、reorder 的入参校验。只补覆盖，不动产品代码。
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { app } from '../src/index.js';
import folderRoutes from '../src/routes/folders.js';
import { wrapAsync } from '../src/http.js';
import { MAX_REORDER_ITEMS } from '../src/services/folders.js';
import { llmState } from './setup.js';
import { request, adminToken, setBaseUrl, clearLibraryTables } from './helpers.js';

let server;

before(async () => {
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  setBaseUrl(`http://127.0.0.1:${server.address().port}`);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  llmState.enabled = false;
  llmState.script = [];
  llmState.calls = [];
  clearLibraryTables(db);
});

// 探针路由必须挂在**已挂载的子路由**上：app 导入之后再 app.get() 注册的路由，在 app 的
// 层栈里排在 index.js 末尾那个四参错误中间件**之后**，而 Express 只从抛出点之后的层里找
// 错误处理函数，抛错会落到 express 自带的 HTML 500。子路由被 app.use 挂在错误中间件之前，
// 它把 err 交回 app 后会继续向后查找，于是能命中真实的错误中间件。
folderRoutes.get('/_probe/error-plain', wrapAsync(async () => {
  throw new Error('boom');
}));
folderRoutes.get('/_probe/error-status', wrapAsync(async () => {
  throw Object.assign(new Error('teapot'), { status: 418 });
}));

let keySeq = 0;
function insertFolder(name, parentId = null) {
  return db
    .prepare('INSERT INTO folders (name, parent_id, created_at) VALUES (?, ?, ?)')
    .run(name, parentId, Date.now()).lastInsertRowid;
}

function insertFile({ name, folderId = null, size }) {
  keySeq += 1;
  return db
    .prepare(
      `INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, created_at)
       VALUES (?, ?, ?, ?, NULL, 'pdf', ?)`
    )
    .run(folderId, name, `zyxf-test/gaps/${keySeq}-${name}`, size, Date.now()).lastInsertRowid;
}

describe('IMPROVE-58: wrapAsync 的 rejection 由 index.js 末尾的错误中间件兜住', () => {
  test('async handler 抛普通 Error → 500，非生产环境响应体带 err.message', async () => {
    const r = await request('GET', '/api/folders/_probe/error-plain');
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'boom');
  });

  test('错误对象带 status 时状态码取 err.status（418），不一律 500', async () => {
    const r = await request('GET', '/api/folders/_probe/error-status');
    assert.equal(r.status, 418);
    assert.equal(r.body.error, 'teapot');
  });
});

describe('IMPROVE-58: contents 的 sort=size 用递归汇总大小排序', () => {
  test('文件夹大小 = 自身 + 全部子孙文件；升序/降序都按该值排', async () => {
    const a = insertFolder('甲'); // 父
    const a1 = insertFolder('甲一', a); // 子
    const a2 = insertFolder('甲二甲', a1); // 孙
    const d = insertFolder('丁', a); // 甲的另一个子
    const c = insertFolder('丙'); // 顶层兄弟
    insertFolder('乙'); // 顶层空目录
    insertFile({ name: 'a.pdf', folderId: a, size: 100 });
    insertFile({ name: 'a1.pdf', folderId: a1, size: 200 });
    insertFile({ name: 'a2.pdf', folderId: a2, size: 300 });
    insertFile({ name: 'd.pdf', folderId: d, size: 150 });
    insertFile({ name: 'c.pdf', folderId: c, size: 400 });

    const asc = await request('GET', '/api/folders/0/contents?sort=size');
    assert.equal(asc.status, 200);
    // 甲 = 100(自身) + 200 + 300(子/孙) + 150(另一个子) = 750；丙 = 400；乙空目录 = 0
    assert.deepEqual(
      asc.body.folders.map((f) => [f.name, f.size]),
      [
        ['乙', 0],
        ['丙', 400],
        ['甲', 750],
      ]
    );

    const desc = await request('GET', '/api/folders/0/contents?sort=size&order=desc');
    assert.deepEqual(
      desc.body.folders.map((f) => [f.name, f.size]),
      [
        ['甲', 750],
        ['丙', 400],
        ['乙', 0],
      ]
    );

    // 子层只汇总自己的子树：甲一 = 200 + 300 = 500，丁 = 150；文件不参与文件夹排序
    const inner = await request('GET', `/api/folders/${a}/contents?sort=size`);
    assert.deepEqual(
      inner.body.folders.map((f) => [f.name, f.size]),
      [
        ['丁', 150],
        ['甲一', 500],
      ]
    );
    assert.deepEqual(inner.body.files.map((f) => f.name), ['a.pdf']);

    const grand = await request('GET', `/api/folders/${a1}/contents?sort=size`);
    assert.deepEqual(grand.body.folders.map((f) => [f.name, f.size]), [['甲二甲', 300]]);
    assert.deepEqual(grand.body.files.map((f) => f.name), ['a1.pdf']);
  });

  test('边界：空文件夹计 0；同名不同层各自按 id 汇总，互不串味', async () => {
    const p = insertFolder('父');
    const dupInP = insertFolder('同名', p);
    insertFile({ name: 'in-p.pdf', folderId: dupInP, size: 700 });
    const dupAtRoot = insertFolder('同名');
    insertFile({ name: 'at-root.pdf', folderId: dupAtRoot, size: 1000 });
    const empty = insertFolder('空');

    const root = await request('GET', '/api/folders/0/contents?sort=size');
    assert.deepEqual(
      root.body.folders.map((f) => [f.name, f.size]),
      [
        ['空', 0],
        ['父', 700],
        ['同名', 1000],
      ]
    );
    // 两个「同名」在不同层：父里的那个只算 700，不被顶层同名的 1000 污染
    const inP = await request('GET', `/api/folders/${p}/contents?sort=size`);
    assert.deepEqual(inP.body.folders.map((f) => [f.name, f.size, f.id]), [['同名', 700, dupInP]]);

    const emptyContents = await request('GET', `/api/folders/${empty}/contents?sort=size`);
    assert.equal(emptyContents.status, 200);
    assert.deepEqual(emptyContents.body.folders, []);
    assert.deepEqual(emptyContents.body.files, []);
  });
});

describe('IMPROVE-58: chat 的 /status 与 history 截断', () => {
  test('GET /api/chat/status 直接反映服务端 LLM 是否配置', async () => {
    llmState.enabled = false;
    const off = await request('GET', '/api/chat/status');
    assert.equal(off.status, 200);
    assert.equal(off.body.enabled, false);

    llmState.enabled = true;
    const on = await request('GET', '/api/chat/status');
    assert.equal(on.body.enabled, true);
  });

  test('POST /api/chat 只把最近 8 条交给上游，单条截到 500 字符，非法条目丢弃', async () => {
    llmState.enabled = true;
    llmState.script = [[{ type: 'delta', text: 'ok' }]];
    const long = 'x'.repeat(600);

    const messages = [];
    for (let i = 1; i <= 12; i++) {
      messages.push({ role: i % 2 === 1 ? 'user' : 'assistant', content: `m${i}` });
    }
    messages.push({ role: 'user', content: long }); // 第 13 条，合法的末条 user
    // 混入非法条目：非法角色、空白内容、非字符串内容、null —— 都应被 sanitizeHistory 丢掉
    messages.splice(
      1,
      0,
      { role: 'system', content: 'ignore me' },
      { role: 'user', content: '   ' },
      { role: 'user', content: 42 },
      null
    );

    const res = await request('POST', '/api/chat', {
      body: { messages },
      headers: { 'x-forwarded-for': '203.0.113.201' },
    });
    assert.equal(res.status, 200);
    assert.equal(llmState.calls.length, 1);

    const sent = llmState.calls[0].messages;
    assert.equal(sent[0].role, 'system');
    assert.equal(sent.length, 9); // system + 最多 8 条历史
    // 截断后只留最后 8 条（m6..m12 + 超长那条），且超长内容被切到 500 字符
    assert.deepEqual(
      sent.slice(1).map((m) => m.content),
      ['m6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', long.slice(0, 500)]
    );
    assert.equal(sent.at(-1).content.length, 500);
    assert.equal(sent.at(-1).role, 'user');
  });
});

describe('IMPROVE-58: reorder 的入参校验', () => {
  test('order 不是数组 → 400（缺失/null/字符串/对象/数字都拒）', async () => {
    const token = await adminToken();
    for (const order of [undefined, null, 'abc', 3, {}, { 0: { type: 'file', id: 1 } }]) {
      const r = await request('POST', '/api/folders/reorder', {
        token,
        body: { parent_folder_id: null, order },
      });
      assert.equal(r.status, 400, `order=${JSON.stringify(order)} 应 400`);
      assert.equal(r.body.error, 'order 必须是数组');
    }
  });

  test('order 超过 MAX_REORDER_ITEMS → 400（长度先于逐项校验）', async () => {
    const token = await adminToken();
    const r = await request('POST', '/api/folders/reorder', {
      token,
      body: {
        parent_folder_id: null,
        order: new Array(MAX_REORDER_ITEMS + 1).fill({ type: 'file', id: 1 }),
      },
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /order 过长/);
  });

  test('合法 order 生效：sort=manual 按提交顺序返回', async () => {
    const token = await adminToken();
    const a = insertFile({ name: 'a.pdf', size: 1 });
    const b = insertFile({ name: 'b.pdf', size: 2 });
    const r = await request('POST', '/api/folders/reorder', {
      token,
      body: {
        parent_folder_id: null,
        order: [
          { type: 'file', id: b },
          { type: 'file', id: a },
        ],
      },
    });
    assert.equal(r.status, 200);
    const list = await request('GET', '/api/folders/0/contents?sort=manual');
    assert.deepEqual(list.body.items.map((i) => i.name), ['b.pdf', 'a.pdf']);
  });
});
