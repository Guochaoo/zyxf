import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { signToken } from '../src/auth.js';
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

// Fresh data for every test; the seeded admin user stays.
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

function userToken() {
  return signToken({ id: 99, username: 'guest', role: 'user' });
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

describe('GET /api/health', () => {
  test('returns ok', async () => {
    const { status, body } = await request('GET', '/api/health');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(typeof body.time, 'number');
  });
});

describe('POST /api/auth/login', () => {
  test('logs in with valid credentials', async () => {
    const { status, body } = await request('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'admin123' },
    });
    assert.equal(status, 200);
    assert.ok(body.token);
    assert.equal(body.user.username, 'admin');
    assert.equal(body.user.role, 'admin');
  });

  test('rejects missing credentials (400)', async () => {
    const { status } = await request('POST', '/api/auth/login', { body: {} });
    assert.equal(status, 400);
  });

  test('rejects wrong password and unknown user (401)', async () => {
    const bad1 = await request('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'nope' },
    });
    assert.equal(bad1.status, 401);
    const bad2 = await request('POST', '/api/auth/login', {
      body: { username: 'ghost', password: 'whatever' },
    });
    assert.equal(bad2.status, 401);
  });
});

describe('GET /api/auth/me', () => {
  test('anonymous user is null', async () => {
    const { status, body } = await request('GET', '/api/auth/me');
    assert.equal(status, 200);
    assert.deepEqual(body, { user: null });
  });

  test('returns the token payload when authenticated', async () => {
    const token = await adminLogin();
    const { body } = await request('GET', '/api/auth/me', { token });
    assert.equal(body.user.username, 'admin');
  });
});

