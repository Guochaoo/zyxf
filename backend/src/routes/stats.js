import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/', (_req, res) => {
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todayStart = dayStart.getTime();

  const todayDownloads = db
    .prepare('SELECT COUNT(*) AS c FROM download_logs WHERE downloaded_at >= ?')
    .get(todayStart).c;

  const totalFiles = db.prepare('SELECT COUNT(*) AS c FROM files').get().c;
  const totalFolders = db.prepare('SELECT COUNT(*) AS c FROM folders').get().c;
  const totalSize = db.prepare('SELECT COALESCE(SUM(size), 0) AS s FROM files').get().s;

  // Last 7 days download counts
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const start = d.getTime();
    const end = start + 86400000;
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM download_logs WHERE downloaded_at >= ? AND downloaded_at < ?')
      .get(start, end).c;
    days.push({
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      count,
    });
  }

  res.json({
    today_downloads: todayDownloads,
    total_files: totalFiles,
    total_folders: totalFolders,
    total_size: totalSize,
    downloads_by_day: days,
  });
});

export default router;
