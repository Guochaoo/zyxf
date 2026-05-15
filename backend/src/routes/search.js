import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ folders: [], files: [] });

  const like = `%${q}%`;

  const folders = db
    .prepare(
      `SELECT id, name, parent_id, created_at FROM folders WHERE name LIKE ? ORDER BY name LIMIT 20`
    )
    .all(like)
    .map((f) => ({ ...f, type: 'folder' }));

  const files = db
    .prepare(
      `SELECT id, name, folder_id, size, ext, created_at FROM files WHERE name LIKE ? ORDER BY name LIMIT 20`
    )
    .all(like)
    .map((f) => ({ ...f, type: 'file' }));

  res.json({ folders, files });
});

export default router;