describe('folders', () => {
  test('create requires admin', async () => {
    assert.equal((await request('POST', '/api/folders', { body: { name: 'x' } })).status, 401);
    assert.equal((await createFolder(userToken(), 'x')).status, 403);
  });

  test('create + list root contents', async () => {
    const token = await adminLogin();
    const created = await createFolder(token, '\u8bfe\u7a0b\u8d44\u6599');
    assert.equal(created.status, 200);
    assert.ok(created.body.id > 0);

    const list = await request('GET', '/api/folders/0/contents', { token });
    assert.equal(list.status, 200);
    assert.equal(list.body.folder.id, 0);
    assert.deepEqual(list.body.folders.map((f) => f.name), ['\u8bfe\u7a0b\u8d44\u6599']);
    assert.deepEqual(list.body.files, []);
    assert.deepEqual(list.body.breadcrumb, [{ id: 0, name: '\u9996\u9875' }]);
  });

  test('rejects empty name, missing parent, duplicates (409)', async () => {
    const token = await adminLogin();
    assert.equal((await createFolder(token, '  ')).status, 400);
    assert.equal((await createFolder(token, 'a', 999)).status, 400);
    assert.equal((await createFolder(token, 'a')).status, 200);
    assert.equal((await createFolder(token, 'a')).status, 409);
  });

  test('nested folders and breadcrumb', async () => {
    const token = await adminLogin();
    const a = await createFolder(token, 'A');
    const b = await createFolder(token, 'B', a.body.id);
    const list = await request('GET', `/api/folders/${b.body.id}/contents`, { token });
    assert.deepEqual(list.body.breadcrumb.map((c) => c.name), ['\u9996\u9875', 'A', 'B']);
    assert.equal(list.body.folder.parent_id, a.body.id);
  });

  test('GET /folders/tree returns the full hierarchy', async () => {
    const token = await adminLogin();
    await createFolder(token, 'Top1');
    const top2 = await createFolder(token, 'Top2');
    const nested = await createFolder(token, 'Nested', top2.body.id);
    await registerFile(token, { name: 'root.pdf', folder_id: null });
    await registerFile(token, {
      name: 'inside.pdf',
      folder_id: top2.body.id,
      oss_key: 'zyxf-test/Top2/inside.pdf',
    });

    const tree = await request('GET', '/api/folders/tree');
    assert.equal(tree.status, 200);
    assert.deepEqual(
      tree.body.tree.map((n) => n.name),
      ['Top1', 'Top2']
    );
    assert.deepEqual(
      tree.body.tree[1].children.map((n) => n.name),
      ['Nested']
    );
    assert.deepEqual(
      tree.body.files.map((f) => f.name),
      ['root.pdf']
    );
    assert.deepEqual(
      tree.body.tree[1].files.map((f) => f.name),
      ['inside.pdf']
    );
    assert.equal(tree.body.tree[1].files[0].folder_id, top2.body.id);
    assert.deepEqual(tree.body.tree[0].children, []);
    assert.deepEqual(tree.body.tree[0].files, []);
  });

  test('missing/garbage folder ids', async () => {
    assert.equal((await request('GET', '/api/folders/999/contents')).status, 404);
    assert.equal((await request('GET', '/api/folders/abc/contents')).status, 400);
  });

  test('sort and order are applied', async () => {
    const token = await adminLogin();
    await createFolder(token, 'b');
    await createFolder(token, 'a');
    const asc = await request('GET', '/api/folders/0/contents?sort=name&order=asc');
    assert.deepEqual(asc.body.folders.map((f) => f.name), ['a', 'b']);
    const desc = await request('GET', '/api/folders/0/contents?sort=name&order=desc');
    assert.deepEqual(desc.body.folders.map((f) => f.name), ['b', 'a']);
  });

  test('rename folder (metadata + placeholder key move)', async () => {
    const token = await adminLogin();
    const f = await createFolder(token, 'Old');
    const renamed = await request('PATCH', `/api/folders/${f.body.id}`, {
      token,
      body: { name: 'New' },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.name, 'New');
    const list = await request('GET', '/api/folders/0/contents');
    assert.deepEqual(list.body.folders.map((x) => x.name), ['New']);
  });

  test('rename rejects same-parent duplicates', async () => {
    const token = await adminLogin();
    const a = await createFolder(token, 'a');
    await createFolder(token, 'b');
    assert.equal((await request('PATCH', `/api/folders/${a.body.id}`, { token, body: { name: 'b' } })).status, 409);
  });

  test('move folder and cycle detection', async () => {
    const token = await adminLogin();
    const a = await createFolder(token, 'A');
    const b = await createFolder(token, 'B');
    const c = await createFolder(token, 'C');

    assert.equal((await request('PATCH', `/api/folders/${b.body.id}`, { token, body: { parent_id: a.body.id } })).status, 200);
    assert.equal((await request('PATCH', `/api/folders/${a.body.id}`, { token, body: { parent_id: b.body.id } })).status, 400);
    assert.equal((await request('PATCH', `/api/folders/${a.body.id}`, { token, body: { parent_id: a.body.id } })).status, 400);
    assert.equal((await request('PATCH', `/api/folders/${c.body.id}`, { token, body: { parent_id: 999 } })).status, 400);
  });

  test('reorder mixed folders + files', async () => {
    const token = await adminLogin();
    const fa = await createFolder(token, 'folder-a');
    const fb = await createFolder(token, 'folder-b');
    const f1 = await registerFile(token, { name: 'one.txt' });
    const f2 = await registerFile(token, { name: 'two.txt' });

    const reordered = await request('POST', '/api/folders/reorder', {
      token,
      body: {
        parent_folder_id: null,
        order: [
          { type: 'file', id: f1.body.id },
          { type: 'folder', id: fb.body.id },
          { type: 'file', id: f2.body.id },
          { type: 'folder', id: fa.body.id },
        ],
      },
    });
    assert.equal(reordered.status, 200);

    const list = await request('GET', '/api/folders/0/contents?sort=manual');
    const order = [...list.body.files, ...list.body.folders]
      .sort((x, y) => x.sort_order - y.sort_order)
      .map((x) => x.name);
    assert.deepEqual(order, ['one.txt', 'folder-b', 'two.txt', 'folder-a']);
  });

  test('reorder validates ownership', async () => {
    const token = await adminLogin();
    const parent = await createFolder(token, 'parent');
    const f = await createFolder(token, 'f', parent.body.id);
    const bad = await request('POST', '/api/folders/reorder', {
      token,
      body: { parent_folder_id: null, order: [{ type: 'folder', id: f.body.id }] },
    });
    assert.equal(bad.status, 400);
  });

  test('delete folder cascades to files', async () => {
    const token = await adminLogin();
    const folder = await createFolder(token, 'trash');
    await registerFile(token, {
      name: 'gone.txt',
      folder_id: folder.body.id,
      oss_key: 'zyxf-test/trash/gone.txt',
    });
    const del = await request('DELETE', `/api/folders/${folder.body.id}`, { token });
    assert.equal(del.status, 200);
    assert.ok(del.body.removed_files >= 1);
    const search = await request('GET', '/api/search?q=gone');
    assert.deepEqual(search.body.files, []);
  });
});

describe('files', () => {
  test('upload-url requires admin and validates input', async () => {
    const anon = await request('POST', '/api/files/upload-url', { body: { filename: 'a.txt' } });
    assert.equal(anon.status, 401);

    const token = await adminLogin();
    assert.equal((await request('POST', '/api/files/upload-url', { token, body: { filename: '' } })).status, 400);
    assert.equal((await request('POST', '/api/files/upload-url', { token, body: { filename: 'a.exe' } })).status, 415);
    assert.equal((await request('POST', '/api/files/upload-url', { token, body: { filename: 'a.html' } })).status, 415);
    assert.equal((await request('POST', '/api/files/upload-url', { token, body: { filename: 'a.txt', folder_id: 999 } })).status, 400);
  });

  test('upload-url returns a usable signed policy', async () => {
    const token = await adminLogin();
    const { status, body } = await request('POST', '/api/files/upload-url', {
      token,
      body: { filename: '\u62a5\u544a.pdf' },
    });
    assert.equal(status, 200);
    assert.equal(body.host, 'https://zyxf.test');
    assert.equal(body.key, 'zyxf-test/\u62a5\u544a.pdf');
    assert.equal(body.OSSAccessKeyId, 'test-access-key-id');
    assert.ok(body.policy);
    assert.ok(body.signature);
    assert.equal(body.ext, '.pdf');
    const decoded = JSON.parse(Buffer.from(body.policy, 'base64').toString());
    assert.ok(decoded.expiration);
    assert.deepEqual(decoded.conditions, [
      ['content-length-range', 0, 200 * 1024 * 1024],
      ['eq', '$key', 'zyxf-test/\u62a5\u544a.pdf'],
      ['eq', '$success_action_status', '200'],
    ]);
  });

  test('control characters cannot smuggle a blocked extension past validation', async () => {
    const token = await adminLogin();
    const r = await request('POST', '/api/files/upload-url', {
      token,
      body: { filename: 'evil\u0000.exe' },
    });
    assert.equal(r.status, 415);
  });

  test('register file and duplicate detection', async () => {
    const token = await adminLogin();
    const ok = await registerFile(token, { name: 'a.txt' });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.id > 0);

    assert.equal((await registerFile(token, { name: 'a.txt' })).status, 409);
    assert.equal((await registerFile(token, { name: '' })).status, 400);

    const missing = await request('POST', '/api/files', { token, body: { name: 'b.txt', size: 'NaN' } });
    assert.equal(missing.status, 400);
  });

  test('oss_key must match the folder path', async () => {
    const token = await adminLogin();
    const folder = await createFolder(token, 'dir');
    const wrongKey = await request('POST', '/api/files', {
      token,
      body: { name: 'a.txt', folder_id: folder.body.id, oss_key: 'zyxf-test/other/a.txt', size: 1 },
    });
    assert.equal(wrongKey.status, 400);
    const rightKey = await registerFile(token, {
      name: 'a.txt',
      folder_id: folder.body.id,
      oss_key: 'zyxf-test/dir/a.txt',
    });
    assert.equal(rightKey.status, 200);
  });

  test('GET /:id/url serves preview vs download', async () => {
    const token = await adminLogin();
    const f = await registerFile(token, { name: 'doc.pdf' });
    const id = f.body.id;

    const preview = await request('GET', `/api/files/${id}/url`);
    assert.equal(preview.status, 200);
    assert.ok(preview.body.url.startsWith('https://'));
    assert.equal(preview.body.name, 'doc.pdf');
    assert.equal(preview.body.ext, 'pdf');
    assert.equal(preview.body.mime_type, 'application/pdf');
    assert.equal(preview.body.force_download, false);

    const download = await request('GET', `/api/files/${id}/url?download=1`);
    assert.equal(download.status, 200);
    assert.equal(download.body.force_download, true);
  });

  test('GET /:id/weboffice-token returns preview credentials', async () => {
    const token = await adminLogin();
    const f = await registerFile(token, { name: 'doc.pdf' });
    const r = await request('GET', `/api/files/${f.body.id}/weboffice-token`);
    assert.equal(r.status, 200);
    assert.ok(r.body.url && r.body.url.startsWith('https://'));
    assert.ok(r.body.token);
  });

  test('weboffice-token rejects non-previewable types', async () => {
    const token = await adminLogin();
    const f = await registerFile(token, { name: 'pack.zip' });
    const r = await request('GET', `/api/files/${f.body.id}/weboffice-token`);
    assert.equal(r.status, 415);
  });

  test('POST /:id/weboffice-refresh rotates the access token', async () => {
    const token = await adminLogin();
    const f = await registerFile(token, { name: 'doc.pdf' });
    const r = await request('POST', `/api/files/${f.body.id}/weboffice-refresh`, {
      token,
      body: { access_token: 'old-token', refresh_token: 'refresh-me' },
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
    assert.notEqual(r.body.token, 'old-token');
  });

  test('weboffice-refresh requires tokens', async () => {
    const token = await adminLogin();
    const f = await registerFile(token, { name: 'doc.pdf' });
    assert.equal(
      (await request('POST', `/api/files/${f.body.id}/weboffice-refresh`, { token, body: {} })).status,
      400
    );
  });

  test('archives always force download, even in preview mode', async () => {
    const token = await adminLogin();
    const f = await registerFile(token, { name: 'pack.zip' });
    const { body } = await request('GET', `/api/files/${f.body.id}/url`);
    assert.equal(body.force_download, true);
  });

  test('downloads are logged (deduplicated per file+ip)', async () => {
    const token = await adminLogin();
    const f = await registerFile(token, { name: 'log.txt' });
    await request('GET', `/api/files/${f.body.id}/url?download=1`);
    await request('GET', `/api/files/${f.body.id}/url?download=1`);
    const row = db.prepare('SELECT COUNT(*) c FROM download_logs').get();
    assert.equal(row.c, 1);
  });

  test('invalid and missing file ids', async () => {
    assert.equal((await request('GET', '/api/files/abc/url')).status, 400);
    assert.equal((await request('GET', '/api/files/999/url')).status, 404);
    assert.equal((await request('DELETE', '/api/files/999', { token: await adminLogin() })).status, 404);
  });

  test('rename file updates name, ext and oss key', async () => {
    const token = await adminLogin();
    const f = await registerFile(token, { name: 'old.txt' });
    const r = await request('PATCH', `/api/files/${f.body.id}`, { token, body: { name: 'new.pdf' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'new.pdf');
    assert.equal(r.body.oss_key, 'zyxf-test/new.pdf');

    const { body } = await request('GET', `/api/files/${f.body.id}/url`);
    assert.equal(body.name, 'new.pdf');
    assert.equal(body.ext, 'pdf');
  });

  test('rename rejects duplicates and blocked extensions', async () => {
    const token = await adminLogin();
    const a = await registerFile(token, { name: 'a.txt' });
    const b = await registerFile(token, { name: 'b.txt' });
    assert.equal((await request('PATCH', `/api/files/${b.body.id}`, { token, body: { name: 'a.txt' } })).status, 409);
    assert.equal((await request('PATCH', `/api/files/${a.body.id}`, { token, body: { name: 'evil.exe' } })).status, 415);
  });

  test('move file to another folder updates its oss key', async () => {
    const token = await adminLogin();
    const folder = await createFolder(token, 'dest');
    const f = await registerFile(token, { name: 'm.txt' });
    const r = await request('PATCH', `/api/files/${f.body.id}`, { token, body: { folder_id: folder.body.id } });
    assert.equal(r.status, 200);
    assert.equal((await request('PATCH', `/api/files/${f.body.id}`, { token, body: { folder_id: 999 } })).status, 400);

    const { body } = await request('GET', `/api/files/${f.body.id}/url`);
    assert.ok(body.url.includes('dest/m.txt'));
  });

  test('delete file', async () => {
    const token = await adminLogin();
    const f = await registerFile(token, { name: 'bye.txt' });
    assert.equal((await request('DELETE', `/api/files/${f.body.id}`, { token })).status, 200);
    assert.equal((await request('GET', `/api/files/${f.body.id}/url`)).status, 404);
  });

  test('cleanup-upload only accepts keys under the configured prefix', async () => {
    const token = await adminLogin();
    const outside = await request('POST', '/api/files/cleanup-upload', { token, body: { oss_key: 'outside/key' } });
    assert.equal(outside.status, 400);
    const inside = await request('POST', '/api/files/cleanup-upload', { token, body: { oss_key: 'zyxf-test/leftover.txt' } });
    assert.equal(inside.status, 200);
  });
});

describe('search', () => {
  test('empty query returns empty results', async () => {
    const { body } = await request('GET', '/api/search?q=%20%20');
    assert.deepEqual(body, { folders: [], files: [] });
  });

  test('matches folders and files by name', async () => {
    const token = await adminLogin();
    await createFolder(token, '\u671f\u672b\u8d44\u6599');
    await registerFile(token, { name: '\u671f\u672b\u8bd5\u5377.pdf' });
    await registerFile(token, { name: '\u65e0\u5173.txt' });

    const { body } = await request('GET', '/api/search?q=\u671f\u672b');
    assert.deepEqual(body.folders.map((f) => f.name), ['\u671f\u672b\u8d44\u6599']);
    assert.deepEqual(body.files.map((f) => f.name), ['\u671f\u672b\u8bd5\u5377.pdf']);
  });
});

describe('stats', () => {
  test('anonymous sees aggregates only; admin sees lists too', async () => {
    const token = await adminLogin();
    await registerFile(token, { name: 's.pdf', size: 1000 });

    const anon = await request('GET', '/api/stats');
    assert.equal(anon.status, 200);
    assert.equal(anon.body.total_files, 1);
    assert.equal(anon.body.total_size, 1000);
    assert.ok(anon.body.series.length >= 7);
    assert.ok(Array.isArray(anon.body.type_breakdown));
    assert.equal(anon.body.top_downloads, undefined);
    assert.equal(anon.body.recent_uploads, undefined);

    const admin = await request('GET', '/api/stats', { token });
    assert.equal(admin.body.top_downloads.length, 0);
    assert.equal(admin.body.recent_uploads.length, 1);
    assert.deepEqual(admin.body.recent_uploads[0].name, 's.pdf');
  });

  test('range is clamped to [7, 90]', async () => {
    const small = await request('GET', '/api/stats?range=3');
    assert.equal(small.body.range, 7);
    const big = await request('GET', '/api/stats?range=999');
    assert.equal(big.body.range, 90);
  });

  test('download counts today', async () => {
    const token = await adminLogin();
    const f = await registerFile(token, { name: 'd.txt' });
    await request('GET', `/api/files/${f.body.id}/url?download=1`);
    const { body } = await request('GET', '/api/stats');
    assert.equal(body.today_downloads, 1);
  });
});

describe('sync', () => {
  test('imports files and folders that exist in OSS but not locally', async () => {
    ossObjectStore.keys = [
      'zyxf-test/\u8bfe\u7a0b/', // 课程/
      'zyxf-test/\u8bfe\u7a0b/\u9ad8\u6570.pdf', // 高数.pdf
      'zyxf-test/\u8bfe\u7a0b/\u56fe\u4e66/\u4f5c\u4e1a.pdf', // 图书/作业.pdf
      'zyxf-test/root-file.txt',
    ];
    const { status, body } = await request('POST', '/api/sync');
    assert.equal(status, 200);
    assert.deepEqual(body.added, { folders: 2, files: 3 });
    assert.equal(body.removed.files, 0);

    const tree = await request('GET', '/api/folders/tree');
    assert.deepEqual(tree.body.tree.map((f) => f.name), ['\u8bfe\u7a0b']);
    assert.deepEqual(
      tree.body.tree[0].children.map((f) => f.name),
      ['\u56fe\u4e66']
    );

    const root = await request('GET', '/api/folders/0/contents');
    assert.deepEqual(root.body.files.map((f) => f.name), ['root-file.txt']);
    assert.equal(root.body.files[0].ext, 'txt');
    const course = await request('GET', '/api/folders/' + tree.body.tree[0].id + '/contents');
    assert.deepEqual(course.body.files.map((f) => f.name), ['\u9ad8\u6570.pdf']);
    assert.equal(course.body.files[0].ext, 'pdf');
  });

  test('sync repairs broken ext columns (whole filename stored)', async () => {
    const token = await adminLogin();
    await registerFile(token, {
      name: 'broken.pdf',
      oss_key: 'zyxf-test/broken.pdf',
      // simulate the old bug: ext stored as the whole filename
      mime_type: null,
    });
    db.prepare("UPDATE files SET ext = 'broken.pdf' WHERE oss_key = 'zyxf-test/broken.pdf'").run();

    ossObjectStore.keys = ['zyxf-test/broken.pdf'];
    const { body } = await request('POST', '/api/sync', { token });
    assert.equal(body.repaired_files, 1);
    const row = db.prepare("SELECT ext FROM files WHERE oss_key = 'zyxf-test/broken.pdf'").get();
    assert.equal(row.ext, 'pdf');
  });

  test('sync is idempotent — second run adds nothing', async () => {
    ossObjectStore.keys = ['zyxf-test/a.pdf'];
    await request('POST', '/api/sync');
    const second = await request('POST', '/api/sync');
    assert.deepEqual(second.body.added, { folders: 0, files: 0 });
  });

  test('removes local records whose OSS object is gone, then prunes empty folders', async () => {
    const token = await adminLogin();
    await createFolder(token, '\u65e7\u6587\u4ef6\u5939'); // 旧文件夹
    await registerFile(token, { name: 'stale.pdf', oss_key: 'zyxf-test/stale.pdf' });

    ossObjectStore.keys = ['zyxf-test/\u4fdd\u7559/\u5b58\u5728.pdf']; // 保留/存在.pdf
    const { body } = await request('POST', '/api/sync', { token });
    assert.equal(body.removed.files, 1);
    assert.equal(body.removed.folders, 1); // 旧文件夹 is empty & unrepresented

    const tree = await request('GET', '/api/folders/tree');
    assert.deepEqual(tree.body.tree.map((f) => f.name), ['\u4fdd\u7559']);
  });

  test('empty listing never wipes the local library', async () => {
    const token = await adminLogin();
    await registerFile(token, { name: 'keep.pdf' });
    const { body } = await request('POST', '/api/sync', { token }); // ossObjectStore.keys = []
    assert.equal(body.scanned, 0);
    assert.deepEqual(body.removed, { folders: 0, files: 0 });
    const root = await request('GET', '/api/folders/0/contents');
    assert.equal(root.body.files.length, 1);
  });

  test('admin bypasses the per-IP rate limit', async () => {
    const token = await adminLogin();
    for (let i = 0; i < 6; i++) {
      const { status } = await request('POST', '/api/sync', { token });
      assert.equal(status, 200);
    }
  });

  test('anonymous is rate limited to 5 syncs per minute per IP', async () => {
    // Unique XFF IP so this test never shares quota with other tests.
    const xff = { 'x-forwarded-for': '203.0.113.99' };
    let ok = 0;
    let limited = 0;
    for (let i = 0; i < 6; i++) {
      const { status } = await request('POST', '/api/sync', { headers: xff });
      if (status === 200) ok += 1;
      else if (status === 429) limited += 1;
    }
    assert.equal(ok, 5);
    assert.equal(limited, 1);
  });
});
