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

/* Daily series (downloads + uploads): one GROUP BY per table. Returns `days`
   rows, oldest → newest, ending today. */
function dailySeries(days, todayStart) {
  const seriesStart = todayStart - (days - 1) * DAY;
  // i = whole days relative to today's local midnight (0 = today, -1 =
  // yesterday …). FLOOR is required — CAST truncates toward zero, which would
  // split a calendar day across two buckets just after midnight.
  const dlByDay = db
    .prepare(
      `SELECT FLOOR((downloaded_at - ?) / ?) AS i, COUNT(*) AS c FROM download_logs
       WHERE downloaded_at >= ? GROUP BY i`
    )
    .all(todayStart, DAY, seriesStart);
  const upByDay = db
    .prepare(
      `SELECT FLOOR((created_at - ?) / ?) AS i, COUNT(*) AS c FROM files
       WHERE created_at >= ? GROUP BY i`
    )
    .all(todayStart, DAY, seriesStart);
  const series = Array.from({ length: days }, (_, k) => {
    const start = todayStart - (days - 1 - k) * DAY;
    return { date: dayLabel(start), ts: start, downloads: 0, uploads: 0 };
  });
  // series is oldest → newest with today last, so a negative i maps to
  // index days-1+i; out-of-range i (future timestamps) is dropped.
  for (const r of dlByDay) {
    const idx = days - 1 + r.i;
    if (series[idx]) series[idx].downloads = r.c;
  }
  for (const r of upByDay) {
    const idx = days - 1 + r.i;
    if (series[idx]) series[idx].uploads = r.c;
  }
  return series;
}

/* Fixed trailing year of daily activity for the dashboard's GitHub-style
   heatmap — deliberately independent of the ?range= switch on GET /. */
router.get('/heatmap', (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 365, 31), 731);
  res.json({ days, series: dailySeries(days, startOfToday()) });
});

router.get('/', (req, res) => {
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

  // ---- Daily series (downloads + uploads) ----
  const series = dailySeries(range, todayStart);

  // ---- File type breakdown ----
  const typeRows = db
    .prepare(
      `SELECT
         ext AS ext,
         COUNT(*) AS count,
         COALESCE(SUM(size), 0) AS size
       FROM (
         SELECT COALESCE(NULLIF(LOWER(ext), ''), 'other') AS ext, size FROM files
       )
       GROUP BY ext
       ORDER BY count DESC
       LIMIT 8`
    )
    .all();

  // ---- Top downloads (last 30 days) ----
  // 按 file_id 分组（而非 file_id + file_name）：窗口内文件被重命名时应只出现
  // 一行，删除后也不会出现 null 元数据行（BUG-15）。
  // 文件名聚合：优先取当前 files 表里的持久 name（LEFT JOIN），无则取组内最新名字。
  const last30Start = todayStart - 29 * DAY;
  const top_downloads = db
    .prepare(
      `SELECT
         dl.file_id,
         COALESCE(f.name,
                  (SELECT dl2.file_name FROM download_logs dl2
                   WHERE dl2.file_id = dl.file_id
                   ORDER BY dl2.downloaded_at DESC, dl2.id DESC LIMIT 1)) AS file_name,
         COUNT(*) AS count,
         f.ext AS ext,
         f.size AS size,
         f.folder_id AS folder_id
       FROM download_logs dl
       LEFT JOIN files f ON f.id = dl.file_id
       WHERE dl.downloaded_at >= ?
       GROUP BY dl.file_id
       ORDER BY count DESC, file_name ASC
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

  // The library itself (folder tree, file names, sizes) is already publicly
  // browsable via GET /folders/tree and GET /folders/:id/contents, so these
  // name-containing lists reveal nothing guests can't already see; the /api
  // rate limiter covers anonymous scraping.
  res.json({
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
    top_downloads,
    recent_uploads,
    top_folders,
  });
});

export default router;
