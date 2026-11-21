// 每日把 SQLite 主库的一致性快照上传到 OSS，并按保留期清理旧份。
//
// 为什么不是 `cp data.db`：后端开了 WAL（见 src/db.js），已提交事务可能全在
// data.db-wal 里，单独拷贝 data.db 会得到空库或严重陈旧的库——DEPLOY.md §7 有实测
// 反例（data.db 仅 4 KB，data.db-wal 有 600 KB，拷出来的库连 files 表都没有）。
// 这里让 SQLite 自己产出快照（VACUUM INTO），再 gzip 上传。
//
// 用法：
//   node scripts/backup-db.mjs          # 备份 + 上传 + 清理过期
//   node scripts/backup-db.mjs --dry    # 只报告会做什么，不写 OSS、不删任何东西
//
// 生产由 deploy/zyxf-backup.timer 每天触发。凭据沿用 .env 里的 OSS_*（与站点同一把
// RAM 密钥，策略允许 acs:oss:*:*:<bucket>/*，因此 backup/ 前缀在授权范围内）。
//
// ⚠️ 只备份数据库，不备份 .env：.env 含密钥，放进对象存储等于多一处泄露面；它丢了
// 也只是 JWT_SECRET / ADMIN_PASSWORD / OSS 密钥要重新生成，属于可恢复项。
import '../src/env.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ossClient } from '../src/oss.js';
import { envStr } from '../src/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 与 src/db.js 解析出同一个文件：src/.. 与 scripts/.. 都指向 backend/。
const DB_PATH =
  process.env.DB_PATH && process.env.DB_PATH !== ':memory:'
    ? process.env.DB_PATH
    : path.join(__dirname, '..', 'data.db');

// 放在 OSS_KEY_PREFIX 之外：sync 只扫 zyxf/ 前缀，备份对象不会被当成站内文件。
const PREFIX = (envStr('BACKUP_OSS_PREFIX') || 'backup').replace(/^\/+|\/+$/g, '');
const RETENTION_DAYS = Number(envStr('BACKUP_RETENTION_DAYS')) || 7;
const DRY = process.argv.includes('--dry');

const NAME_RE = /^zyxf-data-(\d{8})T(\d{6})Z\.db\.gz$/;

function stamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** 从对象名回推备份时间；不认识的名字返回 null（绝不因为一个陌生对象去删它）。 */
function backupTimeOf(name) {
  const m = NAME_RE.exec(path.posix.basename(name));
  if (!m) return null;
  const [, ymd, hms] = m;
  const iso =
    `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T` +
    `${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function fail(msg) {
  console.error(`[backup] ${msg}`);
  process.exitCode = 1;
}

const tmpPath = path.join(os.tmpdir(), `zyxf-backup-${process.pid}-${Date.now()}.db`);

try {
  if (!fs.existsSync(DB_PATH)) {
    fail(`数据库不存在: ${DB_PATH}`);
    process.exit(1);
  }

  // 1) 一致性快照。VACUUM INTO 的目标文件必须不存在。
  const db = new DatabaseSync(DB_PATH);
  try {
    db.exec(`PRAGMA busy_timeout = 5000`);
    db.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  const raw = fs.readFileSync(tmpPath);
  const gz = zlib.gzipSync(raw, { level: 9 });
  const key = `${PREFIX}/zyxf-data-${stamp(Date.now())}.db.gz`;

  if (DRY) {
    console.log(
      JSON.stringify(
        { mode: 'dry-run', dbPath: DB_PATH, key, rawBytes: raw.length, gzBytes: gz.length, retentionDays: RETENTION_DAYS },
        null,
        2
      )
    );
    process.exit(0);
  }

  // 2) 上传。key 不覆盖历史（时间戳到秒），因此不会把上一次的备份冲掉。
  const client = ossClient();
  await client.put(key, gz, { headers: { 'Content-Type': 'application/gzip' } });

  // 3) 清理过期。只删自己能识别出时间的对象，避免误删同前缀下的其它东西。
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const pruned = [];
  let marker;
  let res;
  do {
    res = await client.list({ prefix: `${PREFIX}/`, marker, 'max-keys': 1000 }, {});
    for (const o of res.objects || []) {
      const t = backupTimeOf(o.name);
      if (t !== null && t < cutoff) {
        await client.delete(o.name);
        pruned.push(o.name);
      }
    }
    marker = res.nextMarker;
  } while (res.isTruncated && marker);

  console.log(
    JSON.stringify(
      {
        ok: true,
        key,
        rawBytes: raw.length,
        gzBytes: gz.length,
        retentionDays: RETENTION_DAYS,
        prunedCount: pruned.length,
        pruned: pruned.slice(0, 20),
      },
      null,
      2
    )
  );
} catch (err) {
  fail(err?.message || String(err));
} finally {
  fs.rmSync(tmpPath, { force: true });
}
