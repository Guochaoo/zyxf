import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

const DAY = 86400000;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayLabel(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

router.get('/', (req, res) => {
  const isAdmin = req.user?.role === 'admin';
  const range = Math.min(Math.max(parseInt(req.query.range, 10) || 30, 7), 90);
  const todayStart = startOfToday();
  const yesterdayStart = todayStart - DAY;
  const sevenAgo = todayStart - 6 * DAY;
  const prevSevenStart = todayStart - 13 * DAY;

  // ---- Counters ----
  const cnt = (sql, ...args) => db.prepare(sql).get(...args).c;
  const sum = (sql, ...args) => db.prepare(sql).get(...args).s;

  const today_downloads = cnt('SELECT COUNT(*) c FROM download_logs WHERE downloaded_at >= ?', todayStart);
  const yesterday_downloads = cnt(
    'SELECT COUNT(*) c FROM download_logs WHERE downloaded_at >= ? AND downloaded_at < ?',
    yesterdayStart,
    todayStart
  );
  const downloads_7d = cnt('SELECT COUNT(*) c FROM download_logs WHERE downloaded_at >= ?', sevenAgo);
  const downloads_prev_7d = cnt(
    'SELECT COUNT(*) c FROM download_logs WHERE downloaded_at >= ? AND downloaded_at < ?',
    prevSevenStart,
    sevenAgo
  );

  const total_files = cnt('SELECT COUNT(*) c FROM files');
  const total_folders = cnt('SELECT COUNT(*) c FROM folders');
  const total_size = sum('SELECT COALESCE(SUM(size),0) s FROM files');
  const files_added_7d = cnt('SELECT COUNT(*) c FROM files WHERE created_at >= ?', sevenAgo);
  const size_added_7d = sum('SELECT COALESCE(SUM(size),0) s FROM files WHERE created_at >= ?', sevenAgo);

  // ---- Daily series (downloads + uploads): one GROUP BY per table ----
  const seriesStart = todayStart - (range - 1) * DAY;
  const dlByDay = db
    .prepare(
      `SELECT (downloaded_at - ?) / ? AS i, COUNT(*) AS c FROM download_logs
       WHERE downloaded_at >= ? GROUP BY i`
    )
    .all(todayStart, DAY, seriesStart);
  const upByDay = db
    .prepare(
      `SELECT (created_at - ?) / ? AS i, COUNT(*) AS c FROM files
       WHERE created_at >= ? GROUP BY i`
    )
    .all(todayStart, DAY, seriesStart);
  const series = Array.from({ length: range }, (_, k) => {
    const start = todayStart - (range - 1 - k) * DAY;
    return { date: dayLabel(start), ts: start, downloads: 0, uploads: 0 };
  });
  for (const r of dlByDay) if (series[r.i]) series[r.i].downloads = r.c;
  for (const r of upByDay) if (series[r.i]) series[r.i].uploads = r.c;

  // ---- File type breakdown ----
  const typeRows = db
    .prepare(
      `SELECT
         COALESCE(NULLIF(LOWER(ext), ''), 'other') AS ext,
         COUNT(*) AS count,
         COALESCE(SUM(size), 0) AS size
       FROM files
       GROUP BY ext
       ORDER BY count DESC
       LIMIT 8`
    )
    .all();

  // ---- Top downloads (last 30 days) ----
  const last30Start = todayStart - 29 * DAY;
  const top_downloads = db
    .prepare(
      `SELECT
         dl.file_id,
         dl.file_name,
         COUNT(*) AS count,
         f.ext AS ext,
         f.size AS size,
         f.folder_id AS folder_id
       FROM download_logs dl
       LEFT JOIN files f ON f.id = dl.file_id
       WHERE dl.downloaded_at >= ?
       GROUP BY dl.file_id, dl.file_name
       ORDER BY count DESC, dl.file_name ASC
       LIMIT 10`
    )
    .all(last30Start);

  // ---- Recent uploads ----
  const recent_uploads = db
    .prepare(
      `SELECT id, name, ext, size, folder_id, created_at
       FROM files
       ORDER BY created_at DESC
       LIMIT 8`
    )
    .all();

  // ---- Top root folders by size ----
  // Recursively aggregate descendants; SQLite supports recursive CTE.
  const top_folders = db
    .prepare(
      `WITH RECURSIVE descendants(root_id, id) AS (
         SELECT id, id FROM folders WHERE parent_id IS NULL
         UNION ALL
         SELECT d.root_id, fo.id
         FROM folders fo
         JOIN descendants d ON fo.parent_id = d.id
       )
       SELECT
         r.id AS id,
         r.name AS name,
         COALESCE(SUM(f.size), 0) AS size,
         COUNT(f.id) AS file_count
       FROM folders r
       JOIN descendants d ON d.root_id = r.id
       LEFT JOIN files f ON f.folder_id = d.id
       WHERE r.parent_id IS NULL
       GROUP BY r.id, r.name
       ORDER BY size DESC
       LIMIT 5`
    )
    .all();

  // Aggregate-only fields are safe for guests. Filename-containing lists
  // (top_downloads / recent_uploads / top_folders names) are admin-only to
  // avoid leaking the internal file inventory.
  const payload = {
    range,
    today_downloads,
    yesterday_downloads,
    downloads_7d,
    downloads_prev_7d,
    total_files,
    total_folders,
    total_size,
    files_added_7d,
    size_added_7d,
    series,
    type_breakdown: typeRows,
  };
  if (isAdmin) {
    payload.top_downloads = top_downloads;
    payload.recent_uploads = recent_uploads;
    payload.top_folders = top_folders;
  }
  res.json(payload);
});

export default router;
