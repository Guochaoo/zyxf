// DB 侧的测试数据 seed（只碰数据库，不发 HTTP）。HTTP 编排在 helpers.js。
// 需要「以某个身份发请求」的用例，用 helpers.js 的 userToken() 直接拿 token。
//
// 为什么单独一个文件：ensureTestUser 原先定义在 setup.js 里（那个文件负责注册模块 mock），
// 而 helpers.js 的 userToken() 也要用它——让 helpers.js 去 import setup.js 会把「HTTP 编排」
// 与「mock 注册」耦在一起，所以把这层纯 DB helper 抽出来（issue #66）。
import { db } from '../src/db.js';

// 认证加固后 attachUser 会按 payload.id 回查用户行（BUG-51/52：使改密/降权/删号立即生效），
// 所以任何「以某个身份发请求」的用例都必须先让该 id 真实存在，否则 token 会被判为无效。
export function ensureTestUser({ id, username = `u${id}`, role = 'user' } = {}) {
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, 'x', ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, role = excluded.role`
  ).run(id, username, role, Date.now());
  return { id, username, role };
}
