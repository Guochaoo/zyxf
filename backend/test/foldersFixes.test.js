import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { app } from '../src/index.js';
import { ossObjectStore } from './setup.js';

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
  ossObjectStore.keys = [];
  db.prepare('DELETE FROM download_logs').run();
  db.prepare('DELETE FROM files').run();
  db.prepare('DELETE FROM folders').run();
});

async function request(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: data };
}

async function adminLogin() {
  const { body } = await request('POST', '/api/auth/login', {
    body: { username: 'admin', password: 'admin123' },
  });
  return body.token;
}

async function createFolder(token, name, parent_id) {
  return request('POST', '/api/folders', { token, body: { name, parent_id } });
}

async function registerFile(token, { name, folder_id = null, oss_key, size = 123, mime_type = null }) {
  return request('POST', '/api/files', {
    token,
    body: {
      name,
      folder_id,
      oss_key: oss_key ?? `zyxf-test/${name}`,
      size,
      mime_type,
    },
  });
}

describe('BUG-11: folder names containing path separators are rejected', () => {
  test('POST /api/folders rejects a name with "/" (400)', async () => {
    const token = await adminLogin();
    const r = await createFolder(token, 'a/b');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '文件夹名不能包含斜杠');
  });

  test('POST /api/folders rejects a name with backslash (400)', async () => {
    const token = await adminLogin();
    const r = await createFolder(token, 'a\\b');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '文件夹名不能包含斜杠');
  });

  test('POST /api/folders still accepts a normal name', async () => {
    const token = await adminLogin();
    const r = await createFolder(token, 'a-b');
    assert.equal(r.status, 200);
  });

  test('PATCH /api/folders/:id rejects renaming to a name with "/" (400)', async () => {
    const token = await adminLogin();
    const f = await createFolder(token, 'ok');
    const r = await request('PATCH', `/api/folders/${f.body.id}`, {
      token,
      body: { name: 'bad/name' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '文件夹名不能包含斜杠');
  });
});

describe('BUG-06: flat-query tree returns the same hierarchy', () => {
  test('GET /api/folders/tree preserves nesting, ordering and root files', async () => {
    const token = await adminLogin();
    await createFolder(token, 'Top1');
    const top2 = await createFolder(token, 'Top2');
    await createFolder(token, 'Nested', top2.body.id);
    await createFolder(token, 'Other', top2.body.id);
    await registerFile(token, { name: 'root.pdf', folder_id: null });
    await registerFile(token, {
      name: 'inside.pdf',
      folder_id: top2.body.id,
      oss_key: 'zyxf-test/Top2/inside.pdf',
    });

    const tree = await request('GET', '/api/folders/tree');
    assert.equal(tree.status, 200);
    // Root folders ordered by sort_order/name, root files under `files`.
    assert.deepEqual(tree.body.tree.map((n) => n.name), ['Top1', 'Top2']);
    assert.deepEqual(tree.body.tree[1].children.map((n) => n.name), ['Nested', 'Other']);
    assert.deepEqual(tree.body.files.map((f) => f.name), ['root.pdf']);
    assert.deepEqual(tree.body.tree[1].files.map((f) => f.name), ['inside.pdf']);
    assert.equal(tree.body.tree[1].files[0].folder_id, top2.body.id);
  });

  test('GET /api/folders/tree orders by name COLLATE NOCASE when sort_order ties', async () => {
    const token = await adminLogin();
    const b = await createFolder(token, 'b');
    const a = await createFolder(token, 'A');
    const a2 = await createFolder(token, 'a');
    // Give all three the same sort_order so name COLLATE NOCASE is the tiebreaker.
    db.prepare('UPDATE folders SET sort_order = 0 WHERE id IN (?, ?, ?)').run(
      b.body.id,
      a.body.id,
      a2.body.id
    );
    const tree = await request('GET', '/api/folders/tree');
    assert.deepEqual(tree.body.tree.map((n) => n.name), ['A', 'a', 'b']);
  });
});
